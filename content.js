(() => {
  "use strict";
  const C = globalThis.FullRadarCore;
  const D = globalThis.FullRadarDOM.create(document, location);
  let generation = 0;
  let activeRun = null;
  let refreshTimer = null;
  let timerRun = null;
  const send = message => chrome.runtime.sendMessage(message);
  async function emit(run, event, fields = {}) {
    if (run.generation !== generation) return { ok: false };
    const reply = await send({ type: "CONTENT_EVENT", event, searchId: run.id, ...fields });
    if (alive(run) && reply?.ok && reply.nextRefreshAt) armRefresh(run, reply.nextRefreshAt);
    return reply;
  }
  function armRefresh(run, at) {
    clearTimeout(refreshTimer);
    timerRun = run;
    refreshTimer = setTimeout(() => {
      if (alive(run)) emit(run, "REFRESH_DUE").catch(() => {});
    }, Math.max(0, at - Date.now()));
  }
  function alive(run) { return run.generation === generation; }
  function guard(run, requireId = true) {
    if (!alive(run)) throw new Error("CANCELLED");
    if (D.challenge()) throw new Error("Conclua o login ou a verificação do Mercado Livre e retome manualmente.");
    const id = C.shipmentId(location.href);
    if ((id && id !== run.config.shipmentId) || (requireId && !D.identityMatches(run.config.shipmentId))) throw new Error("O envio desta aba mudou. A busca foi pausada para não atuar em outro envio.");
  }
  // Reavalia assim que a página muda, em vez de esperar um intervalo fixo.
  function pageChange(ms) {
    return new Promise(resolve => {
      const observer = new MutationObserver(done);
      const timer = setTimeout(done, ms);
      function done() { observer.disconnect(); clearTimeout(timer); resolve(); }
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
    });
  }
  async function waitUntil(run, predicate, timeout = 10000) {
    const deadline = Date.now() + timeout;
    while (alive(run) && Date.now() < deadline) {
      const result = predicate();
      if (result) return result;
      await pageChange(100);
    }
    if (!alive(run)) throw new Error("CANCELLED");
    return null;
  }
  async function phase(run, status, fields = {}) {
    const reply = await emit(run, "PHASE", { status, ...fields });
    if (!reply?.ok) throw new Error("CANCELLED");
  }
  const transient = message => Object.assign(new Error(message), { retryable: true });
  async function recoveryAction(run, step, findAction) {
    return waitUntil(run, () => {
      guard(run, false);
      const info = D.pageInfo();
      if (info.schedulePage || (info.recoveryStep && info.recoveryStep !== step)) return { changed: true };
      const action = findAction();
      return !info.busy && action && !D.disabled(action) ? { action } : null;
    }, 15000);
  }
  async function recover(run) {
    for (let stepCount = 0; stepCount < 5; stepCount++) {
      guard(run, false);
      const info = D.pageInfo();
      if (info.schedulePage) { guard(run); return; }
      if (info.shipmentId && info.shipmentId !== run.config.shipmentId) throw new Error("A recuperação chegou a outro envio. Nenhuma edição foi feita.");
      const step = info.recoveryStep;
      if (!step) throw transient("A etapa de recuperação ainda não terminou de carregar.");
      await phase(run, "recovering", { step });
      let action;
      if (step === "error") {
        action = D.managementLink();
        if (!action) {
          // Rota da Gestão observada na interface. Funciona mesmo no erro sem links.
          guard(run, false);
          location.assign(new URL("/shipping/inbounds", location.origin).href);
          return false;
        }
      }
      if (step === "preparation") {
        const ready = await recoveryAction(run, step, () => D.collectionEdit(run.config.shipmentId));
        if (ready?.changed) continue;
        action = ready?.action;
      }
      if (step === "management") {
        const ready = await recoveryAction(run, step, () => D.finishShipment(run.config.shipmentId));
        if (ready?.changed) continue;
        action = ready?.action;
        if (!action) {
          const query = new URL(location.href).searchParams.get("query");
          if (D.shipmentSearch() && query !== run.config.shipmentId) {
            const destination = new URL("/shipping/inbounds", location.origin);
            destination.searchParams.set("query", run.config.shipmentId);
            location.assign(destination.href);
            return false;
          }
          throw transient("A lista ainda não apresentou uma ação única para o envio salvo. Vou aguardar e tentar novamente.");
        }
      }
      if (!action || D.disabled(action)) throw transient("A ação de recuperação ainda não ficou disponível para este envio.");
      guard(run, step === "preparation");
      action.click();
      const next = await waitUntil(run, () => {
        const nextInfo = D.pageInfo();
        return nextInfo.schedulePage || (nextInfo.recoveryStep && nextInfo.recoveryStep !== step);
      }, 15000);
      if (!next) throw transient("A navegação da recuperação não terminou. Vou tentar novamente após a espera.");
    }
    throw transient("A recuperação ainda não chegou ao calendário. Vou aguardar e tentar novamente.");
  }
  async function openCalendar(run) {
    const ready0 = await waitUntil(run, () => {
      guard(run);
      const info = D.pageInfo();
      // Sem coleta no momento: o ML desativa o seletor. Não há o que abrir.
      if (info.noPickup) return { noPickup: true };
      const control = D.collectionMethod();
      return !info.busy && D.visible(control) && !D.disabled(control) ? { control } : null;
    });
    if (!ready0) throw transient("O campo da forma de envio ainda não ficou disponível.");
    if (ready0.noPickup) return false;
    const trigger = ready0.control;
    const method = D.methodValue();
    if (method !== "coleta a domicilio") {
      if (method && !/^escolha|^selecione/.test(method)) throw new Error("Este monitor atende coleta a domicílio. O método escolhido foi preservado.");
      guard(run);
      if (trigger.getAttribute("aria-expanded") !== "true") trigger.click();
      const option = await waitUntil(run, () => { guard(run); return D.homeOption(); }, 5000);
      if (!option) throw transient("A opção Coleta a domicílio ainda não ficou disponível.");
      guard(run);
      option.click();
      if (!await waitUntil(run, () => { guard(run); return D.methodValue() === "coleta a domicilio"; })) throw transient("A forma de envio não terminou de carregar.");
    }
    // Sem reserva prévia, o aviso pode surgir só DEPOIS de selecionar coleta.
    // É uma leitura sem vagas; o agendador mantém a próxima recarga normal.
    const pickupState = (allowInput = true) => {
      guard(run);
      const info = D.pageInfo();
      if (info.busy) return null;
      if (D.methodValue() !== "coleta a domicilio") throw new Error("A forma de envio mudou durante a leitura. Revise manualmente.");
      if (info.noCollectionDates) return { noDates: true };
      if (D.calendar()) return { calendar: true };
      const input = allowInput && D.dateInput();
      return input && !D.disabled(input) ? { input } : null;
    };
    const ready = await waitUntil(run, pickupState);
    if (!ready) throw transient("O calendário não terminou de carregar.");
    if (ready.noDates) return false;
    if (ready.calendar) return true;
    guard(run);
    ready.input.click();
    const opened = await waitUntil(run, () => pickupState(false));
    if (!opened) throw transient("O calendário não terminou de abrir.");
    return !opened.noDates;
  }
  async function visitMonth(run, target) {
    for (let count = 0; count < 14; count++) {
      guard(run);
      const calendar = D.calendar();
      if (!calendar) throw new Error("O calendário desapareceu durante a leitura.");
      if (calendar.month === target) return true;
      const distance = C.monthDistance(calendar.month, target);
      const button = D.monthButton(distance > 0);
      if (!button) return false;
      button.click();
      if (!await waitUntil(run, () => D.calendar()?.month !== calendar.month && D.calendar(), 4000)) return false;
    }
    return false;
  }
  async function verifyBooking(run, date) {
    const confirmed = await waitUntil(run, () => D.bookingConfirmed(run.config.shipmentId, date), 12000);
    await emit(run, "CONFIRMATION_RESULT", {
      date, confirmed: Boolean(confirmed),
      message: confirmed ? "" : "A confirmação foi enviada, mas não consegui verificar o resultado. Confira a reserva; não haverá repetição automática."
    });
  }
  async function selectAndConfirm(run, hit) {
    guard(run);
    await phase(run, "selecting", { date: hit.date });
    const fresh = D.candidate([hit.date]);
    if (!fresh) throw new Error("A disponibilidade mudou antes da seleção. Confira a página.");
    guard(run);
    fresh.element.click();
    if (!await waitUntil(run, () => D.selected(hit.date), 4000)) throw new Error("O Mercado Livre não reconheceu a seleção da data.");
    const calendarConfirm = D.calendarConfirm();
    if (!calendarConfirm) throw new Error("O botão do calendário não foi reconhecido. Nenhuma confirmação final foi enviada.");
    guard(run);
    calendarConfirm.click();
    if (!await waitUntil(run, () => !D.calendar() && C.labelMatchesDate(D.dateInput()?.value, hit.date), 5000)) throw new Error("A data não apareceu no campo após fechar o calendário.");
    if (D.methodValue() !== "coleta a domicilio") throw new Error("A forma de envio mudou. Revise manualmente antes de confirmar.");
    const confirm = D.finalConfirm();
    if (!confirm) throw new Error("O botão final não foi identificado com segurança.");
    const permit = await emit(run, "BEFORE_CONFIRM", { date: hit.date });
    if (!permit?.ok) throw new Error("CANCELLED");
    guard(run);
    confirm.click();
    await verifyBooking(run, hit.date);
  }
  const elapsed = run => ((Date.now() - run.startedAt) / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  async function scan(search) {
    if (activeRun) return;
    clearTimeout(refreshTimer);
    const run = { id: search.id, config: C.normalizeConfig(search.config), generation: ++generation, startedAt: Date.now() };
    activeRun = run;
    try {
      if (search.status === "confirming") {
        guard(run);
        await verifyBooking(run, search.foundDate);
        return;
      }
      if (search.status === "selecting") throw new Error("A página mudou durante a seleção. Revise a reserva antes de retomar; nenhuma confirmação será repetida.");
      C.validateConfig(run.config);
      await waitUntil(run, () => {
        const info = D.pageInfo();
        return info.challenge || info.schedulePage || info.recoveryStep;
      }, 12000);
      guard(run, false);
      let info = D.pageInfo();
      if (info.recoveryStep) {
        if (await recover(run) === false) return;
        info = D.pageInfo();
      }
      if (!info.schedulePage) {
        await emit(run, "RETRY", { message: "A página ainda não ficou pronta." });
        return;
      }
      guard(run);
      await phase(run, "scanning");
      if (!await openCalendar(run)) {
        await emit(run, "SCAN_COMPLETE", { message: `Sem datas de coleta disponíveis no momento (lido em ${elapsed(run)} s).`, months: [] });
        return;
      }
      const dates = C.requestedDates(run.config, C.today());
      const current = D.currentPreferred(dates);
      const wanted = current ? dates.slice(0, dates.indexOf(current)) : dates;
      if (!wanted.length) {
        await emit(run, "ALREADY_SATISFIED", { date: current });
        return;
      }
      const months = [...new Set(wanted.map(date => date.slice(0, 7)))];
      const visited = [];
      const hits = [];
      for (const month of months) {
        if (!await visitMonth(run, month)) {
          await emit(run, "RETRY", { message: "O mês solicitado ainda não ficou acessível no calendário." });
          return;
        }
        visited.push(month);
        const hit = D.candidate(wanted.filter(date => date.startsWith(month)));
        if (hit) hits.push(hit);
        // Só encerrar cedo quando a primeira preferência absoluta foi encontrada.
        if (hit?.date === wanted[0]) break;
      }
      hits.sort((a, b) => wanted.indexOf(a.date) - wanted.indexOf(b.date));
      const best = hits[0];
      if (best) {
        if (!await visitMonth(run, best.date.slice(0, 7))) throw new Error("Não consegui retornar ao mês da data disponível.");
        if (!D.candidate([best.date])) { await emit(run, "RETRY", { message: "A vaga deixou de estar disponível durante a leitura." }); return; }
        if (!run.config.autoConfirm) {
          await emit(run, "FOUND_DATE", { date: best.date, message: "Data disponível encontrada. A reserva não foi alterada; escolha e confirme manualmente." });
        } else await selectAndConfirm(run, best);
        return;
      }
      await emit(run, "SCAN_COMPLETE", { months: visited, message: `Calendário verificado em ${elapsed(run)} s: nenhuma das datas desejadas está disponível.` });
    } catch (error) {
      if (alive(run) && error.message !== "CANCELLED") await emit(run, error.retryable ? "RETRY" : "NEEDS_ATTENTION", { message: error.message || "Falha ao verificar o calendário." }).catch(() => {});
    } finally {
      if (activeRun === run) activeRun = null;
    }
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message.type === "PAGE_INFO") { respond({ ...D.pageInfo(), version: chrome.runtime.getManifest().version }); return false; }
    if (message.type === "STOP_SCAN") { generation++; clearTimeout(refreshTimer); activeRun = null; respond({ ok: true }); return false; }
    // O usuário mudou o intervalo durante a espera: reprogramar o refresh já armado.
    if (message.type === "RESCHEDULE") {
      if (timerRun && alive(timerRun) && timerRun.id === message.searchId) armRefresh(timerRun, message.nextRefreshAt);
      respond({ ok: true });
      return false;
    }
    if (message.type === "SCAN") {
      if (activeRun) { respond({ ok: true, busy: true }); return false; }
      respond({ ok: true });
      scan(message.search).catch(() => {});
      return false;
    }
    return false;
  });
  send({ type: "GET_TAB_SEARCH" }).then(search => {
    if (search && ["monitoring", "scanning", "loading", "recovering", "selecting", "confirming"].includes(search.status)) return scan(search);
  }).catch(() => {});
})();
