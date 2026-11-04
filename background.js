const SEARCHES_KEY = "findfullSearches";
const LAST_CONFIG_KEY = "findfullLastConfig";
const ERROR_LOGS_KEY = "findfullErrorLog";
const MAX_ERROR_LOGS = 200;
const ALARM_PREFIX = "findfull-scan-";
let errorLogQueue = Promise.resolve();
let searchWriteQueue = Promise.resolve();

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
