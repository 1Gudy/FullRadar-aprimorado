const send = message => chrome.runtime.sendMessage(message);
const $ = selector => document.querySelector(selector);
const C = globalThis.FullRadarCore;
let overview = null;
let mode = "range";
let initialized = false;
let refreshing = false;
let hasDraft = false;
let formTouched = false;
let rangeEdge = "start";
let calendarMonth = C.today().slice(0, 7);
const DRAFT_KEY = "fullradarPopupDraftV1";
let activeSearch = null;
let telegramInitialized = false;
let telegramStatus = null;
let datesEditing = false;

function setMessage(text, success = false) {
  const box = $("#actionMessage");
  box.textContent = text;
  box.classList.toggle("is-visible", Boolean(text));
  box.classList.toggle("is-success", Boolean(text) && success);
}

function parseDate(value) {
  const text = value.trim();
  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return validIso(text) ? text : null;
  match = text.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
  if (!match) return null;
  const iso = `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  return validIso(iso) ? iso : null;
}

function validIso(value) {
  return C.isIsoDate(value);
}

function readConfig() {
  const intervalSeconds = Number($("#interval").value);
  // O background vincula a busca ao ID da URL; o formulário não fornece IDs.
  if (mode === "specific") {
    const rawDates = $("#dates").value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (!rawDates.length) throw new Error("Informe ao menos uma data na ordem de preferência.");
    const dates = rawDates.map(parseDate);
    if (dates.some(date => !date)) throw new Error("Revise as datas. Use DD/MM/AAAA ou AAAA-MM-DD.");
    return { mode, dates: [...new Set(dates)], intervalSeconds, autoConfirm: $("#autoConfirm").checked, automationVersion: C.AUTOMATION_VERSION };
  }
  const startDate = $("#startDate").value;
  const endDate = $("#endDate").value;
  if (!validIso(startDate) || !validIso(endDate) || startDate > endDate) {
    throw new Error("Escolha um período válido: a data inicial deve ser anterior à final.");
  }
  return { mode, startDate, endDate, intervalSeconds, autoConfirm: $("#autoConfirm").checked, automationVersion: C.AUTOMATION_VERSION };
}

function formatDate(value) {
  if (!value) return "";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(year, month - 1, day, 12));
}

function loadConfig(config) {
  if (!config) return;
  mode = config.mode === "range" ? "range" : "specific";
  setMode(mode);
  if (mode === "specific" && Array.isArray(config.dates)) $("#dates").value = config.dates.map(formatDate).join("\n");
  if (mode === "range") {
    $("#startDate").value = config.startDate || "";
    $("#endDate").value = config.endDate || "";
  }
  $("#interval").value = String(config.intervalSeconds || 15);
  $("#autoConfirm").checked = C.normalizeConfig(config).autoConfirm;
  calendarMonth = (config.startDate || config.dates?.[0] || C.today()).slice(0, 7);
  renderCalendar();
  updateRangeSummary();
  updateInterval();
  updateStartAllAvailability();
}

function setMode(nextMode) {
  mode = nextMode;
  $("#specificFields").hidden = mode !== "specific";
  $("#rangeFields").hidden = mode !== "range";
  updateRangeSummary();
  document.querySelectorAll(".mode-button").forEach(button => {
    const active = button.dataset.mode === mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  renderCalendar();
}

function saveDraft() {
  formTouched = true;
  hasDraft = true;
  renderPresentation();
  const draft = { mode, datesText: $("#dates").value, startDate: $("#startDate").value, endDate: $("#endDate").value,
    intervalSeconds: Number($("#interval").value), autoConfirm: $("#autoConfirm").checked,
    automationVersion: C.AUTOMATION_VERSION, rangeEdge, calendarMonth };
  // Iniciar a gravação em cada evento; não esperar debounce, blur ou fechamento.
  const status = $("#draftStatus");
  status.textContent = "Salvando…";
  chrome.storage.local.set({ [DRAFT_KEY]: draft }).then(() => {
    status.textContent = "Preferências salvas automaticamente.";
  }).catch(() => { status.textContent = "Não foi possível salvar. Mantenha o popup aberto e tente novamente."; });
}

async function restoreDraft() {
  try {
    const draft = (await chrome.storage.local.get(DRAFT_KEY))[DRAFT_KEY];
    if (!draft || formTouched) return;
    hasDraft = true;
    loadConfig(draft);
    $("#dates").value = typeof draft.datesText === "string" ? draft.datesText : "";
    // Inclusive um período incompleto deve sobreviver ao fechamento.
    $("#startDate").value = draft.startDate || "";
    $("#endDate").value = draft.endDate || "";
    rangeEdge = draft.rangeEdge === "end" ? "end" : "start";
    if (/^20\d{2}-(0[1-9]|1[0-2])$/.test(draft.calendarMonth || "")) calendarMonth = draft.calendarMonth;
    renderCalendar();
    $("#draftStatus").textContent = "Preferências restauradas.";
  } catch { $("#draftStatus").textContent = "Não foi possível recuperar as preferências salvas."; }
}

function selectedDates() { return $("#dates").value.split(/\r?\n/).map(parseDate).filter(Boolean); }
function chooseDate(date) {
  if (mode === "specific") {
    const dates = selectedDates();
    $("#dates").value = (dates.includes(date) ? dates.filter(d => d !== date) : [...dates, date]).map(formatDate).join("\n");
  } else if (rangeEdge === "start" || !validIso($("#startDate").value)) {
    $("#startDate").value = date;
    if ($("#endDate").value < date) $("#endDate").value = "";
    rangeEdge = "end";
  } else {
    if (date < $("#startDate").value) { $("#startDate").value = date; $("#endDate").value = ""; }
    else { $("#endDate").value = date; rangeEdge = "start"; }
  }
  renderCalendar();
  saveDraft();
  document.querySelector(`[data-date="${date}"]`)?.focus();
}
function moveMonth(delta) {
  const date = new Date(calendarMonth + "-01T12:00:00Z");
  date.setUTCMonth(date.getUTCMonth() + delta);
  calendarMonth = date.toISOString().slice(0, 7);
  renderCalendar();
  saveDraft();
}
function renderCalendar() {
  const today = C.today();
  const maximum = new Date(Date.parse(today + "T12:00:00Z") + 365 * 86400000).toISOString().slice(0, 10);
  if (calendarMonth < today.slice(0, 7)) calendarMonth = today.slice(0, 7);
  if (calendarMonth > maximum.slice(0, 7)) calendarMonth = maximum.slice(0, 7);
  const first = new Date(calendarMonth + "-01T12:00:00Z");
  $("#calendarMonth").textContent = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(first).replace(" de ", " ");
  $("#previousMonth").disabled = calendarMonth <= today.slice(0, 7);
  $("#nextMonth").disabled = calendarMonth >= maximum.slice(0, 7);
  const from = $("#startDate").value, to = $("#endDate").value, selected = selectedDates();
  $("#startDateButton").textContent = from ? formatDate(from) : "Selecionar";
  $("#endDateButton").textContent = to ? formatDate(to) : "Selecionar";
  $("#startDateButton").setAttribute("aria-pressed", String(rangeEdge === "start"));
  $("#endDateButton").setAttribute("aria-pressed", String(rangeEdge === "end"));
  const days = $("#calendarDays"); days.replaceChildren();
  for (let n = 0; n < first.getUTCDay(); n++) { const blank = document.createElement("span"); blank.setAttribute("aria-hidden", "true"); days.append(blank); }
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  for (let day = 1; day <= last; day++) {
    const date = calendarMonth + "-" + String(day).padStart(2, "0");
    const button = document.createElement("button"); button.type = "button"; button.dataset.date = date;
    button.textContent = String(day); button.setAttribute("aria-label", formatDate(date));
    button.disabled = date < today || date > maximum;
    const pressed = mode === "specific" ? selected.includes(date) : date === from || date === to || (from && to && date >= from && date <= to);
    button.setAttribute("aria-pressed", String(Boolean(pressed)));
    if (mode === "range" && (date === from || date === to)) button.classList.add("is-endpoint");
    if (mode === "range" && pressed && from && to && from !== to) {
      button.classList.add(date === from ? "is-range-start" : date === to ? "is-range-end" : "is-range-middle");
    }
    if (date === today) button.setAttribute("aria-current", "date");
    button.addEventListener("click", () => chooseDate(date)); days.append(button);
  }
  const chips = $("#selectedDates"); chips.replaceChildren();
  selected.forEach((date, i) => {
    const button = document.createElement("button"); button.type = "button"; button.textContent = `${i + 1}. ${formatDate(date)} ×`;
    button.setAttribute("aria-label", `Remover ${formatDate(date)}`); button.addEventListener("click", () => chooseDate(date)); chips.append(button);
  });
  $("#calendarHint").textContent = mode === "specific" ? "Clique nas datas em ordem de preferência. Clique novamente para remover." : rangeEdge === "end" ? "Agora selecione a data final do período." : "Selecione a data inicial do período.";
  updateRangeSummary();
  renderPresentation();
}

function updateRangeSummary() {
  const summary = $("#rangeSummary");
  summary.hidden = mode !== "range";
  const from = $("#startDate").value, to = $("#endDate").value;
  summary.textContent = validIso(from) && validIso(to) ? `De ${formatDate(from)} até ${formatDate(to)}, incluindo os dois dias.` : "Escolha a data inicial e a final.";
}

function updateInterval() {
  const seconds = Number($("#interval").value);
  $("#intervalOutput").textContent = seconds < 60 ? `${seconds} s` : `${seconds / 60} min`;
}

function updateStartAllAvailability() {
  const compatibleCount = overview?.tabs.filter(tab => tab.supportedPage).length || 0;
  $("#startAll").disabled = compatibleCount === 0;
  $("#startAll").title = "Cada aba usará automaticamente seu próprio ID de envio.";
}

function renderOverview(data) {
  overview = data;
  const state = $("#pageState");
  const text = $("#pageStateText");
  const activeRow = data.tabs.find(tab => tab.id === data.activeTabId);
  const search = activeRow?.search;
  activeSearch = search || null;
  const detectedId = activeRow?.shipmentId || search?.config?.shipmentId;
  $("#shipmentDetected").textContent = detectedId ? `Envio #${detectedId}` : "Envio não identificado";
  $("#shipmentDetected").title = detectedId ? "Identificado automaticamente pela aba" : "Abra a edição da coleta para identificar o envio automaticamente.";
  const recoveryNames = { error: "tela de erro", management: "Gestão de envios", preparation: "preparação do envio" };
  const canResume = search?.status === "needs_attention" && Boolean(search.config?.shipmentId) &&
    Boolean(data.activeRecoveryStep || data.activeSchedulePage);
  state.className = "page-state";
  if (search?.running || search?.status === "recovering") {
    state.classList.add("is-running");
    text.textContent = search.status === "recovering"
      ? "Recuperando envio"
      : search.status === "scanning" ? "Lendo calendário" : search.status === "loading" ? "Carregando página" : "Busca ativa";
  } else if (["found", "confirmed", "satisfied", "needs_attention", "confirming"].includes(search?.status)) {
    state.classList.add(search.status === "needs_attention" ? "is-error" : "is-ready");
    text.textContent = {found: "Data encontrada", confirmed: "Coleta confirmada", satisfied: "Data já atendida", needs_attention: "Busca pausada", confirming: "Confirmando coleta"}[search.status];
  } else if (data.activeRecoveryStep) {
    state.classList.add("is-error");
    text.textContent = `Etapa detectada: ${recoveryNames[data.activeRecoveryStep] || "recuperação"}. Você pode retomar abaixo.`;
  } else if (data.activeSupportedPage) {
    state.classList.add("is-ready");
    text.textContent = "Pronto para buscar";
  } else {
    state.classList.add("is-error");
    text.textContent = data.activePageMessage || "Abra a tela de agendamento do Full.";
  }
  $("#startActive").disabled = !data.activeSupportedPage || Boolean(data.activeRecoveryStep);
  $("#resumeSearch").hidden = !canResume;
  updateStartAllAvailability();
  $("#stopAll").disabled = !data.tabs.some(tab => tab.search);
  renderSearches(data.tabs);
  renderRefreshCounter();
  renderErrorLog(data.errorLog || []);
  renderPresentation();
}

