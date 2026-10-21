const months = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
// Estrutura sanitizada dos elementos observados em 18/10/2026. Sem endereço, telefone ou cookies.
function calendar(month = '2026-10', available = ['2026-10-27'], selected = '2026-10-26') {
  const [year,m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year,m-1,1)).getUTCDay();
  const total = new Date(Date.UTC(year,m,0)).getUTCDate();
  const prior = new Date(Date.UTC(year,m-1,0)).getUTCDate();
  let rows = '';
  for (let row=0;row<Math.ceil((first+total)/7);row++) {
    let cells='';
    for(let col=0;col<7;col++) {
      const index=row*7+col, day=index-first+1;
      const outside=day<1||day>total;
      const number=day<1?prior+day:day>total?day-total:day;
      const date=month+'-'+String(number).padStart(2,'0');
      const disabled=outside||!available.includes(date);
      const label=`<div class="day${date===selected&&!outside?' day--selected':''}${disabled?' day--disabled':''}">${number}</div>`;
      cells+=`<td class="day-box">${disabled&&!outside?'<div><div class="andes-tooltip__trigger">'+label+'</div><span aria-hidden="true"> Não há horários disponíveis para esta data.</span></div>':label}</td>`;
    }
    rows+=`<tr class="focus-ui-datepicker__content__week">${cells}</tr>`;
  }
  return `<table class="focus-ui-datepicker__content"><thead><tr><th colspan="5"><p class="focus-ui-datepicker__content__month-year">${months[m-1]} <span class="year">${year}</span></p></th><th><button type="button" aria-label="back month">Anterior</button></th><th><button type="button" aria-label="next month">Próximo</button></th></tr></thead><tbody><tr class="focus-ui-datepicker__content__week-days">${['DOM','SEG','TER','QUA','QUI','SEX','SAB'].map(d=>'<td class="day-box"><div class="day">'+d+'</div></td>').join('')}</tr>${rows}</tbody></table>`;
}
function appointment({month='2026-10',available=['2026-10-27'],selected='2026-10-26'}={}) {
  const [y,m,d]=selected.split('-').map(Number);
  return `<!doctype html><html lang="pt-BR"><head><title>Agendamento - Envios Full (simulação)</title></head><body><main class="inbound__flow-container"><h2>Agende uma data para enviar seus produtos</h2><h3>Escolha como você deseja enviá-los</h3><button id="shipment-type-selection-dropdown-id-trigger" role="combobox">Coleta a domicílio</button><h3>Escolha quando quer que a coleta passe</h3><div class="date-picker-container"><input aria-label="Data da coleta" data-testid="date-picker-input" readonly value="${d} de ${months[m-1]}"></div><div id="calendar-card" class="andes-card__content"><div class="focus-ui-calendar--container">${calendar(month,available,selected)}</div><div class="apply-button-container"><button type="button" data-confirm="calendar">Confirmar</button></div></div><div><span>Custo estimado: </span><span>R$ 60,70</span></div><div class="block"><button type="button">Cancelar reserva</button><button type="button" data-confirm="final">Confirmar</button></div></main></body></html>`;
}
function management(ids=['79332226','12345678']) {
  return `<main><h1>Gestão de envios Full</h1><input placeholder="Buscar por nome ou n. º de envio"><table>${ids.map(id=>`<tr><td>#${id} Envio de teste</td><td><button>Terminar envio</button></td></tr>`).join('')}</table></main>`;
}
function hub(id='12345678',date='26 de outubro') {
  return `<main><h1>Preparação do envio</h1><p>Envio #${id}</p><button>Você vai enviar 12 unidades <a href="/shipping/inbounds/${id}/units">Editar</a></button><button>Você agendou a coleta para ${date}<a href="/shipping/inbounds/${id}/appointment">Editar</a></button></main>`;
}
// Hub sem reserva, DOM observado em 20/10/2026. A seta é um link só com SVG.
function unbookedHub(id='12345678') {
  return `<main><h1>Preparação do envio</h1><p>Envio #${id}</p>
    <div data-testid="link-units" role="button">Você vai enviar 20 unidades <a href="/shipping/inbounds/${id}/units?from=hub">Editar</a></div>
    <div class="tour__appointment hub--card" data-testid="link-appointment" role="button" tabindex="0">
      <div class="andes-card andes-card--flat andes-card--primary andes-card--padding-0" data-andes-card="true"><div class="andes-card__content" data-andes-card-content="true">
        <div class="block block--row block--justify-space-between block--align-center"><div class="block block--row block--align-center">
          <div class="hub--card__content-summary-icon-container"><svg viewBox="0 0 38 30" width="36" height="28"></svg><div class="hub--card__content-summary-task-done-check-icon" data-testid="icon-appointment"></div></div>
          <div class="block block--spacer-left block--spacer-large"><span class="hub--card__content-summary-title">Selecione como e quando você vai enviar seus produtos</span><div class="hub--card__content-summary-action"></div></div>
        </div><a class="andes-typography hub--card__content-summary-link" href="/shipping/inbounds/${id}/appointment"><svg width="16" height="16"><path fill-rule="evenodd" clip-rule="evenodd" d="M10.806 7.998 4.803 1.994l1.06-1.06 7.065 7.064-7.07 7.07-1.062-1.06 6.01-6.01Z" fill="#3483FA"></path></svg></a></div>
      </div></div>
    </div>
    <div role="button">Revise a preparação e regulamentação dos seus produtos <a href="/shipping/inbounds/${id}/procedures"><svg></svg></a></div>
    <div role="button">Verifique o código universal dos seus produtos para identificá-los <a href="/shipping/inbounds/${id}/identifiers"><svg></svg></a></div>
  </main>`;
}
// Custo observado no DOM real em 18/10: rótulo e valor Andes no mesmo span.
function costSummary(fraction='60',cents='70') {
  return `<span>Custo estimado: <span class="andes-money-amount pickup-cost-amount andes-money-amount--cents-comma andes-money-amount--weight-semibold" role="img" aria-label="${fraction} reales con ${cents} centavos" aria-roledescription="Monto" data-andes-money-amount="true"><span class="andes-money-amount__currency" aria-hidden="true" data-andes-money-amount-currency="true"><span class="andes-money-amount__currency-symbol">R$</span></span><span class="andes-money-amount__fraction" aria-hidden="true" data-andes-money-amount-fraction="true">${fraction}</span><span aria-hidden="true">,</span><span class="andes-money-amount__cents" aria-hidden="true" data-andes-money-amount-cents="true">${cents}</span></span></span>`;
}
function appointmentWithRealCost(options={}) {
  return appointment(options).replace('<div><span>Custo estimado: </span><span>R$ 60,70</span></div>',costSummary());
}
// Dropdown Andes observado em 19/10/2026: o selo é irmão do título, dentro da opção.
function collectionMethod({value='Escolha a forma de envio',expanded=false,badge=true}={}) {
  const id='shipment-type-selection-dropdown-id';
  return `<div class="andes-dropdown andes-dropdown--form shipment-type-selection-dropdown" id="${id}">
    <span class="andes-visually-hidden" id="${id}-sr-label">Escolha a forma de envio</span>
    <div class="andes-dropdown__trigger-wrapper"><div class="andes-floating-menu">
      <button type="button" id="${id}-trigger" role="combobox" aria-labelledby="${id}-sr-label ${id}-display-values" aria-expanded="${expanded}" aria-haspopup="listbox" aria-controls="${id}-menu-list"><span class="andes-dropdown__trigger-content"><span class="andes-dropdown__display-values" id="${id}-display-values" data-andes-dropdown-value="true">${value}</span></span></button>
      <div class="andes-popper"><div class="andes-popper__content"><ul id="${id}-menu-list" role="listbox" aria-label="Escolha a forma de envio" ${expanded?'':'hidden'}>
        <li id="${id}-menu-list-option-pickup" role="option" data-key="pickup" aria-selected="false"><div class="andes-list__item-first-column"><div class="andes-list__item-text"><span class="andes-list__item-primary" data-andes-listbox-title="true">Coleta a domicílio</span></div></div>${badge?'<div class="andes-list__item-second-column"><span data-andes-listbox-right-content="true"><div class="andes-badge"><p class="andes-badge__content">MAIS ESCOLHIDO</p></div></span></div>':''}</li>
        <li role="option" data-key="ftl"><div class="andes-list__item-first-column"><div class="andes-list__item-text"><span class="andes-list__item-primary" data-andes-listbox-title="true">Veículo particular</span></div></div></li>
      </ul></div></div>
    </div></div></div>`;
}
function noDates() {
  return '<div id="no-dates">Os centros de distribuição próximos não têm datas disponíveis. <a href="#" data-change-address>Escolha outro endereço para continuar</a></div>';
}
// Segunda mensagem observada na página real em 19/10, sem endereço/calendário.
function noMethodDates() {
  return '<div class="block block--spacer-top block--spacer-medium"><div class="andes-message andes-message--caution andes-message--quiet"><div class="andes-message__content andes-message__content--untitled"><div class="andes-message__text">Não há datas disponíveis. Você pode escolher outra forma de envio para continuar.</div></div></div></div>';
}
function unbookedAppointment(options={}) {
  return `<main class="inbound__flow-container"><h2>Agende uma data para enviar seus produtos</h2><h3>Escolha como você deseja enviá-los</h3>${collectionMethod(options)}<section id="pickup-result"></section><button data-confirm="final">Confirmar</button></main>`;
}
module.exports={calendar,appointment,management,hub,unbookedHub,costSummary,appointmentWithRealCost,collectionMethod,noDates,noMethodDates,unbookedAppointment};
