(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./core.js"));
  else root.FullRadarDOM = factory(root.FullRadarCore);
})(globalThis, function (C) {
  "use strict";
  function create(doc, location, options = {}) {
    const view = doc.defaultView;
    const visible = options.visible || (element => {
      if (!element?.isConnected || element.closest("[hidden],[aria-hidden='true']")) return false;
      const style = view.getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) !== 0 && element.getClientRects().length > 0;
    });
    const text = e => e?.innerText || (e?.childNodes ? [...e.childNodes].map(n => n.nodeType === 3 ? n.textContent : text(n)).join(" ") : e?.textContent || "");
    const all = (selector, scope = doc) => [...scope.querySelectorAll(selector)].filter(visible);
    const unique = elements => elements.length === 1 ? elements[0] : null;
    const disabled = e => !e || e.disabled || e.hasAttribute("disabled") || e.getAttribute("aria-disabled") === "true" || /disabled|outside.?month|other.?month|adjacent/i.test(String(e.className || ""));
    const routeId = () => C.shipmentId(location.href);
    const dateInput = () => unique(all("input[aria-label='Data da coleta'],input[data-testid='date-picker-input']"));
    // Verificação barata, usada antes de cada ação: não lê o texto da página.
    function challenge() {
      return /\/login|\/auth|\/registration|\/account-verification/.test(location.pathname) || all("iframe[src*='captcha'],iframe[src*='recaptcha'],[id*='captcha']").length > 0;
    }
    // O servidor do ML envia o estado do agendamento junto com a página
    // (observado em 04/11/2026): _n.ctx.r={...appProps.pageProps.data...}.
    // Cada ciclo recarrega a aba, então esse estado é sempre o da leitura atual.
    let serverCache = { node: null, length: -1, data: null };
    function firstJson(source) {
      const start = source.indexOf("{");
      if (start < 0) return null;
      let depth = 0, inString = false, escaped = false;
      for (let i = start; i < source.length; i++) {
        const ch = source[i];
        if (inString) {
          if (escaped) escaped = false;
          else if (ch === "\\") escaped = true;
          else if (ch === '"') inString = false;
        } else if (ch === '"') inString = true;
        else if (ch === "{") depth++;
        else if (ch === "}" && --depth === 0) return JSON.parse(source.slice(start, i + 1));
      }
      return null;
    }
    function serverData() {
      const node = doc.getElementById("__NORDIC_RENDERING_CTX__");
      if (!node) return null;
      const source = node.textContent || "";
      if (serverCache.node !== node || serverCache.length !== source.length) {
        let data = null;
        try { data = firstJson(source)?.appProps?.pageProps?.data || null; } catch { data = null; }
        serverCache = { node, length: source.length, data };
      }
      const data = serverCache.data;
      return data && String(data.inboundId) === routeId() ? data : null;
    }
    function pickupDisabledByServer() {
      const types = serverData()?.availableShipmentTypes;
      const pickup = Array.isArray(types) ? types.find(type => type?.type === "pickup") : null;
      return Boolean(pickup && pickup.enabled === false);
    }
    function pageInfo() {
      const path = location.pathname;
      const scope = doc.querySelector(".inbound__flow-container,main,#root-app") || doc.body;
      const content = C.normalize(text(scope));
      const headings = all("h1,h2,h3,[role='heading']").map(e => C.normalize(text(e))).join(" ");
      const blocked = challenge();
      const isInbound = /^\/shipping\/inbounds(?:\/|$)/.test(path);
      const errorPage = /ocorreu um erro|algo deu errado|algo saiu errado|nao foi possivel carregar|estamos com problemas|tente novamente mais tarde/.test(content);
      const schedulePage = Boolean(!errorPage && routeId() && /\/appointment(?:-v\d+)?\/?$/.test(path) && /agende uma data|escolha como voce deseja envia|escolha quando quer que a coleta passe/.test(headings));
      // O ML usa dois avisos: por endereço ou pela própria forma de envio.
      // O segundo precisa ser uma mensagem visível, não tooltip de um dia.
      const noMethodDates = all(".andes-message__text", scope).some(e => /^nao ha datas disponiveis(?:\.|$)/.test(C.normalize(text(e))));
      // Aviso geral, antes de escolher a forma de envio: o seletor fica desativado.
      const noPickup = schedulePage && (pickupDisabledByServer() ||
        all(".andes-message__text", scope).some(e => /^(?:nao temos datas disponiveis no momento|no momento,? nao ha datas disponiveis)/.test(C.normalize(text(e)))));
      const noCollectionDates = schedulePage && (noPickup || /centros? de distribuicao proximos nao (?:tem|possuem) datas? disponiveis/.test(content) || noMethodDates);
      let recoveryStep = "";
      if (!blocked && !schedulePage && isInbound) {
        if (errorPage) recoveryStep = "error";
        else if (!routeId() && /gestao de envios/.test(headings)) recoveryStep = "management";
        else if (routeId() && /preparacao do envio/.test(headings)) recoveryStep = "preparation";
      }
      return {
        supported: schedulePage, schedulePage, shipmentId: routeId(), recoveryStep, noCollectionDates, noPickup,
        // Só indicadores de carregamento da área do envio; widgets do cabeçalho não atrasam a leitura.
        challenge: blocked, busy: Boolean(all("[aria-busy='true'],[role='progressbar']", scope).length),
        message: blocked ? "Login ou verificação do Mercado Livre: conclua manualmente e retome." : schedulePage ? "Página de agendamento reconhecida." : recoveryStep ? "Etapa de recuperação do envio detectada." : "A página ainda não está pronta ou o formato mudou."
      };
    }
    function calendar() {
      const root = unique(all("table.focus-ui-datepicker__content"));
      if (!root) return null;
      const month = C.monthIn(text(root.querySelector(".focus-ui-datepicker__content__month-year")));
      if (!month) return null;
      const cells = [...root.querySelectorAll("tr.focus-ui-datepicker__content__week td")];
      const first = cells.findIndex(cell => text(cell.querySelector(".day")).trim() === "1");
      if (first < 0) return null;
      const [year, m] = month.split("-").map(Number);
      const days = new Date(Date.UTC(year, m, 0)).getUTCDate();
      const entries = cells.flatMap((cell, index) => {
        const day = cell.querySelector(".day");
        if (!day || !visible(day) || index < first || index >= first + days) return [];
        const number = Number(text(day).trim());
        // Falhar fechado se a grade não representar dias consecutivos.
        if (number !== index - first + 1) return [];
        const tooltip = C.normalize(text(cell));
        const style = view.getComputedStyle(day);
        const alpha = style.color.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/)?.[1];
        const unavailable = disabled(day) || disabled(cell) || /nao ha horarios|indisponivel|sem horarios/.test(tooltip) || Number(style.opacity || 1) < 0.7 || (alpha !== undefined && Number(alpha) < 0.55);
        return [{ date: `${month}-${String(number).padStart(2, "0")}`, element: day, available: !unavailable, selected: day.classList.contains("day--selected") || day.getAttribute("aria-selected") === "true" }];
      });
      return { root, month, entries };
    }
    function candidate(dates) {
      const grid = calendar();
      if (!grid) return null;
      for (const date of dates) {
        const hit = grid.entries.find(day => day.date === date && day.available && !day.selected);
        if (hit) return hit;
      }
      return null;
    }
    function monthButton(forward) {
      const grid = calendar();
      if (!grid) return null;
      return unique(all(`button[aria-label='${forward ? "next" : "back"} month']`, grid.root).filter(e => !disabled(e)));
    }
    function collectionMethod() {
      return doc.getElementById("shipment-type-selection-dropdown-id-trigger");
    }
    function methodValue() { return C.normalize(text(collectionMethod())); }
    function homeOption() {
      const menuId = collectionMethod()?.getAttribute("aria-controls") || "shipment-type-selection-dropdown-id-menu-list";
      const menu = doc.getElementById(menuId);
      if (!menu) return null;
      // O selo "MAIS ESCOLHIDO" também está dentro da opção Andes.
      // Ler só o título e limitar ao menu da forma de envio.
      return unique(all("[role='option'],[role='menuitem']", menu).filter(e => {
        const label = e.querySelector("[data-andes-listbox-title],.andes-list__item-primary") || e;
        return C.normalize(text(label)) === "coleta a domicilio" && !disabled(e);
      }));
    }
    function currentPreferred(dates) {
      const input = dateInput();
      return dates.find(date => C.labelMatchesDate(input?.value || "", date)) || "";
    }
    function selected(date) {
      return Boolean(calendar()?.entries.some(e => e.date === date && e.selected)) || C.labelMatchesDate(dateInput()?.value || "", date);
    }
    function calendarConfirm() {
      const grid = calendar();
      const card = grid?.root.closest(".andes-card__content");
      if (!card) return null;
      return unique(all(".apply-button-container button", card).filter(e => C.normalize(text(e)) === "confirmar" && !disabled(e)));
    }
    function finalConfirm() {
      if (calendar()) return null;
      const scope = doc.querySelector(".inbound__flow-container");
      if (!scope || !dateInput()) return null;
      return unique(all("button", scope).filter(e => !e.closest(".andes-card__content") && !disabled(e) && C.normalize(text(e)) === "confirmar"));
    }
    function identityMatches(id) { return Boolean(id && routeId() === id); }
    const hasId = (value, id) => new RegExp("(?:^|\\D)#?" + id + "(?!\\d)").test(value);
    function finishShipment(id) {
      const rows = all("tr,[role='row']").filter(row => hasId(text(row), id));
      if (rows.length !== 1) return null;
      return unique(all("button,a,[role='button']", rows[0]).filter(e => /^(terminar|continuar|retomar|concluir) envio$/.test(C.normalize(text(e))) && !disabled(e)));
    }
    function shipmentSearch() {
      return unique(all("input").filter(e => /buscar por nome ou n\.?\s*[ºo°]?\s*de envio/.test(C.normalize([e.placeholder, e.getAttribute("aria-label")].join(" ")))));
    }
    function collectionEdit(id) {
      if (!identityMatches(id) || !hasId(text(doc.body), id)) return null;
      return unique(all("a[href]").filter(e => {
        const u = new URL(e.getAttribute("href"), location.href);
        if (u.origin !== location.origin || !new RegExp(`^/shipping/inbounds/${id}/appointment(?:-v\\d+)?/?$`).test(u.pathname) || disabled(e)) return false;
        const card = e.closest("[data-testid='link-appointment']");
        if (card && disabled(card)) return false;
        // Sem reserva, o cartão usa uma seta SVG sem texto em vez de "Editar".
        const pendingAppointment = card && C.normalize(text(card.querySelector(".hub--card__content-summary-title"))) === "selecione como e quando voce vai enviar seus produtos";
        return C.normalize(text(e)) === "editar" || Boolean(pendingAppointment);
      }));
    }
    function managementLink() {
      const links = all("a[href]").filter(e => {
        const u = new URL(e.getAttribute("href"), location.href);
        return /^(ir para )?gestao de envios full$/.test(C.normalize(text(e))) && u.origin === location.origin && u.pathname === "/shipping/inbounds" && !u.search;
      });
      // Cabeçalho e menu podem repetir o mesmo destino. Isso não é outro envio.
      return links.find(e => C.normalize(text(e)).startsWith("ir para ")) || links[0] || null;
    }
    function bookingConfirmed(id, date) {
      if (!identityMatches(id) || !/\/hub(?:-v\d+)?\/?$/.test(location.pathname)) return false;
      return all("button,[role='button'],section").some(card => {
        const label = text(card);
        return /voce agendou a coleta para/.test(C.normalize(label)) && C.labelMatchesDate(label, date);
      });
    }
    return { visible, text, disabled, challenge, serverData, pageInfo, dateInput, calendar, candidate, monthButton, collectionMethod, methodValue, homeOption, currentPreferred, selected, calendarConfirm, finalConfirm, identityMatches, finishShipment, shipmentSearch, collectionEdit, managementLink, bookingConfirmed };
  }
  return { create };
});
