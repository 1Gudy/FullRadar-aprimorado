importScripts("telegram-config.js");

const SEARCHES_KEY = "findfullSearches";
const LAST_CONFIG_KEY = "findfullLastConfig";
const ERROR_LOGS_KEY = "findfullErrorLog";
const MAX_ERROR_LOGS = 200;
const ALARM_PREFIX = "findfull-scan-";
const TELEGRAM_CREDENTIALS_KEY = "fullRadarTelegramCredentials";
const TELEGRAM_STATE_KEY = "fullRadarTelegramState";
const TELEGRAM_CONFIG = globalThis.FULLRADAR_TELEGRAM_CONFIG || {};
let errorLogQueue = Promise.resolve();
let searchWriteQueue = Promise.resolve();

function isTelegramConfigured() {
  try {
    const gateway = new URL(String(TELEGRAM_CONFIG.gatewayUrl || ""));
    return gateway.protocol === "https:" && Boolean(String(TELEGRAM_CONFIG.botUsername || "").trim()) &&
      !gateway.username && !gateway.password && !gateway.search && !gateway.hash;
  } catch {
    return false;
  }
}

function telegramOriginPattern() {
  return `${new URL(TELEGRAM_CONFIG.gatewayUrl).origin}/*`;
}

function randomToken(byteLength = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function getTelegramCredentials(create = false) {
  const saved = await chrome.storage.local.get(TELEGRAM_CREDENTIALS_KEY);
  if (saved[TELEGRAM_CREDENTIALS_KEY]) return saved[TELEGRAM_CREDENTIALS_KEY];
  if (!create) return null;
  const credentials = { deviceId: crypto.randomUUID(), secret: randomToken() };
  await chrome.storage.local.set({ [TELEGRAM_CREDENTIALS_KEY]: credentials });
  return credentials;
}

function telegramUrl(path) {
  const base = new URL(TELEGRAM_CONFIG.gatewayUrl);
  if (base.pathname !== "/") throw new Error("O endereço do serviço Telegram deve apontar para a raiz do domínio.");
  return new URL(path, base.origin).toString();
}

async function telegramRequest(path, { method = "GET", body } = {}) {
  if (!isTelegramConfigured()) throw new Error("Os avisos privados do Telegram ainda não foram configurados no FullRadar.");
  const credentials = await getTelegramCredentials(true);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(telegramUrl(path), {
      method,
      headers: {
        Authorization: `Bearer ${credentials.secret}`,
        "X-FullRadar-Device": credentials.deviceId,
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      body: body ? JSON.stringify({ ...body, deviceId: credentials.deviceId }) : undefined,
      signal: controller.signal
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `O serviço Telegram respondeu com erro (${response.status}).`);
    return result;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("O serviço Telegram demorou para responder. Tente novamente.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function getTelegramStatus() {
  if (!isTelegramConfigured()) return { available: false, connected: false, pending: false };
  const [credentials, saved] = await Promise.all([
    getTelegramCredentials(false),
    chrome.storage.local.get(TELEGRAM_STATE_KEY)
  ]);
  const localState = saved[TELEGRAM_STATE_KEY] || {};
  const status = {
    available: true,
    connected: Boolean(localState.connected),
    pending: Boolean(localState.pending && localState.expiresAt > Date.now()),
    startUrl: localState.startUrl || "",
    botUsername: String(TELEGRAM_CONFIG.botUsername).replace(/^@/, "")
  };
  if (!credentials) return status;
  const hasPermission = await chrome.permissions.contains({ origins: [telegramOriginPattern()] });
  if (!hasPermission) return { ...status, connected: false, authorizationRequired: true };
  try {
    const remote = await telegramRequest("/api/status");
    const connected = Boolean(remote.connected);
    const next = { ...localState, connected, pending: connected ? false : status.pending };
    await chrome.storage.local.set({ [TELEGRAM_STATE_KEY]: next });
    return { ...status, connected, pending: Boolean(next.pending), startUrl: next.startUrl || "" };
  } catch (error) {
    return { ...status, error: error?.message || "Não foi possível consultar a conexão." };
  }
}

async function startTelegramPairing() {
  if (!isTelegramConfigured()) return { ok: false, error: "Os avisos privados do Telegram ainda não foram configurados no FullRadar." };
  const hasPermission = await chrome.permissions.contains({ origins: [telegramOriginPattern()] });
  if (!hasPermission) return { ok: false, error: "Permita o acesso ao serviço do FullRadar para conectar o Telegram." };
  const result = await telegramRequest("/api/pair/start", { method: "POST", body: {} });
  if (!result.startUrl || !result.expiresAt) throw new Error("O serviço não retornou o link para conectar o Telegram.");
  await chrome.storage.local.set({
    [TELEGRAM_STATE_KEY]: { connected: false, pending: true, startUrl: result.startUrl, expiresAt: result.expiresAt }
  });
  return { ok: true, startUrl: result.startUrl, expiresAt: result.expiresAt };
}

async function disconnectTelegram() {
  const credentials = await getTelegramCredentials(false);
  if (!credentials) return { ok: true };
  await telegramRequest("/api/disconnect", { method: "POST", body: {} });
  await chrome.storage.local.set({ [TELEGRAM_STATE_KEY]: { connected: false, pending: false } });
  return { ok: true };
}

async function notifyTelegramBooking(search) {
  const saved = await chrome.storage.local.get(TELEGRAM_STATE_KEY);
  if (!saved[TELEGRAM_STATE_KEY]?.connected || !isTelegramConfigured()) return;
  const credentials = await getTelegramCredentials(false);
  if (!credentials || !isIsoDate(search.foundDate)) return;
  const eventId = `${search.id || search.startedAt || "booking"}:${search.foundDate}`;
  try {
    await telegramRequest("/api/notify", {
      method: "POST",
      body: { eventId, date: search.foundDate }
    });
  } catch (error) {
    await appendErrorLog({ source: "Telegram", stage: "aviso de agendamento", message: error?.message || "Não foi possível enviar a mensagem privada.", severity: "warning" });
  }
}

function sanitizeDiagnostic(value) {
  return String(value || "")
    .replace(/#?\b\d{6,20}\b/g, "#…")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[e-mail]")
    .slice(0, 400);
}

function appendErrorLog({ source = "extension", stage = "", message = "Falha sem detalhes.", severity = "error" }) {
  const entry = {
    timestamp: new Date().toISOString(),
    severity: severity === "warning" ? "warning" : "error",
    source: sanitizeDiagnostic(source).slice(0, 60),
    stage: sanitizeDiagnostic(stage).slice(0, 80),
    message: sanitizeDiagnostic(message),
    version: chrome.runtime.getManifest().version
  };
  errorLogQueue = errorLogQueue.catch(() => {}).then(async () => {
    const data = await chrome.storage.local.get(ERROR_LOGS_KEY);
    const logs = Array.isArray(data[ERROR_LOGS_KEY]) ? data[ERROR_LOGS_KEY] : [];
    const previous = logs[0];
    const previousAt = Date.parse(previous?.timestamp || "");
    if (previous?.source === entry.source && previous?.stage === entry.stage &&
        previous?.message === entry.message && Date.now() - previousAt < 30_000) return;
    await chrome.storage.local.set({ [ERROR_LOGS_KEY]: [entry, ...logs].slice(0, MAX_ERROR_LOGS) });
  });
  return errorLogQueue.catch(() => {});
}


importScripts("core.js", "scheduler.js");