// Apresentação apenas: não altera a busca nem autoriza operações ao editar o formulário.
function renderPresentation() {
  const busy = Boolean(activeSearch?.running || ["recovering", "confirming"].includes(activeSearch?.status));
  let pending = false;
  if (busy) {
    try {
      const draft = readConfig(), current = C.normalizeConfig(activeSearch.config);
      pending = draft.mode !== current.mode || draft.intervalSeconds !== current.intervalSeconds || draft.autoConfirm !== current.autoConfirm ||
        (draft.mode === "range" ? draft.startDate !== current.startDate || draft.endDate !== current.endDate : JSON.stringify(draft.dates) !== JSON.stringify(current.dates));
    } catch { pending = true; }
  }
  $("#pendingChanges").hidden = !pending;
  const compactDates = busy && !pending && !datesEditing;
  $("#rangeFields").hidden = mode !== "range" || compactDates;
  $("#calendarHint").hidden = compactDates;
  $("#editDates").hidden = !compactDates;
  $("#stopActive").hidden = !busy;
  const canResume = !$("#resumeSearch").hidden;
  $("#startActive").hidden = canResume || (busy && !pending);
  $("#startActiveLabel").textContent = busy && pending ? "Aplicar e reiniciar busca" : "Iniciar busca nesta aba";
  $(".primary-actions").classList.toggle("has-pending", pending);
  $("#datesHeading").textContent = busy && !pending ? "Datas monitoradas" : pending ? "Próximas datas" : "Suas datas preferidas";
  $("#confirmDescription").textContent = $("#autoConfirm").checked
    ? "Ligada: pode alterar a reserva ao encontrar."
    : "Desligada: só avisa ao encontrar.";
  const from = $("#startDate").value, to = $("#endDate").value;
  if (mode === "specific") {
    const dates = selectedDates();
    $("#datesSummary").textContent = dates.length ? `${dates.length} data${dates.length === 1 ? "" : "s"} em ordem de preferência` : "Escolha suas datas no calendário";
  } else if (validIso(from) && validIso(to) && from <= to) {
    const month = new Intl.DateTimeFormat("pt-BR", {month:"long",timeZone:"UTC"}).format(new Date(from + "T12:00:00Z"));
    $("#datesSummary").textContent = from.slice(0,7) === to.slice(0,7)
      ? `${Number(from.slice(8))}${from === to ? "" : " — " + Number(to.slice(8))} ${month}`
      : `${formatDate(from)} — ${formatDate(to)}`;
  } else $("#datesSummary").textContent = "Escolha o início e o fim do período";
}

