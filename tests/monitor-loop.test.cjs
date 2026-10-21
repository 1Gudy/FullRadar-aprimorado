const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const {webcrypto}=require('node:crypto'),{JSDOM}=require('jsdom'),F=require('./fixtures.cjs');
const root=path.resolve(__dirname,'..');

// Worker e content reais conectados. Só navegador, relógio e servidor ML são simulados.
function monitorLoop({recoverAfterRefresh=false}={}) {
 let now=Date.parse('2026-10-19T18:00:00Z'),cycle=0,dom,contentListener,timerId=0;
 const state={},alarms=new Map(),timers=new Map(),actions=[],events=[],reloads=[],listeners={};
 const version=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8')).version;
 const tab={id:7,status:'complete',url:'https://vendedores.mercadolivre.com.br/shipping/inbounds/12345678/appointment-v2'};
 class Clock extends Date { constructor(...args){super(...(args.length?args:[now]));}static now(){return now;} }
 const event=name=>({addListener:fn=>{listeners[name]=fn;}});
 const search=()=>state.findfullSearches?.['7'];
 const request=(message,sender={})=>new Promise(resolve=>listeners.message(message,sender,resolve));
 const chrome={
  runtime:{getManifest:()=>({version}),onMessage:event('message'),onStartup:event('startup'),onInstalled:event('installed')},
  storage:{local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,structuredClone(state[key])])),set:async value=>Object.assign(state,structuredClone(value))}},
  alarms:{create:async(name,value)=>alarms.set(name,value),clear:async name=>alarms.delete(name),onAlarm:event('alarm')},
  tabs:{get:async()=>({...tab}),query:async()=>[{...tab}],sendMessage:async(id,message)=>new Promise(resolve=>contentListener(message,{},resolve)),reload:async()=>{reloads.push(now);cycle++;loadPage();},onRemoved:event('removed'),update:async()=>{}},
  notifications:{create:async()=>{},onClicked:event('notification')},permissions:{contains:async()=>false}
 };
 const context=vm.createContext({chrome,crypto:webcrypto,Date:Clock,URL,Intl,console,AbortController,setTimeout,clearTimeout,btoa,fetch:()=>{throw Error('Teste sem rede');}});
 context.importScripts=(...files)=>files.forEach(file=>{if(file!=='telegram-config.js')vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});});
 vm.runInContext(fs.readFileSync(path.join(root,'background.js'),'utf8'),context,{filename:'background.js'});
 function loadPage() {
  dom?.window.close();timers.clear();
  const management=recoverAfterRefresh&&cycle===1;
  tab.url='https://vendedores.mercadolivre.com.br/shipping/inbounds'+(management?'':'/12345678/appointment-v2');
  dom=new JSDOM(management?F.management():F.unbookedAppointment(),{url:tab.url,runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;w.Date=Clock;
  w.setTimeout=(fn,ms)=>{const id=++timerId;timers.set(id,{at:now+ms,fn});return id;};
  w.clearTimeout=id=>timers.delete(id);
  w.HTMLElement.prototype.getClientRects=function(){return this.closest('[hidden]')?[]:[{x:0,y:0,width:100,height:30}];};
  w.chrome={runtime:{getManifest:()=>({version}),onMessage:{addListener:fn=>{contentListener=fn;}},sendMessage:async message=>{
   if(message.type==='CONTENT_EVENT')events.push(message);
   return request(message,{tab:{...tab},url:tab.url,frameId:0});
  }}};
  w.document.addEventListener('click',e=>{
   actions.push({cycle,id:e.target.id,method:e.target.dataset.key,confirm:e.target.dataset.confirm,day:e.target.classList.contains('day'),href:e.target.getAttribute('href')});
   if(e.target.textContent==='Terminar envio'){
    assert.match(e.target.closest('tr').textContent,/#12345678/);
    tab.url='https://vendedores.mercadolivre.com.br/shipping/inbounds/12345678/hub-v2';
    w.history.pushState({},'',tab.url);w.document.body.innerHTML=F.unbookedHub();
   }
   if(e.target.matches('[data-testid="link-appointment"] a')){
    e.preventDefault();tab.url='https://vendedores.mercadolivre.com.br/shipping/inbounds/12345678/appointment-v2';
    w.history.pushState({},'',tab.url);w.document.body.innerHTML=F.unbookedAppointment();
   }
   if(e.target.id==='shipment-type-selection-dropdown-id-trigger'){
    w.document.querySelector('[role="listbox"]').hidden=false;e.target.setAttribute('aria-expanded','true');
   }
   if(e.target.dataset.key==='pickup'){
    w.document.querySelector('[data-andes-dropdown-value]').textContent='Coleta a domicílio';
    w.document.querySelector('[role="listbox"]').hidden=true;
    w.document.querySelector('[role="combobox"]').setAttribute('aria-expanded','false');
    w.document.querySelector('#pickup-result').innerHTML=cycle<25
     ? (cycle%2?F.noDates():F.noMethodDates())
     : '<input aria-label="Data da coleta" readonly value=""><div id="calendar-card" class="andes-card__content" hidden>'+F.calendar('2026-10',cycle<28?[]:['2026-10-22'],'')+'</div>';
   }
   if(e.target.matches('input'))w.document.querySelector('#calendar-card').hidden=false;
  });
  for(const file of ['core.js','dom-adapter.js','content.js'])w.eval(fs.readFileSync(path.join(root,file),'utf8'));
 }
 async function settled(predicate) {
  for(let i=0;i<100;i++){await new Promise(setImmediate);if(predicate())return;}
  throw Error('Ciclo não concluiu: '+JSON.stringify(search()));
 }
 loadPage();
 return {search,actions,events,reloads,alarms,
  start:()=>request({type:'START_SEARCH',tabId:7,scope:'active',config:{mode:'range',startDate:'2026-10-21',endDate:'2026-10-23',intervalSeconds:15}}),
  settled,hasTimer:()=>[...timers.values()].some(timer=>timer.at===search()?.nextRefreshAt),
  advance:async()=>{
   now=search().nextRefreshAt;
   for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.fn();}
   await settled(()=>search()?.status==='found'||(search()?.status==='monitoring'&&[...timers.values()].some(timer=>timer.at===search().nextRefreshAt)));
  },close:()=>{dom.window.close();timers.clear();}
 };
}

test('ciclo integrado: F5 e coleta por 28 leituras sem vaga até encontrar data desejada',async t=>{
 const h=monitorLoop();t.after(h.close);assert.equal((await h.start()).ok,true);
 await h.settled(()=>h.search()?.status==='monitoring'&&h.hasTimer());
 for(let cycle=0;cycle<28;cycle++){
  assert.equal(h.search().status,'monitoring');assert.equal(h.search().checks,cycle+1);
  assert.equal(h.search().effectiveIntervalSeconds,15);assert.equal(h.search().failures,0);
  assert.equal(h.actions.filter(action=>action.cycle===cycle&&action.method==='pickup').length,1);
  await h.advance();
 }
 assert.equal(h.reloads.length,28);assert.equal(h.search().status,'found');assert.equal(h.search().foundDate,'2026-10-22');
 assert.equal(h.search().running,false);assert.equal(h.alarms.size,0);assert.equal(h.hasTimer(),false);
 assert.equal(h.actions.filter(action=>action.method==='pickup').length,29);
 assert.equal(h.actions.some(action=>action.day||action.confirm),false);
 assert.equal(h.events.some(message=>['RETRY','NEEDS_ATTENTION','BEFORE_CONFIRM'].includes(message.event)),false);
});

test('ciclo integrado recupera por ID, passa pela seta do hub sem reserva e continua recarregando',async t=>{
 const h=monitorLoop({recoverAfterRefresh:true});t.after(h.close);assert.equal((await h.start()).ok,true);
 await h.settled(()=>h.search()?.status==='monitoring'&&h.hasTimer());await h.advance();
 assert.equal(h.search().status,'monitoring');assert.equal(h.search().checks,2);
 assert.equal(h.search().config.shipmentId,'12345678');assert.equal(h.search().effectiveIntervalSeconds,30);
 assert.deepEqual(h.actions.filter(action=>action.href).map(action=>action.href),['/shipping/inbounds/12345678/appointment']);
 assert.equal(h.actions.filter(action=>action.method==='pickup').length,2);
 await h.advance();assert.equal(h.search().status,'monitoring');assert.equal(h.search().checks,3);
 assert.equal(h.reloads.length,2);assert.equal(h.actions.filter(action=>action.method==='pickup').length,3);
 assert.equal(h.events.some(message=>['RETRY','NEEDS_ATTENTION','BEFORE_CONFIRM'].includes(message.event)),false);
});
