const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom'),F=require('./fixtures.cjs');
function setup({html=F.appointment(),url='/shipping/inbounds/12345678/appointment-v2',config={},onMessage,onClick,status='monitoring'}={}) {
  const dom=new JSDOM(html,{url:'https://vendedores.mercadolivre.com.br'+url,runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window,events=[],clicks=[];
  class CalendarClock extends w.Date { constructor(...args){super(...(args.length?args:['2026-10-18T15:00:00Z']));} }
  w.Date=CalendarClock;
  w.HTMLElement.prototype.getClientRects=function(){return this.closest('[hidden]')?[]:[{x:0,y:0,width:100,height:30}];};
  let listener;
  w.chrome={runtime:{getManifest:()=>({version:'0.2.0'}),onMessage:{addListener:fn=>listener=fn},sendMessage:async message=>{
    if(message.type==='GET_TAB_SEARCH')return null;
    events.push(message);if(onMessage){const reply=await onMessage(message,w);if(reply)return reply;}
    return {ok:true};
  }}};
  w.document.addEventListener('click',e=>{clicks.push(e.target);onClick?.(e,w);});
  for(const name of ['core.js','dom-adapter.js','content.js'])w.eval(fs.readFileSync(path.join(__dirname,'..',name),'utf8'));
  const search={id:'test-search',status,config:{mode:'range',startDate:'2026-10-21',endDate:'2026-10-23',shipmentId:'12345678',intervalSeconds:90,automationVersion:2,...config}};
  const start=()=>listener({type:'SCAN',search},{},()=>{});
  async function until(event,timeout=3000){const end=Date.now()+timeout;while(Date.now()<end){const found=events.find(m=>m.event===event);if(found)return found;await new Promise(r=>setTimeout(r,10));}throw Error(`Evento ${event} não chegou: ${JSON.stringify(events)}`);}
  return {dom,w,events,clicks,start,until,stop:()=>listener({type:'STOP_SCAN'},{},()=>{})};
}
test('fluxo real observado não seleciona 21/22/23 bloqueados',async t=>{
  const h=setup();t.after(()=>h.dom.window.close());h.start();await h.until('SCAN_COMPLETE');assert.equal(h.clicks.length,0);assert.equal(h.events.some(e=>e.event==='BEFORE_CONFIRM'),false);
});
test('modo aviso detecta vaga e não clica em dia nem confirmar',async t=>{
  const h=setup({html:F.appointment({available:['2026-10-22']})});t.after(()=>h.w.close());h.start();const result=await h.until('FOUND_DATE');assert.equal(result.date,'2026-10-22');assert.equal(h.clicks.length,0);assert.match(h.w.document.querySelector('input').value,/26/);
});
test('navega para novembro quando a preferência está no próximo mês',async t=>{
  const h=setup({config:{mode:'specific',dates:['2026-11-03']},onClick:(e,w)=>{
    if(e.target.getAttribute('aria-label')==='next month')w.document.querySelector('.focus-ui-calendar--container').innerHTML=F.calendar('2026-11',['2026-11-03']);
  }});t.after(()=>h.w.close());h.start();const result=await h.until('FOUND_DATE');assert.equal(result.date,'2026-11-03');assert.equal(h.clicks.length,1);assert.equal(h.clicks[0].getAttribute('aria-label'),'next month');
});
test('ID divergente pausa antes de qualquer clique',async t=>{
  const h=setup({url:'/shipping/inbounds/79332226/appointment-v2'});t.after(()=>h.w.close());h.start();await h.until('NEEDS_ATTENTION');assert.equal(h.clicks.length,0);
});
test('parar durante a leitura impede aviso e cliques posteriores',async t=>{
  let h;h=setup({html:F.appointment({available:['2026-10-22']}),onMessage:message=>{if(message.event==='PHASE')h.stop();}});t.after(()=>h.w.close());h.start();await h.until('PHASE');await new Promise(r=>setTimeout(r,30));assert.equal(h.events.some(e=>e.event==='FOUND_DATE'),false);assert.equal(h.clicks.length,0);
});
test('seleção automática em simulação confirma calendário e formulário uma vez e verifica hub',async t=>{
  let selected='';
  const h=setup({html:F.appointment({available:['2026-10-22']}),config:{autoConfirm:true},onClick:(e,w)=>{
    const el=e.target;
    if(el.classList.contains('day')&&!el.classList.contains('day--disabled')){
      w.document.querySelectorAll('.day--selected').forEach(n=>n.classList.remove('day--selected'));el.classList.add('day--selected');selected=el.textContent;
    }
    if(el.dataset.confirm==='calendar'){
      w.document.querySelector('input').value=selected+' de outubro';w.document.querySelector('#calendar-card').hidden=true;
    }
    if(el.dataset.confirm==='final'){
      w.history.pushState({},'', '/shipping/inbounds/12345678/hub-v2');w.document.body.innerHTML=F.hub('12345678','22 de outubro');
    }
  }});t.after(()=>h.w.close());h.start();const result=await h.until('CONFIRMATION_RESULT');assert.equal(result.confirmed,true);assert.equal(h.clicks.filter(e=>e.dataset.confirm==='final').length,1);assert.equal(h.events.filter(e=>e.event==='BEFORE_CONFIRM').length,1);
});
test('mudança da forma de envio continua bloqueando confirmação final',async t=>{
  const h=setup({html:F.appointment({available:['2026-10-22']}),config:{autoConfirm:true},onClick:(e,w)=>{
    if(e.target.classList.contains('day'))e.target.classList.add('day--selected');
    if(e.target.dataset.confirm==='calendar'){
      w.document.querySelector('input').value='22 de outubro';w.document.querySelector('#calendar-card').hidden=true;
      w.document.querySelector('#shipment-type-selection-dropdown-id-trigger').textContent='Entrega por conta própria';
    }
  }});t.after(()=>h.w.close());h.start();const result=await h.until('NEEDS_ATTENTION');assert.match(result.message,/forma de envio/);assert.equal(h.clicks.some(e=>e.dataset.confirm==='final'),false);
});

for (const scenario of [
  {name:'preço Andes presente',summary:F.costSummary()},
  {name:'sem rótulo nem valor de preço',summary:''},
  {name:'preço ilegível',summary:'<span>Custo estimado: aguardando valor</span>'},
  {name:'preço alterado após escolher a data',summary:F.costSummary(),changePrice:true}
]) test(`confirma dia 21 nos dois botões com ${scenario.name}`,async t=>{
  const steps=[];
  const html=F.appointmentWithRealCost({available:['2026-10-21']}).replace(F.costSummary(),scenario.summary);
  const h=setup({html,config:{autoConfirm:true},onClick:(e,w)=>{
    const el=e.target;
    if(el.classList.contains('day')&&!el.classList.contains('day--disabled')) {
      steps.push('dia '+el.textContent);
      w.document.querySelectorAll('.day--selected').forEach(n=>n.classList.remove('day--selected'));
      el.classList.add('day--selected');
    }
    if(el.dataset.confirm==='calendar') {
      steps.push('calendário');
      w.document.querySelector('input').value='21 de outubro';
      w.document.querySelector('#calendar-card').hidden=true;
      if(scenario.changePrice) w.document.querySelector('[data-andes-money-amount-cents]').textContent='71';
    }
    if(el.dataset.confirm==='final') {
      steps.push('final');
      w.history.pushState({},'', '/shipping/inbounds/12345678/hub-v2');
      w.document.body.innerHTML=F.hub('12345678','21 de outubro');
    }
  }});
  t.after(()=>h.w.close()); h.start();
  const result=await h.until('CONFIRMATION_RESULT');
  assert.equal(result.confirmed,true);
  assert.deepEqual(steps,['dia 21','calendário','final']);
  assert.equal(h.events.filter(e=>e.event==='BEFORE_CONFIRM').length,1);
  assert.equal(h.events.some(e=>e.event==='NEEDS_ATTENTION'),false);
});

test('recuperação em lista com vários envios usa apenas a linha correta',async t=>{
  const h=setup({html:F.management(),url:'/shipping/inbounds',onClick:(e,w)=>{
    if(e.target.textContent==='Terminar envio'){
      assert.match(e.target.closest('tr').textContent,/#12345678/);
      w.history.pushState({},'','/shipping/inbounds/12345678/hub-v2');w.document.body.innerHTML=F.hub();
    }else if(e.target.getAttribute('href')?.endsWith('/appointment')){
      e.preventDefault();w.history.pushState({},'','/shipping/inbounds/12345678/appointment-v2');w.document.body.innerHTML=F.appointment().match(/<body>([\s\S]*)<\/body>/)[1];
    }
  }});t.after(()=>h.w.close());h.start();await h.until('SCAN_COMPLETE');assert.equal(h.clicks.length,2);assert.equal(h.events.filter(e=>e.status==='recovering').length,2);
});

test('recuperação espera a linha filtrada e o Editar renderizarem com atraso',async t=>{
 const h=setup({html:'<main><h1>Gestão de envios Full</h1><input placeholder="Buscar por nome ou n. º de envio"><div role="progressbar"></div></main>',url:'/shipping/inbounds?query=12345678',onClick:(e,w)=>{
  if(e.target.textContent==='Terminar envio'){
   assert.match(e.target.closest('tr').textContent,/#12345678/);
   w.history.pushState({},'','/shipping/inbounds/12345678/hub-v2');w.document.body.innerHTML='<main><h1>Preparação do envio</h1><p>Envio #12345678</p></main>';
   w.setTimeout(()=>{w.document.body.innerHTML=F.hub();},250);
  }else if(e.target.getAttribute('href')?.endsWith('/appointment')){
   e.preventDefault();w.history.pushState({},'','/shipping/inbounds/12345678/appointment-v2');w.document.body.innerHTML=F.appointment().match(/<body>([\s\S]*)<\/body>/)[1];
  }
 }});t.after(()=>h.w.close());h.start();h.w.setTimeout(()=>{h.w.document.body.innerHTML=F.management();},250);
 await h.until('SCAN_COMPLETE');assert.equal(h.clicks.length,2);assert.equal(h.events.some(e=>e.event==='NEEDS_ATTENTION'),false);
});
for(const available of [false,true]) test(`recupera envio sem reserva, clica seta, restaura coleta e ${available?'abre calendário':'continua sem datas'}`,async t=>{
 const h=setup({html:F.management(),url:'/shipping/inbounds',onClick:(e,w)=>{
  const el=e.target;
  if(el.textContent==='Terminar envio'){
   assert.match(el.closest('tr').textContent,/#12345678/);
   w.history.pushState({},'','/shipping/inbounds/12345678/hub-v2');w.document.body.innerHTML=F.unbookedHub();
  }else if(el.closest('[data-testid="link-appointment"]')&&el.matches('a')){
   e.preventDefault();w.history.pushState({},'','/shipping/inbounds/12345678/appointment');w.document.body.innerHTML=F.unbookedAppointment();
  }else if(el.id==='shipment-type-selection-dropdown-id-trigger'){
   w.document.querySelector('[role="listbox"]').hidden=false;el.setAttribute('aria-expanded','true');
  }else if(el.dataset.key==='pickup'){
   w.document.querySelector('[data-andes-dropdown-value]').textContent='Coleta a domicílio';w.document.querySelector('[role="listbox"]').hidden=true;
   w.document.querySelector('#pickup-result').innerHTML=available?pickupCalendar():F.noMethodDates();
  }else if(el.matches('input'))w.document.querySelector('#calendar-card').hidden=false;
 }});t.after(()=>h.w.close());h.start();const result=await h.until(available?'FOUND_DATE':'SCAN_COMPLETE');
 assert.equal(h.clicks.length,available?5:4);assert.equal(h.clicks[1].getAttribute('href'),'/shipping/inbounds/12345678/appointment');
 assert.equal(h.clicks.some(el=>el.matches('.day,[data-confirm]')),false);
 assert.equal(h.events.some(e=>['RETRY','NEEDS_ATTENTION','BEFORE_CONFIRM'].includes(e.event)),false);
 if(available)assert.equal(result.date,'2026-10-22');
});
test('aguarda seta do agendamento renderizar; Parar impede navegação atrasada',async t=>{
 const h=setup({html:'<main><h1>Preparação do envio</h1><p>Envio #12345678</p></main>',url:'/shipping/inbounds/12345678/hub-v2'});t.after(()=>h.w.close());
 h.start();await h.until('PHASE');h.stop();h.w.document.body.innerHTML=F.unbookedHub();await new Promise(r=>setTimeout(r,180));assert.equal(h.clicks.length,0);
});
test('erro com link comum da Gestão percorre as três etapas e volta à leitura',async t=>{
 const h=setup({html:'<main><h2>Ocorreu um erro</h2><a href="/shipping/inbounds#from=menu">Gestão de envios Full</a></main>',onClick:(e,w)=>{
  if(e.target.textContent==='Gestão de envios Full'){
   e.preventDefault();w.history.pushState({},'','/shipping/inbounds');w.document.body.innerHTML=F.management();
  }else if(e.target.textContent==='Terminar envio'){
   w.history.pushState({},'','/shipping/inbounds/12345678/hub-v2');w.document.body.innerHTML=F.hub();
  }else if(e.target.getAttribute('href')?.endsWith('/appointment')){
   e.preventDefault();w.history.pushState({},'','/shipping/inbounds/12345678/appointment-v2');w.document.body.innerHTML=F.appointment().match(/<body>([\s\S]*)<\/body>/)[1];
  }
 }});t.after(()=>h.w.close());h.start();await h.until('SCAN_COMPLETE');assert.equal(h.clicks.length,3);assert.equal(h.events.some(e=>e.event==='BEFORE_CONFIRM'),false);
});
test('parar enquanto a lista carrega impede qualquer clique posterior',async t=>{
 const h=setup({html:'<main><h1>Gestão de envios Full</h1></main>',url:'/shipping/inbounds'});t.after(()=>h.w.close());
 h.start();await h.until('PHASE');h.stop();h.w.document.body.innerHTML=F.management();await new Promise(r=>setTimeout(r,180));assert.equal(h.clicks.length,0);
});

function pickupHarness({result=F.noDates(),delay=0,value,expanded=false,badge=true,onClick,onMessage,config={}}={}) {
 return setup({html:F.unbookedAppointment({value,expanded,badge}),config,onMessage,onClick:(e,w)=>{
  const trigger=w.document.querySelector('#shipment-type-selection-dropdown-id-trigger');
  const menu=w.document.querySelector('#shipment-type-selection-dropdown-id-menu-list');
  if(e.target===trigger){menu.hidden=!menu.hidden;trigger.setAttribute('aria-expanded',String(!menu.hidden));}
  if(e.target.closest('[data-key="pickup"]')){
   w.document.querySelector('[data-andes-dropdown-value]').textContent='Coleta a domicílio';
   menu.hidden=true;trigger.setAttribute('aria-expanded','false');
   const target=w.document.querySelector('#pickup-result');
   target.setAttribute('aria-busy','true');
   w.setTimeout(()=>{target.innerHTML=result;target.removeAttribute('aria-busy');},delay);
  }
  onClick?.(e,w);
 }});
}
const pickupCalendar=()=>'<input aria-label="Data da coleta" readonly value=""><div id="calendar-card" class="andes-card__content" hidden>'+F.calendar('2026-10',['2026-10-22'],'')+'<div class="apply-button-container"><button data-confirm="calendar">Confirmar</button></div></div>';

test('após F5 seleciona coleta com selo e conclui sem vaga quando o aviso aparece atrasado',async t=>{
 const h=pickupHarness({delay:250,config:{autoConfirm:true}});t.after(()=>h.w.close());h.start();
 const result=await h.until('SCAN_COMPLETE');
 assert.match(result.message,/Sem datas/);assert.equal(result.months.length,0);
 assert.deepEqual(h.clicks.map(e=>e.id),['shipment-type-selection-dropdown-id-trigger','shipment-type-selection-dropdown-id-menu-list-option-pickup']);
 assert.equal(h.events.some(e=>['RETRY','NEEDS_ATTENTION','BEFORE_CONFIRM'].includes(e.event)),false);
});
test('aviso após seleção sem selo também conclui a leitura em vez de esperar calendário',async t=>{
 const h=pickupHarness({badge:false});t.after(()=>h.w.close());h.start();await h.until('SCAN_COMPLETE');
 assert.equal(h.clicks.length,2);assert.equal(h.events.some(e=>e.event==='RETRY'),false);
});
test('nova mensagem Não há datas disponíveis após coleta conclui sem erro ou troca de método',async t=>{
 const h=pickupHarness({result:F.noMethodDates(),delay:150,config:{autoConfirm:true}});t.after(()=>h.w.close());
 h.start();await h.until('SCAN_COMPLETE');
 assert.deepEqual(h.clicks.map(e=>e.id),['shipment-type-selection-dropdown-id-trigger','shipment-type-selection-dropdown-id-menu-list-option-pickup']);
 assert.equal(h.events.some(e=>['RETRY','NEEDS_ATTENTION','BEFORE_CONFIRM'].includes(e.event)),false);
});
test('menu de envio já aberto não é fechado antes de escolher coleta',async t=>{
 const h=pickupHarness({expanded:true});t.after(()=>h.w.close());h.start();await h.until('SCAN_COMPLETE');
 assert.equal(h.clicks.length,1);assert.equal(h.clicks[0].dataset.key,'pickup');
});
test('coleta já selecionada com aviso não troca endereço nem aciona Confirmar',async t=>{
 const h=pickupHarness({value:'Coleta a domicílio',config:{autoConfirm:true}});t.after(()=>h.w.close());
 h.w.document.querySelector('#pickup-result').innerHTML=F.noDates();h.start();await h.until('SCAN_COMPLETE');assert.equal(h.clicks.length,0);
});
test('cada documento após F5 refaz a seleção; calendário posterior retoma busca em modo aviso',async t=>{
 for(let cycle=0;cycle<3;cycle++){
  const h=pickupHarness({result:cycle===2?pickupCalendar():F.noDates(),onClick:(e,w)=>{
   if(e.target.matches('input'))w.document.querySelector('#calendar-card').hidden=false;
  }});t.after(()=>h.w.close());h.start();
  const result=await h.until(cycle===2?'FOUND_DATE':'SCAN_COMPLETE');
  assert.equal(h.clicks.filter(e=>e.dataset.key==='pickup').length,1);
  assert.equal(h.clicks.some(e=>e.matches('.day,[data-confirm],[data-change-address]')),false);
  if(cycle===2)assert.equal(result.date,'2026-10-22');
  h.stop();h.w.close();
 }
});
test('parar enquanto a opção carrega impede seleção atrasada',async t=>{
 let h;h=pickupHarness({onClick:(e,w)=>{
  if(e.target.id==='shipment-type-selection-dropdown-id-trigger'){
   h.stop();w.document.querySelector('[role="listbox"]').hidden=true;
   w.setTimeout(()=>{w.document.querySelector('[role="listbox"]').hidden=false;},30);
  }
 }});t.after(()=>h.w.close());h.start();await h.until('PHASE');await new Promise(r=>setTimeout(r,200));
 assert.equal(h.clicks.length,1);assert.equal(h.events.some(e=>e.event==='SCAN_COMPLETE'),false);
});
test('envio divergente durante espera da coleta impede clique na opção',async t=>{
 const h=pickupHarness({onClick:(e,w)=>{
  if(e.target.id==='shipment-type-selection-dropdown-id-trigger')w.history.pushState({},'','/shipping/inbounds/79332226/appointment-v2');
 }});t.after(()=>h.w.close());h.start();await h.until('NEEDS_ATTENTION');assert.equal(h.clicks.length,1);
});
test('outro método de envio continua preservado mesmo se houver aviso sem datas',async t=>{
 const h=pickupHarness({value:'Veículo particular'});t.after(()=>h.w.close());h.w.document.querySelector('#pickup-result').innerHTML=F.noDates();
 h.start();await h.until('NEEDS_ATTENTION');assert.equal(h.clicks.length,0);
});
test('coleta restaurada retoma confirmação automática pelos dois botões na data desejada',async t=>{
 const h=pickupHarness({result:pickupCalendar(),config:{autoConfirm:true},onClick:(e,w)=>{
  if(e.target.matches('input'))w.document.querySelector('#calendar-card').hidden=false;
  if(e.target.matches('.day'))e.target.classList.add('day--selected');
  if(e.target.dataset.confirm==='calendar'){
   w.document.querySelector('input').value='22 de outubro';w.document.querySelector('#calendar-card').hidden=true;
  }
  if(e.target.dataset.confirm==='final'){
   w.history.pushState({},'','/shipping/inbounds/12345678/hub-v2');w.document.body.innerHTML=F.hub('12345678','22 de outubro');
  }
 }});t.after(()=>h.w.close());h.start();const result=await h.until('CONFIRMATION_RESULT');
 assert.equal(result.confirmed,true);
 assert.deepEqual(h.clicks.filter(e=>e.dataset.confirm).map(e=>e.dataset.confirm),['calendar','final']);
 assert.equal(h.events.filter(e=>e.event==='BEFORE_CONFIRM').length,1);
});
test('aguarda dropdown de envio renderizado com atraso após a recarga',async t=>{
 const h=pickupHarness();t.after(()=>h.w.close());
 const control=h.w.document.querySelector('#shipment-type-selection-dropdown-id');control.hidden=true;
 h.start();h.w.setTimeout(()=>{control.hidden=false;},250);await h.until('SCAN_COMPLETE');assert.equal(h.clicks.length,2);
});
test('verificação de acesso durante carregamento da coleta pausa sem clicar no calendário',async t=>{
 const h=pickupHarness({result:pickupCalendar(),delay:250,onClick:(e,w)=>{
  if(e.target.dataset.key==='pickup')w.document.body.insertAdjacentHTML('beforeend','<div id="captcha">Verificação</div>');
 }});t.after(()=>h.w.close());h.start();const result=await h.until('NEEDS_ATTENTION');
 assert.match(result.message,/verificação/);assert.equal(h.clicks.length,2);assert.equal(h.events.some(e=>e.event==='SCAN_COMPLETE'),false);
});
