"use strict";
const C = globalThis.FullRadarCore;
const tabQueues = new Map();
const ACTIVE = new Set(["monitoring", "loading", "scanning", "recovering", "selecting", "confirming"]);
function serial(tabId, task) {
  const next = (tabQueues.get(tabId) || Promise.resolve()).catch(() => {}).then(task);
  tabQueues.set(tabId, next);
  next.finally(() => { if (tabQueues.get(tabId) === next) tabQueues.delete(tabId); }).catch(() => {});
  return next;
}
const isIsoDate = C.isIsoDate;
async function readSearches() { return (await chrome.storage.local.get(SEARCHES_KEY))[SEARCHES_KEY] || {}; }
async function readSearch(tabId) { return (await readSearches())[String(tabId)] || null; }
function saveSearch(tabId, search) {
  const task = searchWriteQueue.catch(() => {}).then(async () => {
    const all = await readSearches();
    if (search) all[String(tabId)] = search; else delete all[String(tabId)];
    await chrome.storage.local.set({ [SEARCHES_KEY]: all });
  });
  searchWriteQueue = task;
  return task;
}
const alarmName = id => ALARM_PREFIX + id;
async function sendToTab(tabId, message) {
  let timeout;
  try { return await Promise.race([chrome.tabs.sendMessage(tabId, message, { frameId: 0 }), new Promise(resolve => { timeout = setTimeout(() => resolve(null), 4000); })]); }
  catch { return null; } finally { clearTimeout(timeout); }
}
async function notify(tabId, title, message) {
  try { await chrome.notifications.create(`findfull-${tabId}-${Date.now()}`, { type: "basic", iconUrl: "icons/icon128.png", title, message, priority: 2 }); }
  catch (error) { await appendErrorLog({ source: "Avisos", message: error.message, severity: "warning" }); }
}
async function schedule(tabId, search, seconds) {
  search.updatedAt = Date.now();
  search.nextRefreshAt = search.updatedAt + Math.max(15, seconds) * 1000;
  await saveSearch(tabId, search);
  // O timer da aba permite 15 s; o alarme MV3 mantém um fallback persistente de 30 s.
  await chrome.alarms.create(alarmName(tabId), { when: Math.max(search.nextRefreshAt, Date.now() + 30000) });
}
async function pause(tabId, search, message) {
  if (!search) return;
  search.running = false;
  search.status = "needs_attention";
  search.resultMessage = message;
  search.updatedAt = Date.now();
  search.nextRefreshAt = 0;
  await saveSearch(tabId, search);
  await chrome.alarms.clear(alarmName(tabId));
  await sendToTab(tabId, { type: "STOP_SCAN" });
  await appendErrorLog({ source: "Monitor", stage: search.recoveryStep || "verificação", message });
  await notify(tabId, "Busca pausada", message);
}
async function retry(tabId, search, message) {
  search.failures = (search.failures || 0) + 1;
  search.cycleHadInstability = true;
  search.cyclePenaltyApplied = true;
  search.cycleSampled = false;
  Object.assign(search, C.adjustCadence(search, "failure"));
  // Falhas transitórias não encerram a busca. A espera permanece limitada
  // pela cadência, e o limite de navegação vale só para cada tentativa.
  search.recoveryHops = 0;
  search.status = "monitoring";
  search.running = true;
  search.resultMessage = `${message} Intervalo ajustado para ${search.effectiveIntervalSeconds} s.`;
  await schedule(tabId, search, search.effectiveIntervalSeconds);
}
function beginCycle(search) {
  search.cycleHadInstability = false;
  search.cyclePenaltyApplied = false;
  search.cycleSampled = false;
}
async function dispatchScan(tabId, search) {
  search.status = "scanning";
  search.running = true;
  await schedule(tabId, search, 90); // watchdog: não abandonar uma recuperação sem alarme.
  const result = await sendToTab(tabId, { type: "SCAN", search });
  if (!result?.ok) await retry(tabId, search, "O monitor da página não respondeu. Atualize a aba se acabou de carregar a extensão.");
}
async function startOne(tab, rawConfig, resume = false) {
  if (!tab?.id || !C.isMarketplaceUrl(tab.url)) return { ok: false, error: "Abra uma página do Mercado Livre." };
  return serial(tab.id, async () => {
    const page = await sendToTab(tab.id, { type: "PAGE_INFO" });
    if (!page || page.version !== chrome.runtime.getManifest().version) return { ok: false, error: "Atualize a aba do Mercado Livre para carregar esta versão do monitor." };
    if (page.challenge) return { ok: false, error: page.message };
    if (!page.schedulePage && !(resume && page.recoveryStep)) return { ok: false, error: "Abra a edição da coleta ou retome uma busca pausada na Gestão." };
    const config = C.normalizeConfig(rawConfig);
    try { C.validateConfig(config); } catch (error) { return { ok: false, error: error.message }; }
    if (!resume) config.shipmentId = C.shipmentId(tab.url);
    else config.shipmentId ||= C.shipmentId(tab.url);
    if (!config.shipmentId) return { ok: false, error: "Informe o ID exato do envio para retomar." };
    if (page.shipmentId && page.shipmentId !== config.shipmentId) return { ok: false, error: "O ID informado é diferente do envio aberto nesta aba." };
    const all = await readSearches();
    const origin = new URL(tab.url).origin;
    if (Object.entries(all).some(([id, s]) => Number(id) !== tab.id && ACTIVE.has(s.status) && s.origin === origin && s.config.shipmentId === config.shipmentId)) return { ok: false, error: "Já existe uma busca ativa para este envio em outra aba." };
    await sendToTab(tab.id, { type: "STOP_SCAN" });
    const search = { id: crypto.randomUUID(), running: true, status: "scanning", config, effectiveIntervalSeconds: config.intervalSeconds, origin, tabUrl: tab.url, tabTitle: tab.title, startedAt: Date.now(), lastRefreshAt: 0, lastCheckedAt: 0, checks: 0, failures: 0, recoveryHops: 0 };
    beginCycle(search);
    await chrome.storage.local.set({ [LAST_CONFIG_KEY]: config });
    await dispatchScan(tab.id, search);
    return { ok: true, tabId: tab.id, title: tab.title };
  });
}
async function stopOne(tabId) {
  return serial(tabId, async () => {
    await saveSearch(tabId, null);
    await chrome.alarms.clear(alarmName(tabId));
    await sendToTab(tabId, { type: "STOP_SCAN" });
    return true;
  });
}
async function getOverview() {
  const [tabs, active, searches, saved] = await Promise.all([chrome.tabs.query({}), chrome.tabs.query({ active: true, currentWindow: true }), readSearches(), chrome.storage.local.get([LAST_CONFIG_KEY, ERROR_LOGS_KEY])]);
  const rows = await Promise.all(tabs.filter(t => C.isMarketplaceUrl(t.url)).map(async tab => {
    const page = await sendToTab(tab.id, { type: "PAGE_INFO" });
    return { id: tab.id, title: tab.title, url: tab.url, supportedPage: Boolean(page?.schedulePage), schedulePage: Boolean(page?.schedulePage), recoveryStep: page?.recoveryStep || "", pageMessage: page?.message || "Atualize a aba para carregar o monitor.", shipmentId: page?.shipmentId || "", search: searches[String(tab.id)] || null };
  }));
  const current = rows.find(t => t.id === active[0]?.id);
  return { activeTabId: active[0]?.id, activeTabTitle: active[0]?.title, activeTabUrl: active[0]?.url, activeSupportedPage: Boolean(current?.supportedPage), activeSchedulePage: Boolean(current?.schedulePage), activeRecoveryStep: current?.recoveryStep || "", activePageMessage: current?.pageMessage, tabs: rows, lastConfig: saved[LAST_CONFIG_KEY] || null, errorLog: saved[ERROR_LOGS_KEY] || [] };
}
async function handleContentEvent(message, sender) {
  const tabId = sender.tab?.id;
  if (tabId === undefined || (sender.frameId !== undefined && sender.frameId !== 0)) return { ok: false };
  return serial(tabId, async () => {
    const search = await readSearch(tabId);
    if (!search || search.id !== message.searchId || !ACTIVE.has(search.status)) return { ok: false };
    const url = sender.url || sender.tab.url;
    if (!C.isMarketplaceUrl(url) || new URL(url).origin !== search.origin) return { ok: false };
    const id = C.shipmentId(url);
    if (id && id !== search.config.shipmentId) { await pause(tabId, search, "A aba mudou para outro envio. Busca pausada."); return { ok: false }; }
    const dateAllowed = date => C.requestedDates(search.config, C.today()).includes(date);
    if (search.status === "confirming" && !["CONFIRMATION_RESULT", "NEEDS_ATTENTION"].includes(message.event)) return { ok: false };
    if (search.status === "selecting" && !["BEFORE_CONFIRM", "NEEDS_ATTENTION"].includes(message.event)) return { ok: false };
    switch (message.event) {
      case "PHASE": {
        if (!["scanning", "recovering", "selecting"].includes(message.status) || search.status === "confirming") return { ok: false };
        if (message.status === "selecting" && (!search.config.autoConfirm || !dateAllowed(message.date))) return { ok: false };
        // Uma navegação manual pode iniciar novo documento entre duas recargas.
        if (search.status === "monitoring" && search.cycleSampled && ["scanning", "recovering"].includes(message.status)) beginCycle(search);
        if (message.status === "recovering") {
          search.cycleHadInstability = true;
          Object.assign(search, C.adjustCadence(search, "interrupted"));
        }
        search.status = message.status;
        search.recoveryStep = message.step || "";
        if (message.date) search.foundDate = message.date;
        if (message.status === "recovering" && ++search.recoveryHops > 8) { await pause(tabId, search, "A recuperação entrou em repetição. Confira a página e retome."); return { ok: false }; }
        await schedule(tabId, search, message.status === "recovering" ? 90 : 60);
        return { ok: true };
      }
      case "SCAN_COMPLETE":
        // Um calendário concluído conta uma vez; etapas de recuperação não são sucessos limpos.
        if (search.cycleSampled) return { ok: false };
        if (!search.cycleHadInstability) Object.assign(search, C.adjustCadence(search, "success"));
        else if (!search.cyclePenaltyApplied) Object.assign(search, C.adjustCadence(search, "failure"));
        search.cycleSampled = true;
        search.status = "monitoring";
        search.running = true;
        search.lastCheckedAt = Date.now();
        search.checks++;
        search.failures = 0;
        search.recoveryHops = 0;
        search.resultMessage = message.message;
        search.monthsChecked = message.months || [];
        await schedule(tabId, search, search.effectiveIntervalSeconds || search.config.intervalSeconds);
        return { ok: true, nextRefreshAt: search.nextRefreshAt };
      case "RETRY": await retry(tabId, search, message.message); return { ok: true, nextRefreshAt: search.status === "monitoring" ? search.nextRefreshAt : 0 };
      case "REFRESH_DUE":
        if (search.status !== "monitoring" || Date.now() < search.nextRefreshAt) return { ok: false };
        await processDeadline(tabId, search);
        return { ok: true };
      case "NEEDS_ATTENTION": await pause(tabId, search, message.message); return { ok: true };
      case "BEFORE_CONFIRM":
        if (search.status !== "selecting" || !search.config.autoConfirm || search.config.automationVersion !== C.AUTOMATION_VERSION || !dateAllowed(message.date) || search.finalClickAt) return { ok: false };
        search.status = "confirming";
        search.foundDate = message.date;
        search.finalClickAt = Date.now();
        await schedule(tabId, search, 60);
        return { ok: true };
      case "FOUND_DATE":
      case "ALREADY_SATISFIED":
        if (!dateAllowed(message.date)) return { ok: false };
        search.status = message.event === "FOUND_DATE" ? "found" : "satisfied";
        search.foundDate = message.date;
        search.running = false;
        search.nextRefreshAt = 0;
        search.resultMessage = message.message || "A data atual já atende à primeira preferência. A reserva não foi alterada.";
        search.lastCheckedAt = Date.now();
        await saveSearch(tabId, search);
        await chrome.alarms.clear(alarmName(tabId));
        await notify(tabId, search.status === "found" ? "Data disponível no Full" : "Data atual atende à busca", search.resultMessage + " " + message.date);
        return { ok: true };
      case "CONFIRMATION_RESULT":
        if (search.status !== "confirming" || !search.finalClickAt || message.date !== search.foundDate) return { ok: false };
        if (!message.confirmed) { await pause(tabId, search, message.message); return { ok: true }; }
        search.status = "confirmed";
        search.running = false;
        search.nextRefreshAt = 0;
        search.updatedAt = Date.now();
        await saveSearch(tabId, search);
        await chrome.alarms.clear(alarmName(tabId));
        await notify(tabId, "Coleta confirmada", `O Mercado Livre confirmou a coleta para ${search.foundDate}.`);
        await notifyTelegramBooking(search);
        return { ok: true };
      default: return { ok: false };
    }
  });
}
async function handleAlarm(alarm) {
  if (!alarm.name.startsWith(ALARM_PREFIX)) return;
  const tabId = Number(alarm.name.slice(ALARM_PREFIX.length));
  return serial(tabId, async () => {
    const search = await readSearch(tabId);
    if (!search || !ACTIVE.has(search.status)) { await chrome.alarms.clear(alarm.name); return; }
    // Um alarme antigo pode chegar depois de uma fase que já reagendou o prazo.
    if (search.nextRefreshAt > Date.now() + 1000) { await chrome.alarms.create(alarm.name, { when: search.nextRefreshAt }); return; }
    await processDeadline(tabId, search);
  });
}
async function processDeadline(tabId, search) {
    if (["selecting", "confirming"].includes(search.status)) { await pause(tabId, search, "Não foi possível verificar a conclusão da seleção. Confira a reserva; a confirmação não será repetida."); return; }
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) { await saveSearch(tabId, null); return; }
    if (!C.isMarketplaceUrl(tab.url) || new URL(tab.url).origin !== search.origin) { await pause(tabId, search, "A aba saiu da página do Mercado Livre. Busca pausada."); return; }
    const routeId = C.shipmentId(tab.url);
    if (routeId && routeId !== search.config.shipmentId) { await pause(tabId, search, "A aba abriu outro envio. Busca pausada."); return; }
    const page = await sendToTab(tabId, { type: "PAGE_INFO" });
    if (page?.challenge) { await pause(tabId, search, page.message); return; }
    if (["scanning", "recovering"].includes(search.status)) { await sendToTab(tabId, { type: "STOP_SCAN" }); await retry(tabId, search, "A leitura não terminou no prazo. Aguardando antes de tentar novamente."); return; }
    if (page?.recoveryStep) { await dispatchScan(tabId, search); return; }
    if (page?.schedulePage && search.status === "loading") { await dispatchScan(tabId, search); return; }
    // Recursos secundários podem manter a aba em "loading" com o formulário pronto.
    // A leitura do DOM decide se já podemos recuperar/verificar ou iniciar outro ciclo.
    if (tab.status === "loading" && !page?.schedulePage) { await retry(tabId, search, "O Mercado Livre ainda está carregando e o formulário não ficou disponível."); return; }
    if (page && !page.schedulePage) {
      if (!/^\/shipping\/inbounds(?:\/|$)/.test(new URL(tab.url).pathname)) { await pause(tabId, search, "A aba saiu do fluxo de envios Full."); return; }
      if (search.status !== "monitoring") { await retry(tabId, search, "A página está incompleta. Aguardando antes de recarregar."); return; }
      // Tentativa já agendada após erro: efetuar a recarga, sem ficar só reagendando.
    }
    if (search.status === "loading") { await retry(tabId, search, "O monitor não retomou após carregar a página."); return; }
    search.status = "loading";
    beginCycle(search);
    search.lastRefreshAt = Date.now();
    await schedule(tabId, search, 60);
    await chrome.tabs.reload(tabId);
}
async function restoreAlarms() {
  const all = await readSearches();
  for (const id of Object.keys(all)) await serial(Number(id), async () => {
    const search = await readSearch(id);
    if (!search || !ACTIVE.has(search.status)) return;
    const tab = await chrome.tabs.get(Number(id)).catch(() => null);
    if (!tab) { await saveSearch(id, null); return; }
    // IDs de abas podem mudar no reinício. Retomar exige contexto e versão conhecidos.
    if (!search.origin || search.config?.automationVersion !== C.AUTOMATION_VERSION || C.shipmentId(tab.url) !== search.config.shipmentId) { await pause(Number(id), search, "Confira o envio e retome a busca após atualizar ou reiniciar o navegador."); return; }
    if (["selecting", "confirming"].includes(search.status)) { await pause(Number(id), search, "O navegador reiniciou durante uma seleção. Confira a reserva antes de retomar."); return; }
    search.status = "monitoring";
    await schedule(Number(id), search, search.effectiveIntervalSeconds || search.config.intervalSeconds || 15);
  });
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  (async () => {
    if (message.type === "GET_TAB_SEARCH") return sender.tab ? readSearch(sender.tab.id) : null;
    if (message.type === "CONTENT_EVENT") return handleContentEvent(message, sender);
    // Comandos do popup não são aceitos de scripts de uma página.
    if (sender.tab) return { ok: false };
    if (message.type === "GET_OVERVIEW") return getOverview();
    if (message.type === "GET_TELEGRAM_STATUS") return getTelegramStatus();
    if (message.type === "START_TELEGRAM_PAIRING") return startTelegramPairing();
    if (message.type === "DISCONNECT_TELEGRAM") return disconnectTelegram();
    if (message.type === "LOG_ERROR") { await appendErrorLog(message); return { ok: true }; }
    if (message.type === "START_SEARCH") {
      if (message.scope === "all" && message.config?.shipmentId) return { ok: false, results: [{ ok: false, error: "Um ID específico só pode ser iniciado na aba correspondente." }] };
      const tabs = message.scope === "all" ? (await chrome.tabs.query({})).filter(t => C.isMarketplaceUrl(t.url)) : [await chrome.tabs.get(message.tabId).catch(() => null)];
      const results = [];
      for (const tab of tabs) results.push(await startOne(tab, message.config));
      return { ok: results.some(r => r.ok), results };
    }
    if (message.type === "STOP_SEARCH") return { ok: await stopOne(message.tabId) };
    if (message.type === "STOP_ALL") { for (const id of Object.keys(await readSearches())) await stopOne(Number(id)); return { ok: true }; }
    if (message.type === "RESUME_SEARCH") {
      const prior = await readSearch(message.tabId);
      if (!prior || prior.status !== "needs_attention") return { ok: false, error: "Não há uma busca pausada nesta aba." };
      const tab = await chrome.tabs.get(message.tabId).catch(() => null);
      return startOne(tab, { ...prior.config, ...message.config, shipmentId: message.shipmentId || message.config?.shipmentId || prior.config.shipmentId }, true);
    }
    return { ok: false, error: "Comando desconhecido." };
  })().then(respond).catch(async error => { await appendErrorLog({ source: message.type, message: error.message }); respond({ ok: false, error: error.message }); });
  return true;
});
chrome.alarms.onAlarm.addListener(alarm => handleAlarm(alarm).catch(async error => {
  const tabId = Number(alarm.name.slice(ALARM_PREFIX.length));
  await serial(tabId, async () => pause(tabId, await readSearch(tabId), error.message));
}));
chrome.tabs.onRemoved.addListener(tabId => stopOne(tabId).catch(() => {}));
chrome.notifications.onClicked.addListener(id => {
  const tabId = Number(id.match(/^findfull-(\d+)-/)?.[1]);
  if (tabId) chrome.tabs.update(tabId, { active: true }).catch(() => {});
});
chrome.runtime.onStartup.addListener(restoreAlarms);
chrome.runtime.onInstalled.addListener(restoreAlarms);
