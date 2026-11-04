const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..'),key='fullradarPopupDraftV1';
const windows=new Set();
test.afterEach(()=>{for(const w of windows)w.close();windows.clear();});
async function setup({state={},overviewWait=null,search=null,version,diskVersion}={}) {
 const dom=new JSDOM(fs.readFileSync(path.join(root,'popup.html'),'utf8'),{url:'https://preview.local/',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,messages=[];windows.add(w);
 class Clock extends w.Date {constructor(...args){super(...(args.length?args:['2026-10-18T15:00:00Z']));}} w.Date=Clock;
 w.chrome={storage:{local:{get:async k=>({[k]:structuredClone(state[k])}),set:async v=>Object.assign(state,structuredClone(v))}},runtime:{sendMessage:async m=>{
  messages.push(m);
  if(m.type==='GET_OVERVIEW'){if(overviewWait)await overviewWait;return {version,activeTabId:7,activeSupportedPage:true,activeSchedulePage:true,tabs:[{id:7,title:'Envio teste',shipmentId:'12345678',supportedPage:true,search}],lastConfig:{mode:'range',startDate:'2026-10-24',endDate:'2026-10-26',intervalSeconds:15},errorLog:[]};}
  if(m.type==='START_SEARCH')return {ok:true,results:[{ok:true}]};
  return {ok:true};
 }}};
 if(diskVersion){w.chrome.runtime.getURL=file=>'chrome-extension://fullradar/'+file;w.fetch=async()=>({json:async()=>({version:diskVersion})});}
 for(const file of ['core.js','popup.js'])w.eval(fs.readFileSync(path.join(root,file),'utf8'));
 const $=selector=>w.document.querySelector(selector);
 const tick=()=>new Promise(r=>setTimeout(r,0));await tick();
 const click=selector=>$(selector).click();
 const input=(selector,value)=>{$(selector).value=value;$(selector).dispatchEvent(new w.Event('input',{bubbles:true}));};
 return {w,$,state,messages,click,input,tick};
}
test('calendário salva período sem iniciar e restaura após fechar',async t=>{
 const state={},h=await setup({state});
 h.click('[data-date="2026-10-21"]');h.click('[data-date="2026-10-23"]');
 assert.equal(state[key].startDate,'2026-10-21');assert.equal(state[key].endDate,'2026-10-23');
 assert.equal(h.messages.some(m=>m.type==='START_SEARCH'),false);h.w.close();
 const again=await setup({state});t.after(()=>again.w.close());
 assert.equal(again.$('#startDateButton').textContent,'21/10/2026');assert.equal(again.$('#endDateButton').textContent,'23/10/2026');
 assert.equal(again.$('[data-date="2026-10-22"]').getAttribute('aria-pressed'),'true');assert.equal(again.$('#autoConfirm').checked,false);
});
test('período incompleto continua esperando data final ao reabrir',async t=>{
 const state={},h=await setup({state});h.click('[data-date="2026-10-28"]');h.w.close();
 const again=await setup({state});t.after(()=>again.w.close());assert.equal(again.$('#endDate').value,'');
 assert.match(again.$('#calendarHint').textContent,/data final/);again.click('[data-date="2026-10-29"]');assert.equal(state[key].endDate,'2026-10-29');
});
test('datas específicas guardam ordem, remoção e digitação parcial',async t=>{
 const state={},h=await setup({state});h.click('[data-mode="specific"]');h.click('[data-date="2026-10-23"]');h.click('[data-date="2026-10-21"]');
 assert.equal(h.$('#dates').value,'23/10/2026\n21/10/2026');h.click('[data-date="2026-10-23"]');assert.equal(h.$('#dates').value,'21/10/2026');
 h.input('#dates','21/');h.w.close();const again=await setup({state});t.after(()=>again.w.close());assert.equal(again.$('#dates').value,'21/');
});
test('resposta atrasada do estado não apaga escolha feita enquanto carrega',async t=>{
 let resolve;const promise=new Promise(r=>resolve=r);const h=await setup({overviewWait:promise});t.after(()=>h.w.close());
 h.click('[data-date="2026-10-21"]');h.click('[data-date="2026-10-23"]');resolve();await h.tick();
 assert.equal(h.$('#startDate').value,'2026-10-21');assert.equal(h.$('#endDate').value,'2026-10-23');
});
test('envio detectado aparece sem campo manual; iniciar não transmite ID do formulário',async t=>{
 const h=await setup();t.after(()=>h.w.close());assert.equal(h.$('#shipmentId'),null);assert.match(h.$('#shipmentDetected').textContent,/12345678/);
 h.click('#startActive');await h.tick();const m=h.messages.find(m=>m.type==='START_SEARCH');assert.ok(m);assert.equal(m.config.shipmentId,undefined);assert.equal(m.config.autoConfirm,false);
});
test('calendário navega mês sem perder seleção e bloqueia passado',async t=>{
 const h=await setup();t.after(()=>h.w.close());assert.equal(h.$('[data-date="2026-10-17"]').disabled,true);
 h.click('#nextMonth');assert.match(h.$('#calendarMonth').textContent,/novembro/);h.click('[data-date="2026-11-03"]');
 assert.equal(h.$('#startDate').value,'2026-11-03');h.click('#previousMonth');assert.match(h.$('#calendarMonth').textContent,/outubro/);
});

test('popup mostra o intervalo escolhido mesmo com busca salva pela versão anterior',async()=>{
 const h=await setup({search:{running:true,status:'monitoring',config:{intervalSeconds:10},effectiveIntervalSeconds:30,cadence:{version:1,intervalSeconds:30,stableChecks:12,penalties:{15:1}}}});
 assert.match(h.$('#refreshDetail').textContent,/a cada 10 s/);assert.doesNotMatch(h.$('#refreshDetail').textContent,/verificações estáveis/);
 assert.equal(h.$('#monitorInterval').textContent,'Intervalo escolhido · 10 s');
});

test('seletor de frequência oferece 5 a 30 s de 5 em 5 e envia o valor escolhido',async()=>{
 const h=await setup();const input=h.$('#interval');
 assert.equal(input.min,'5');assert.equal(input.max,'30');assert.equal(input.step,'5');
 input.value='5';input.dispatchEvent(new h.w.Event('input'));assert.equal(h.$('#intervalOutput').textContent,'5 s');
 h.click('#startActive');await h.tick();assert.equal(h.messages.find(m=>m.type==='START_SEARCH').config.intervalSeconds,5);
});

test('mudar a frequência com busca ativa aplica na hora, sem reiniciar a busca',async()=>{
 const h=await setup({search:{running:true,status:'monitoring',config:{mode:'range',startDate:'2026-10-21',endDate:'2026-10-23',intervalSeconds:15,shipmentId:'12345678',autoConfirm:false,automationVersion:2}}});
 const input=h.$('#interval');input.value='5';input.dispatchEvent(new h.w.Event('input'));input.dispatchEvent(new h.w.Event('change'));await h.tick();
 const m=h.messages.find(m=>m.type==='SET_INTERVAL');assert.deepEqual([m.tabId,m.intervalSeconds],[7,5]);
 assert.equal(h.messages.some(m=>m.type==='START_SEARCH'||m.type==='STOP_SEARCH'),false);assert.equal(h.$('#pendingChanges').hidden,true);
});

test('sem busca ativa, mudar a frequência só salva a preferência',async()=>{
 const h=await setup();const input=h.$('#interval');input.value='10';input.dispatchEvent(new h.w.Event('input'));input.dispatchEvent(new h.w.Event('change'));await h.tick();
 assert.equal(h.messages.some(m=>m.type==='SET_INTERVAL'),false);assert.equal(h.state[key].intervalSeconds,10);
});

test('popup avisa quando o Chrome ainda roda a versão antiga da extensão',async()=>{
 const stale=await setup({diskVersion:'0.3.8',version:'0.3.6'});await stale.tick();
 assert.match(stale.$('#actionMessage').textContent,/versão antiga da extensão \(v0\.3\.6\).*recarregar/);
 const old=await setup({diskVersion:'0.3.8'});await old.tick();assert.match(old.$('#actionMessage').textContent,/versão antiga/);
 const current=await setup({diskVersion:'0.3.8',version:'0.3.8'});await current.tick();assert.equal(current.$('#actionMessage').textContent,'');
});

test('popup não exibe mais a conexão com o Telegram',async()=>{
 const h=await setup();assert.equal(h.$('#telegramPanel'),null);
 assert.equal(h.messages.some(m=>/TELEGRAM/.test(m.type)),false);
});

const activeConfig={mode:'range',startDate:'2026-10-21',endDate:'2026-10-23',intervalSeconds:15,shipmentId:'12345678',autoConfirm:false,automationVersion:2};
function liveSearch(extra={}) {return {running:true,status:'monitoring',config:{...activeConfig},...extra};}

test('Pulso abre busca ativa sem reiniciar e botão Parar envia somente STOP_SEARCH para a aba correta',async()=>{
 const search=liveSearch(),before=JSON.stringify(search),h=await setup({search});
 assert.equal(h.$('#startActive').hidden,true);assert.equal(h.$('#stopActive').hidden,false);
 assert.equal(h.$('#rangeFields').hidden,true);assert.equal(h.$('#monitorInterval').textContent,'Intervalo escolhido · 15 s');
 assert.equal(h.messages.some(m=>m.type==='START_SEARCH'||m.type==='STOP_SEARCH'),false);
 h.click('#stopActive');await h.tick();assert.deepEqual(h.messages.filter(m=>m.type==='STOP_SEARCH').map(m=>[m.type,m.tabId]),[['STOP_SEARCH',7]]);
 assert.equal(JSON.stringify(search),before);assert.equal(h.messages.some(m=>m.type==='START_SEARCH'),false);
});
test('editar datas de busca ativa só muda o rascunho até aplicar explicitamente',async()=>{
 const search=liveSearch(),before=JSON.stringify(search),h=await setup({search});
 h.click('#editDates');assert.equal(h.$('#rangeFields').hidden,false);
 h.click('[data-date="2026-10-22"]');h.click('[data-date="2026-10-23"]');await h.tick();
 assert.equal(h.$('#pendingChanges').hidden,false);assert.equal(h.$('#startActive').hidden,false);assert.equal(h.$('#stopActive').hidden,false);
 assert.equal(h.$('#datesHeading').textContent,'Próximas datas');assert.equal(JSON.stringify(search),before);
 assert.equal(h.messages.some(m=>m.type==='START_SEARCH'),false);
 h.click('#startActive');await h.tick();const m=h.messages.find(m=>m.type==='START_SEARCH');assert.equal(m.config.startDate,'2026-10-22');assert.equal(m.config.autoConfirm,false);
});
test('switch de confirmação explica efeito e não autoriza nem reinicia ao editar',async()=>{
 const h=await setup({search:liveSearch()});h.$('#autoConfirm').click();await h.tick();
 assert.equal(h.$('#autoConfirm').checked,true);assert.match(h.$('#confirmDescription').textContent,/pode alterar a reserva/);
 assert.equal(h.$('#pendingChanges').hidden,false);assert.equal(h.messages.some(m=>m.type==='START_SEARCH'||m.type==='RESUME_SEARCH'),false);
 h.$('#autoConfirm').click();assert.equal(h.$('#autoConfirm').checked,false);assert.equal(h.$('#pendingChanges').hidden,true);
});
test('recuperação e resultado não apresentam contagem nem progresso falsos',async()=>{
 const recovery=await setup({search:liveSearch({status:'recovering'})});
 assert.match(recovery.$('#monitorTitle').textContent,/Recuperando/);assert.equal(recovery.$('#monitorClock').textContent,'—');
 const found=await setup({search:liveSearch({running:false,status:'found',foundDate:'2026-10-22'})});
 assert.match(found.$('#monitorTitle').textContent,/Data encontrada/);assert.match(found.$('#monitorMessage').textContent,/reserva foi preservada/);assert.equal(found.$('#stopActive').hidden,true);
});
test('pausa oferece Retomar com os mesmos dados e confirmação desligada',async()=>{
 const h=await setup({search:liveSearch({running:false,status:'needs_attention'})});
 assert.equal(h.$('#resumeSearch').hidden,false);assert.equal(h.$('#startActive').hidden,true);
 h.click('#resumeSearch');await h.tick();const m=h.messages.find(m=>m.type==='RESUME_SEARCH');assert.equal(m.tabId,7);assert.equal(m.config.autoConfirm,false);
});

