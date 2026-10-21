const test=require('node:test'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom'),D=require('../dom-adapter.js'),F=require('./fixtures.cjs');
function make(html,path='/shipping/inbounds/12345678/appointment-v2') {
  const dom=new JSDOM(html,{url:'https://vendedores.mercadolivre.com.br'+path});
  const adapter=D.create(dom.window.document,dom.window.location,{visible:e=>Boolean(e?.isConnected&&!e.closest('[hidden],[aria-hidden=true]'))});
  return {dom,adapter,doc:dom.window.document};
}
test('calendário observado: 21/22/23 indisponíveis, 26 selecionado bloqueado, 27 disponível',()=>{
  const {adapter}=make(F.appointment());
  assert.equal(adapter.candidate(['2026-10-21','2026-10-22','2026-10-23']),null);
  assert.equal(adapter.candidate(['2026-10-26']),null);
  assert.equal(adapter.candidate(['2026-10-27']).date,'2026-10-27');
});
test('não confunde dias dos meses adjacentes',()=>{
  const {adapter}=make(F.appointment());
  assert.equal(adapter.calendar().entries.length,31);
  assert.equal(adapter.calendar().entries.filter(e=>e.date==='2026-10-27').length,1);
});
test('tooltip indisponível prevalece mesmo se classe disabled sumir',()=>{
  const {adapter,doc}=make(F.appointment());
  const day=[...doc.querySelectorAll('.day')].find(e=>e.textContent==='21');
  day.classList.remove('day--disabled');
  assert.equal(adapter.candidate(['2026-10-21']),null);
});
test('botão final nunca é confundido com botão do calendário',()=>{
  const {adapter,doc}=make(F.appointment());
  assert.equal(adapter.calendarConfirm().dataset.confirm,'calendar');
  assert.equal(adapter.finalConfirm(),null);
  doc.querySelector('#calendar-card').hidden=true;
  assert.equal(adapter.finalConfirm().dataset.confirm,'final');
});
test('botão final é reconhecido sem rótulo nem valor de custo',()=>{
  const html=F.appointmentWithRealCost().replace(F.costSummary(),'');
  const {adapter,doc}=make(html);
  assert.equal(adapter.finalConfirm(),null);
  doc.querySelector('#calendar-card').hidden=true;
  assert.equal(adapter.finalConfirm().dataset.confirm,'final');
});
test('botão final exige o campo de data da coleta',()=>{
  const {adapter,doc}=make(F.appointment());
  doc.querySelector('#calendar-card').hidden=true;
  doc.querySelector('input').remove();
  assert.equal(adapter.finalConfirm(),null);
});
test('botão final desabilitado ou ambíguo não é acionado',()=>{
  const {adapter,doc}=make(F.appointment());
  doc.querySelector('#calendar-card').hidden=true;
  const final=doc.querySelector('[data-confirm="final"]');
  final.disabled=true;
  assert.equal(adapter.finalConfirm(),null);
  final.disabled=false;
  final.after(final.cloneNode(true));
  assert.equal(adapter.finalConfirm(),null);
});
test('somente a linha com ID exato é usada',()=>{
  const {adapter}=make(F.management(),'/shipping/inbounds');
  assert.match(adapter.finishShipment('12345678').closest('tr').textContent,/#12345678/);
  assert.equal(adapter.finishShipment('7943658'),null);
  assert.ok(adapter.shipmentSearch());
});
test('linhas duplicadas falham fechado',()=>assert.equal(make(F.management(['12345678','12345678']),'/shipping/inbounds').adapter.finishShipment('12345678'),null));
test('edição da coleta não usa editar unidades',()=>{
  const {adapter}=make(F.hub(),'/shipping/inbounds/12345678/hub-v2');
  assert.match(adapter.collectionEdit('12345678').href,/appointment$/);
  assert.equal(adapter.collectionEdit('79332226'),null);
});
test('hub sem reserva reconhece seta SVG do cartão de agendamento pelo ID e destino',()=>{
 const {adapter}=make(F.unbookedHub(),'/shipping/inbounds/12345678/hub-v2');
 assert.equal(adapter.pageInfo().recoveryStep,'preparation');
 const arrow=adapter.collectionEdit('12345678');
 assert.ok(arrow);assert.equal(arrow.textContent,'');assert.equal(arrow.getAttribute('href'),'/shipping/inbounds/12345678/appointment');
 assert.equal(arrow.closest('[role="button"]').dataset.testid,'link-appointment');
 assert.equal(adapter.collectionEdit('79332226'),null);
});
test('seta exige cartão reconhecido, destino do mesmo envio e origem correta',()=>{
 for(const change of [
  doc=>doc.querySelector('[data-testid="link-appointment"] a').setAttribute('href','/shipping/inbounds/79332226/appointment'),
  doc=>doc.querySelector('[data-testid="link-appointment"] a').setAttribute('href','https://outro.example/shipping/inbounds/12345678/appointment'),
  doc=>doc.querySelector('[data-testid="link-appointment"] a').setAttribute('href','/shipping/inbounds/12345678/units'),
  doc=>doc.querySelector('[data-testid="link-appointment"]').removeAttribute('data-testid'),
  doc=>{doc.querySelector('.hub--card__content-summary-title').textContent='Revise a preparação e regulamentação dos seus produtos';},
  doc=>{doc.querySelector('p').textContent='Envio #79332226';}
 ]) {
  const {adapter,doc}=make(F.unbookedHub(),'/shipping/inbounds/12345678/hub-v2');change(doc);assert.equal(adapter.collectionEdit('12345678'),null);
 }
});
test('seta oculta, desabilitada ou ambígua não é usada',()=>{
 for(const change of [
  (arrow,card)=>{card.hidden=true;},
  arrow=>arrow.setAttribute('aria-disabled','true'),
  (arrow,card)=>card.setAttribute('aria-disabled','true'),
  (arrow,card)=>card.classList.add('hub--card--disabled'),
  arrow=>arrow.after(arrow.cloneNode(true))
 ]) {
  const {adapter,doc}=make(F.unbookedHub(),'/shipping/inbounds/12345678/hub-v2');
  const card=doc.querySelector('[data-testid="link-appointment"]');change(card.querySelector('a'),card);assert.equal(adapter.collectionEdit('12345678'),null);
 }
});
test('sucesso exige envio, hub e data corretos',()=>{
  const {adapter}=make(F.hub(),'/shipping/inbounds/12345678/hub-v2');
  assert.equal(adapter.bookingConfirmed('12345678','2026-10-26'),true);
  assert.equal(adapter.bookingConfirmed('12345678','2026-10-21'),false);
  assert.equal(adapter.bookingConfirmed('79332226','2026-10-26'),false);
});
test('frase genérica em qualquer página não prova agendamento',()=>assert.equal(make('<h1>Agendamento confirmado</h1>').adapter.bookingConfirmed('12345678','2026-10-21'),false));
test('gestão é recuperação e não calendário mesmo com texto Full e data',()=>{
  const info=make(F.management(),'/shipping/inbounds').adapter.pageInfo();
  assert.equal(info.recoveryStep,'management');assert.equal(info.schedulePage,false);
});
test('captcha exige ação do usuário',()=>assert.equal(make('<div id="captcha">Verificação</div>').adapter.pageInfo().challenge,true));
test('mudança de estrutura é detectada sem chutar outro calendário',()=>assert.equal(make('<h3>outubro 2026</h3><table><tr><td>21</td></tr></table>').adapter.calendar(),null));

test('erro prevalece mesmo quando sobrou o título do agendamento',()=>{
 const {adapter}=make('<main><h2>Agende uma data para enviar seus produtos</h2><p>Ocorreu um erro. Tente novamente mais tarde.</p></main>');
 assert.equal(adapter.pageInfo().schedulePage,false);assert.equal(adapter.pageInfo().recoveryStep,'error');
});
test('erro aceita links repetidos da Gestão no cabeçalho e menu',()=>{
 const {adapter}=make('<main><h2>Algo deu errado</h2><a href="/shipping/inbounds#from=header">Gestão de envios Full</a><a href="/shipping/inbounds#from=menu">Gestão de envios Full</a></main>');
 assert.ok(adapter.managementLink());assert.equal(new URL(adapter.managementLink().href).pathname,'/shipping/inbounds');
});
test('link de recuperação não aceita outro domínio ou destino',()=>{
 const {adapter}=make('<h2>Algo deu errado</h2><a href="https://outro.example/shipping/inbounds">Gestão de envios Full</a><a href="/shipping/inbounds/79332226/hub-v2">Gestão de envios Full</a>');
 assert.equal(adapter.managementLink(),null);
});

test('opção de coleta Andes ignora o selo MAIS ESCOLHIDO e pertence ao dropdown de envio',()=>{
 const {adapter,doc}=make(F.unbookedAppointment({expanded:true})+'<ul role="listbox"><li role="option">Coleta a domicílio</li></ul>');
 assert.equal(adapter.homeOption()?.dataset.key,'pickup');
 doc.querySelector('[data-key="pickup"]').setAttribute('aria-disabled','true');
 assert.equal(adapter.homeOption(),null);
});
test('opção de coleta sem selo é reconhecida, mas menu oculto ou duplicidade não',()=>{
 const {adapter,doc}=make(F.unbookedAppointment({expanded:true,badge:false}));
 const option=adapter.homeOption();assert.equal(option?.dataset.key,'pickup');
 option.parentElement.hidden=true;assert.equal(adapter.homeOption(),null);
 option.parentElement.hidden=false;option.after(option.cloneNode(true));assert.equal(adapter.homeOption(),null);
});
test('aviso sem datas é um resultado de agendamento reconhecido sem calendário',()=>{
 const {adapter}=make(F.unbookedAppointment({value:'Coleta a domicílio'})+F.noDates());
 assert.equal(adapter.pageInfo().noCollectionDates,false); // Fora do formulário não vale.
 const inside=make(F.unbookedAppointment({value:'Coleta a domicílio'}).replace('<section id="pickup-result"></section>',F.noDates())).adapter;
 assert.equal(inside.pageInfo().noCollectionDates,true);assert.equal(inside.calendar(),null);
});
test('aviso Andes Não há datas disponíveis também é leitura sem vaga',()=>{
 const {adapter}=make(F.unbookedAppointment({value:'Coleta a domicílio'}).replace('<section id="pickup-result"></section>',F.noMethodDates()));
 assert.equal(adapter.pageInfo().schedulePage,true);assert.equal(adapter.pageInfo().noCollectionDates,true);
 assert.equal(adapter.dateInput(),null);assert.equal(adapter.calendar(),null);
});
test('texto de tooltip, aviso oculto ou fora do agendamento não encerra a leitura do calendário',()=>{
 const html=F.appointment().replace('</main>','<div class="day">Não há datas disponíveis.</div><div hidden>'+F.noMethodDates()+'</div></main>');
 assert.equal(make(html).adapter.pageInfo().noCollectionDates,false);
 assert.equal(make(F.unbookedAppointment()+F.noMethodDates()).adapter.pageInfo().noCollectionDates,false);
 assert.equal(make(F.noMethodDates(),'/shipping/inbounds').adapter.pageInfo().noCollectionDates,false);
});