function renderMonitor(search) {
  const panel = $("#monitorPanel"), clock = $("#monitorClock"), title = $("#monitorTitle"), interval = $("#monitorInterval");
  const progress = $("#cadenceProgress"), message = $("#monitorMessage");
  panel.className = "monitor"; panel.setAttribute("aria-label", "Andamento da busca"); progress.hidden = true; message.textContent = "";
  clock.textContent = "—"; interval.textContent = "";
  if (search?.running && search.status === "monitoring") {
    panel.classList.add("is-counting");
    const cadence = C.cadenceStatus(search);
    const seconds = Number(search.effectiveIntervalSeconds || search.config?.intervalSeconds) || 15;
    const remaining = Number(search.nextRefreshAt) ? Math.ceil((search.nextRefreshAt - Date.now()) / 1000) : seconds;
    clock.textContent = formatDuration(remaining);
    panel.setAttribute("aria-label", "Próxima verificação em " + formatDuration(remaining));
    title.textContent = remaining > 0 ? "Próxima verificação" : "Aguardando atualização";
    interval.textContent = "Intervalo atual · " + seconds + " s";
    progress.hidden = false;
    const count = cadence.probeRemaining ? 5 - cadence.probeRemaining : cadence.stableChecks;
    const total = cadence.probeRemaining ? 5 : cadence.requiredChecks;
    const minimum = !cadence.probeRemaining && cadence.intervalSeconds <= cadence.minimumSeconds;
    $("#stabilityProgress").max = minimum ? 1 : total;
    $("#stabilityProgress").value = minimum ? 1 : Math.min(count, total);
    $("#stabilityText").textContent = minimum ? "Intervalo mínimo atingido" : `${count} de ${total} verificações estáveis`;
    $("#nextIntervalText").textContent = minimum ? "Busca otimizada" : cadence.probeRemaining ? "Testando intervalo menor" : `Depois, tenta ${cadence.nextSeconds} s`;
    $("#stabilityProgress").setAttribute("aria-valuetext", $("#stabilityText").textContent);
    return;
  }
  const states = {
    recovering: ["Recuperando envio", "Voltando ao calendário", "A busca continua após a recuperação."],
    scanning: ["Lendo calendário", "Verificação em andamento", "Aguarde a leitura terminar."],
    loading: ["Carregando página", "Verificação em andamento", "Aguardando os controles do Mercado Livre."],
    selecting: ["Selecionando data", "Seleção autorizada", "A extensão aguarda esta etapa terminar."],
    confirming: ["Confirmando coleta", "Confirmação em andamento", "Aguarde a conclusão antes de fazer alterações."],
    found: ["Data encontrada", formatDate(search?.foundDate), "A reserva foi preservada. Confirme manualmente na aba."],
    confirmed: ["Coleta confirmada", formatDate(search?.foundDate), "Busca encerrada com sucesso."],
    satisfied: ["Sua data já atende", "Busca concluída", "Nenhuma alteração foi feita na reserva."],
    needs_attention: ["Busca pausada", "Confira a página", search?.resultMessage || "Retome a busca quando a página estiver pronta."]
  };
  const state = states[search?.status];
  if (state) { title.textContent = state[0]; interval.textContent = state[1]; message.textContent = state[2]; }
  else { panel.classList.add("is-idle"); title.textContent = "Encontre a melhor data"; interval.textContent = "Escolha suas preferências e inicie a busca."; }
}

