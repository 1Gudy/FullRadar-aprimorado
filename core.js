(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FullRadarCore = api;
})(globalThis, function () {
  "use strict";
  const AUTOMATION_VERSION = 2;
  const DAY = 86400000;
  const normalize = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const months = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  function isIsoDate(value) {
    if (typeof value !== "string" || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) return false;
    const time = Date.parse(value + "T12:00:00Z");
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
  }
  function today(now = new Date()) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  }
  function shipmentId(url) {
    try { return new URL(url).pathname.match(/^\/shipping\/inbounds\/(\d{6,20})(?:\/|$)/)?.[1] || ""; } catch { return ""; }
  }
  function isMarketplaceUrl(url) {
    try {
      const u = new URL(url);
      return u.protocol === "https:" && (u.hostname === "mercadolivre.com.br" || u.hostname.endsWith(".mercadolivre.com.br") || u.hostname === "mercadolibre.com" || u.hostname.endsWith(".mercadolibre.com"));
    } catch { return false; }
  }
  const INTERVAL_MIN = 5, INTERVAL_MAX = 30, INTERVAL_STEP = 5, INTERVAL_DEFAULT = 15;
  // Intervalo fixo escolhido pelo usuário: de 5 em 5 s, entre 5 e 30 s.
  function intervalSeconds(value) {
    const seconds = Math.round((Number(value) || INTERVAL_DEFAULT) / INTERVAL_STEP) * INTERVAL_STEP;
    return Math.max(INTERVAL_MIN, Math.min(INTERVAL_MAX, seconds));
  }
  function normalizeConfig(config = {}) {
    return {
      mode: config.mode === "range" ? "range" : "specific",
      dates: Array.isArray(config.dates) ? [...new Set(config.dates.filter(isIsoDate))] : [],
      startDate: isIsoDate(config.startDate) ? config.startDate : "",
      endDate: isIsoDate(config.endDate) ? config.endDate : "",
      intervalSeconds: intervalSeconds(config.intervalSeconds),
      shipmentId: String(config.shipmentId || "").trim().replace(/^#/, ""),
      // Configurações antigas não autorizam uma nova implementação a confirmar.
      autoConfirm: config.autoConfirm === true && config.automationVersion === AUTOMATION_VERSION,
      automationVersion: AUTOMATION_VERSION
    };
  }
  function requestedDates(config, minimum = "") {
    let result;
    if (config.mode === "range") {
      if (!isIsoDate(config.startDate) || !isIsoDate(config.endDate) || config.startDate > config.endDate) return [];
      const from = Date.parse(config.startDate + "T12:00:00Z");
      const to = Date.parse(config.endDate + "T12:00:00Z");
      if ((to - from) / DAY > 365) return [];
      result = [];
      for (let t = from; t <= to; t += DAY) result.push(new Date(t).toISOString().slice(0, 10));
    } else result = [...new Set((config.dates || []).filter(isIsoDate))];
    return result.filter(date => !minimum || date >= minimum);
  }
  function validateConfig(config, minimum = today()) {
    if (config.shipmentId && !/^\d{6,20}$/.test(config.shipmentId)) throw new Error("Informe somente os dígitos do ID do envio (6 a 20).");
    const dates = requestedDates(config, minimum);
    if (!dates.length) throw new Error("Informe datas válidas a partir de hoje. O período pode ter no máximo 366 dias.");
    const maximum = new Date(Date.parse(minimum + "T12:00:00Z") + 365 * DAY).toISOString().slice(0, 10);
    if (dates.some(date => date > maximum)) throw new Error("Escolha datas dentro dos próximos 12 meses.");
    return dates;
  }
  function monthIn(text) {
    const match = normalize(text).match(new RegExp("\\b(" + months.join("|") + ")\\s+(20\\d{2})\\b"));
    return match ? `${match[2]}-${String(months.indexOf(match[1]) + 1).padStart(2, "0")}` : "";
  }
  function labelMatchesDate(label, date) {
    if (!isIsoDate(date)) return false;
    const source = normalize(label);
    const [year, month, day] = date.split("-").map(Number);
    const explicit = source.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
    if (explicit) return explicit[0] === date;
    const numeric = source.match(/\b(\d{1,2})[/.](\d{1,2})(?:[/.](20\d{2}))?\b/);
    if (numeric) return Number(numeric[1]) === day && Number(numeric[2]) === month && (!numeric[3] || Number(numeric[3]) === year);
    const human = source.match(new RegExp("\\b(\\d{1,2})\\s+(?:de\\s+)?(" + months.join("|") + ")(?:\\s+(?:de\\s+)?(20\\d{2}))?\\b"));
    return Boolean(human && Number(human[1]) === day && months.indexOf(human[2]) + 1 === month && (!human[3] || Number(human[3]) === year));
  }
  function monthDistance(from, to) {
    const [fy, fm] = from.split("-").map(Number), [ty, tm] = to.split("-").map(Number);
    return (ty - fy) * 12 + tm - fm;
  }
  return { AUTOMATION_VERSION, normalize, months, isIsoDate, today, shipmentId, isMarketplaceUrl, normalizeConfig, requestedDates, validateConfig, monthIn, labelMatchesDate, monthDistance, intervalSeconds, INTERVAL_MIN, INTERVAL_MAX, INTERVAL_STEP };
});