function formatDuration(seconds) {
  const value = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(value / 60);
  const remainder = String(value % 60).padStart(2, "0");
  return String(minutes).padStart(2, "0") + ":" + remainder;
}

function intervalLabel(seconds) {
  if (seconds < 60) return "a cada " + seconds + " s";
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder
    ? "a cada " + minutes + " min " + remainder + " s"
    : "a cada " + minutes + " min";
}

function renderRefreshCounter() {
  const title = $("#refreshCountdown");
  const detail = $("#refreshDetail");
  const search = activeSearch;
  renderMonitor(search);
  if (search?.running && search.status === "monitoring") {
    const seconds = Number(search.effectiveIntervalSeconds || search.config?.intervalSeconds) || 15;
    const remaining = Number(search.nextRefreshAt)
      ? Math.ceil((search.nextRefreshAt - Date.now()) / 1000)
      : seconds;
    title.textContent = "Próximo refresh em " + formatDuration(remaining);
    detail.textContent = intervalLabel(seconds) + (search.lastRefreshAt
      ? " · último pedido há " + formatDuration((Date.now() - search.lastRefreshAt) / 1000)
      : " · aguardando a primeira atualização") + " · estimativa do Chrome";
    const cadence = C.cadenceStatus(search);
    detail.textContent += cadence.probeRemaining
      ? ` · Testando intervalo menor: ${5 - cadence.probeRemaining}/5 verificações estáveis.`
      : cadence.intervalSeconds > cadence.minimumSeconds
        ? ` · ${cadence.stableChecks}/${cadence.requiredChecks} verificações estáveis; próxima tentativa: ${cadence.nextSeconds} s.`
        : " · Intervalo mínimo atingido.";
    return;
  }
  if (search?.status === "recovering") {
    title.textContent = "Refresh pausado durante a recuperação";
    detail.textContent = "A busca volta a atualizar a página quando retornar ao calendário.";
    return;
  }
  if (["scanning", "loading", "selecting"].includes(search?.status)) {
    title.textContent = search.status === "selecting" ? "Selecionando a data autorizada" : "Verificação em andamento";
    detail.textContent = "A extensão aguarda esta etapa terminar antes de recarregar.";
    return;
  }
  if (search?.status === "satisfied") {
    title.textContent = "A data atual já atende à busca";
    detail.textContent = "Nenhuma alteração foi feita na reserva.";
    return;
  }
  if (search?.status === "confirming") {
    title.textContent = "Refresh pausado enquanto a data é confirmada";
    detail.textContent = "A extensão está concluindo a seleção do agendamento.";
    return;
  }
  if (search?.status === "found") {
    title.textContent = "Data " + formatDate(search.foundDate) + " disponível";
    detail.textContent = "A reserva foi preservada. Escolha e confirme a data manualmente.";
    return;
  }
  if (search?.status === "confirmed") {
    title.textContent = "Coleta confirmada para " + formatDate(search.foundDate);
    detail.textContent = "Busca encerrada com sucesso.";
    return;
  }
  if (search?.status === "needs_attention") {
    title.textContent = "Busca pausada; precisa de atenção";
    detail.textContent = "Confira a página e use Retomar busca quando estiver pronta.";
    return;
  }
  title.textContent = "Inicie uma busca para acompanhar o refresh.";
  detail.textContent = "O intervalo escolhido aparece aqui durante a busca.";
}

function renderErrorLog(logs) {
  const rows = $("#errorLogRows");
  const empty = $("#errorLogEmpty");
  const exportButton = $("#exportErrorLog");
  rows.replaceChildren();
  $("#errorLogCount").textContent = String(logs.length);
  empty.hidden = logs.length > 0;
  exportButton.disabled = logs.length === 0;
  for (const entry of logs.slice(0, 6)) {
    const row = document.createElement("article");
    row.className = "diagnostic-row" + (entry.severity === "warning" ? " is-warning" : "");
    const heading = document.createElement("div");
    heading.className = "diagnostic-heading";
    const source = document.createElement("strong");
    source.textContent = [entry.source, entry.stage].filter(Boolean).join(" · ") || "Extensão";
    const date = document.createElement("time");
    const timestamp = new Date(entry.timestamp);
    date.textContent = Number.isNaN(timestamp.valueOf())
      ? ""
      : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(timestamp);
    heading.append(source, date);
    const message = document.createElement("p");
    message.textContent = entry.message || "Falha sem detalhes.";
    row.append(heading, message);
    rows.append(row);
  }
}

function exportErrorLog() {
  const logs = overview?.errorLog || [];
  if (!logs.length) return;
  const blob = new Blob([JSON.stringify(logs, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "full-radar-erros-" + new Date().toISOString().slice(0, 10) + ".json";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderSearches(tabs) {
  const searches = tabs.filter(tab => tab.search);
  const section = $("#searchList");
  const rows = $("#searchRows");
  section.hidden = searches.length === 0;
  $("#searchCount").textContent = String(searches.length);
  rows.replaceChildren();
  for (const tab of searches) {
    const row = document.createElement("div");
    row.className = "search-row";
    const indicator = document.createElement("span");
    const active = tab.search.running || tab.search.status === "recovering";
    indicator.className = `search-indicator${active ? "" : " is-done"}`;
    const copy = document.createElement("div");
    copy.className = "search-copy";
    const title = document.createElement("strong");
    title.textContent = tab.title;
    const detail = document.createElement("small");
    detail.textContent = searchStatus(tab.search);
    copy.append(title, detail);
    const stop = document.createElement("button");
    stop.type = "button";
    stop.className = "stop-one";
    stop.textContent = active ? "Parar" : tab.search.status === "confirming" ? "Cancelar" : "Limpar";
    stop.addEventListener("click", async () => {
      await send({ type: "STOP_SEARCH", tabId: tab.id });
      await refresh();
    });
    row.append(indicator, copy, stop);
    rows.append(row);
  }
}

function searchStatus(search) {
  if (search.status === "monitoring") return `${search.checks || 0} verificações · ${search.resultMessage || "Procurando datas…"}`;
  if (search.status === "scanning") return "Lendo o calendário, sem recarregar durante a leitura…";
  if (search.status === "loading") return "Aguardando o Mercado Livre carregar…";
  if (search.status === "selecting") return `Selecionando ${formatDate(search.foundDate)}…`;
  if (search.status === "satisfied") return "A data atual já atende à preferência; reserva preservada.";
  if (search.status === "recovering") return `Retomando o envio #${search.config?.shipmentId || ""}…`;
  if (search.status === "confirming") return `Confirmando ${formatDate(search.foundDate)}…`;
  if (search.status === "confirmed") return `Agendado para ${formatDate(search.foundDate)}`;
  if (search.status === "needs_attention") return search.foundDate
    ? `Verifique ${formatDate(search.foundDate)} na aba`
    : search.resultMessage || "A retomada foi pausada; confira a aba.";
  if (search.status === "found") return `Data ${formatDate(search.foundDate)} encontrada`;
  return "Busca encerrada";
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const data = await send({ type: "GET_OVERVIEW" });
    renderOverview(data);
    if (!initialized) {
      const active = data.tabs.find(tab => tab.id === data.activeTabId);
      if (!hasDraft && !formTouched) {
        if (active?.search?.config) loadConfig(active.search.config);
        else if (data.lastConfig) loadConfig(data.lastConfig);
      }
      updateStartAllAvailability();
      initialized = true;
    }
    if (!telegramInitialized) {
      telegramInitialized = true;
      await refreshTelegramStatus();
    }
  } catch (error) {
    setMessage("Não consegui consultar o estado da extensão. Reabra o popup.");
    send({
      type: "LOG_ERROR",
      source: "Popup",
      stage: "consulta do estado",
      message: error?.message || String(error)
    }).catch(() => {});
  } finally { refreshing = false; }
}

function renderTelegramStatus(status) {
  telegramStatus = status;
  const panel = $("#telegramPanel");
  panel.hidden = false;
  const badge = $("#telegramBadge");
  const description = $("#telegramDescription");
  const message = $("#telegramMessage");
  const connect = $("#telegramConnect");
  const openBot = $("#telegramOpenBot");
  const check = $("#telegramCheck");
  const disconnect = $("#telegramDisconnect");
  badge.className = "telegram-badge";
  message.textContent = status.error || "";
  if (!status.available) {
    badge.textContent = "configuração pendente";
    description.textContent = "O aviso privado será liberado quando o bot e o serviço do FullRadar estiverem configurados.";
    connect.textContent = "Telegram ainda indisponível";
    connect.disabled = true;
    openBot.hidden = true;
    check.hidden = true;
    disconnect.hidden = true;
    return;
  }
  connect.disabled = false;
  if (status.connected) {
    badge.textContent = "conectado";
    badge.classList.add("is-connected");
    description.textContent = "Pronto. Você receberá uma mensagem privada quando o agendamento for confirmado.";
    connect.hidden = true;
    openBot.hidden = true;
    check.hidden = true;
    disconnect.hidden = false;
    return;
  }
  disconnect.hidden = true;
  connect.hidden = false;
  if (status.pending) {
    badge.textContent = "aguardando";
    badge.classList.add("is-pending");
    description.textContent = "Abra o bot no Telegram, toque em Iniciar e depois volte aqui para verificar.";
    openBot.hidden = false;
    check.hidden = false;
    connect.textContent = "Gerar novo link";
  } else {
    badge.textContent = "desconectado";
    description.textContent = "Conecte uma vez para receber a confirmação do agendamento por mensagem privada.";
    openBot.hidden = true;
    check.hidden = true;
    connect.textContent = status.authorizationRequired ? "Permitir e conectar" : "Conectar Telegram";
  }
}

async function refreshTelegramStatus() {
  try {
    const status = await send({ type: "GET_TELEGRAM_STATUS" });
    renderTelegramStatus(status || { available: false });
  } catch (error) {
    renderTelegramStatus({ available: true, error: error?.message || "Não consegui consultar a conexão." });
  }
}

async function connectTelegram() {
  const config = globalThis.FULLRADAR_TELEGRAM_CONFIG || {};
  let originPattern;
  try {
    const gateway = new URL(config.gatewayUrl || "");
    if (gateway.protocol !== "https:" || gateway.pathname !== "/" || gateway.search || gateway.hash) {
      throw new Error("O serviço do Telegram ainda não está configurado corretamente.");
    }
    originPattern = `${gateway.origin}/*`;
  } catch (error) {
    $("#telegramMessage").textContent = error.message || "O serviço do Telegram ainda não está configurado.";
    return;
  }
  try {
    const permitted = await chrome.permissions.request({ origins: [originPattern] });
    if (!permitted) {
      $("#telegramMessage").textContent = "O acesso ao serviço do FullRadar é necessário para conectar o bot.";
      return;
    }
    $("#telegramConnect").disabled = true;
    $("#telegramMessage").textContent = "Preparando o link seguro…";
    const result = await send({ type: "START_TELEGRAM_PAIRING" });
    if (!result?.ok) throw new Error(result?.error || "Não consegui iniciar a conexão.");
    await refreshTelegramStatus();
    await chrome.tabs.create({ url: result.startUrl, active: true });
  } catch (error) {
    $("#telegramMessage").textContent = error?.message || "Não consegui abrir o Telegram.";
  } finally {
    $("#telegramConnect").disabled = false;
  }
}

async function verifyTelegramConnection() {
  $("#telegramMessage").textContent = "Verificando…";
  await refreshTelegramStatus();
  if (telegramStatus?.connected) {
    $("#telegramMessage").textContent = "Conectado. Os próximos agendamentos confirmados chegarão no privado.";
  } else if (!telegramStatus?.error) {
    $("#telegramMessage").textContent = "Ainda não conectado. No Telegram, toque em Iniciar no bot e tente novamente.";
  }
}

async function disconnectTelegram() {
  $("#telegramDisconnect").disabled = true;
  try {
    const result = await send({ type: "DISCONNECT_TELEGRAM" });
    if (!result?.ok) throw new Error(result?.error || "Não consegui desconectar o Telegram.");
    await refreshTelegramStatus();
  } catch (error) {
    $("#telegramMessage").textContent = error?.message || "Não consegui desconectar o Telegram.";
  } finally {
    $("#telegramDisconnect").disabled = false;
  }
}

async function start(scope) {
  setMessage("");
  if (!overview) return;
  let config;
  try {
    config = readConfig();
    C.validateConfig(config);
    if (scope === "all" && config.shipmentId) {
      throw new Error("Para recuperar um envio específico, inicie a busca somente nesta aba.");
    }
  } catch (error) {
    setMessage(error.message);
    return;
  }
  const response = await send({ type: "START_SEARCH", scope, tabId: overview.activeTabId, config });
  const started = response?.results?.filter(result => result.ok) || [];
  const errors = response?.results?.filter(result => !result.ok) || [];
  if (started.length) {
    datesEditing = false;
    setMessage(scope === "all"
      ? `Busca iniciada em ${started.length} aba(s) compatível(is).`
      : "Busca iniciada. Esta aba será recarregada no intervalo escolhido.", true);
  }
  if (errors.length) setMessage(errors.map(result => result.error).join(" "));
  await refresh();
}

async function resumeActive() {
  setMessage("");
  if (!overview?.activeTabId) return;
  let config;
  try { config = readConfig(); C.validateConfig(config); } catch (error) { setMessage(error.message); return; }
  const response = await send({ type: "RESUME_SEARCH", tabId: overview.activeTabId, shipmentId: config.shipmentId, config });
  if (!response?.ok) setMessage(response?.error || "Não consegui retomar a busca nesta aba.");
  else setMessage(response.message || "Busca retomada.", true);
  await refresh();
}

document.querySelectorAll(".mode-button").forEach(button => button.addEventListener("click", () => { setMode(button.dataset.mode); saveDraft(); }));
$("#interval").addEventListener("input", () => { updateInterval(); saveDraft(); });
$("#dates").addEventListener("input", () => { renderCalendar(); saveDraft(); });
$("#autoConfirm").addEventListener("change", saveDraft);
$("#previousMonth").addEventListener("click", () => moveMonth(-1));
$("#nextMonth").addEventListener("click", () => moveMonth(1));
for (const edge of ["start", "end"]) $("#" + edge + "DateButton").addEventListener("click", () => {
  rangeEdge = edge; const date = $("#" + edge + "Date").value;
  if (validIso(date)) calendarMonth = date.slice(0, 7);
  renderCalendar(); saveDraft();
});
$("#startActive").addEventListener("click", () => start("active"));
$("#editDates").addEventListener("click", () => { datesEditing = true; renderPresentation(); (mode === "range" ? $("#startDateButton") : $("#calendarDays button:not(:disabled)"))?.focus(); });
$("#stopActive").addEventListener("click", async () => {
  if (!overview?.activeTabId) return;
  await send({ type: "STOP_SEARCH", tabId: overview.activeTabId });
  setMessage("Busca interrompida.", true);
  await refresh();
});
$("#openSettings").addEventListener("click", () => {
  $("#advancedOptions").open = true;
  $("#advancedOptions").querySelector("summary").focus();
  $("#advancedOptions").scrollIntoView({ block: "start" });
});
$("#advancedOptions").addEventListener("toggle", () => $("#openSettings").setAttribute("aria-expanded", String($("#advancedOptions").open)));
$("#resumeSearch").addEventListener("click", resumeActive);
$("#startAll").addEventListener("click", () => start("all"));
$("#stopAll").addEventListener("click", async () => {
  await send({ type: "STOP_ALL" });
  setMessage("Todas as buscas foram interrompidas.", true);
  await refresh();
});
$("#exportErrorLog").addEventListener("click", exportErrorLog);
$("#telegramConnect").addEventListener("click", connectTelegram);
$("#telegramOpenBot").addEventListener("click", async () => {
  if (telegramStatus?.startUrl) await chrome.tabs.create({ url: telegramStatus.startUrl, active: true });
});
$("#telegramCheck").addEventListener("click", verifyTelegramConnection);
$("#telegramDisconnect").addEventListener("click", disconnectTelegram);

renderCalendar();
restoreDraft().finally(() => { refresh(); setInterval(refresh, 2500); });
setInterval(renderRefreshCounter, 1000);
