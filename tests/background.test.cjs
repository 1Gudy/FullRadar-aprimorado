const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const {webcrypto}=require('node:crypto');
const root=path.resolve(__dirname,'..');
function harness(initial={}) {
  let now=Date.parse('2026-10-18T15:00:00Z');
  class Clock extends Date { constructor(...a){super(...(a.length?a:[now]));}static now(){return now;} }
  const state=structuredClone(initial),alarms=new Map(),notifications=[],reloads=[],messages=[];
  const tab={id:7,status:'complete',title:'Agendamento',url:'https://vendedores.mercadolivre.com.br/shipping/inbounds/12345678/appointment-v2'};
  let page={schedulePage:true,supported:true,shipmentId:'12345678',version:'0.2.0'};
  let ack={ok:true};
  const listeners={};
  const event=name=>({addListener:fn=>{listeners[name]=fn;}});
  const chrome={
    runtime:{getManifest:()=>({version:'0.2.0'}),onMessage:event('message'),onStartup:event('startup'),onInstalled:event('installed')},
    storage:{local:{get:async keys=>{let obj={};for(const k of Array.isArray(keys)?keys:[keys])obj[k]=structuredClone(state[k]);return obj;},set:async values=>Object.assign(state,structuredClone(values))}},
    alarms:{create:async(name,a)=>alarms.set(name,a),clear:async name=>alarms.delete(name),onAlarm:event('alarm')},
    tabs:{get:async id=>{if(id!==7)throw Error('closed');return {...tab};},query:async()=>[{...tab}],reload:async id=>reloads.push(id),sendMessage:async(id,m)=>{messages.push(m);if(m.type==='PAGE_INFO')return page;return ack;},onRemoved:event('removed'),update:async()=>{}},
    notifications:{create:async(id,n)=>notifications.push(n),onClicked:event('notification')},
    permissions:{contains:async()=>false}
  };
  const ctx=vm.createContext({chrome,crypto:webcrypto,Date:Clock,URL,Intl,console,AbortController,setTimeout,clearTimeout,btoa,fetch:()=>{throw Error('Nenhuma rede deve ser usada nos testes');}});
  ctx.importScripts=(...files)=>files.forEach(file=>{if(file==='telegram-config.js')return;vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx,{filename:file});});
  vm.runInContext(fs.readFileSync(path.join(root,'background.js'),'utf8'),ctx,{filename:'background.js'});
  const call=(message,sender={})=>new Promise(resolve=>listeners.message(message,sender,resolve));
  const search=()=>state.findfullSearches?.['7'];
  const sender=()=>({tab:{...tab},frameId:0,url:tab.url});
  const content=(event,fields={})=>call({type:'CONTENT_EVENT',searchId:search()?.id,event,...fields},sender());
  const start=(config={})=>call({type:'START_SEARCH',scope:'active',tabId:7,config:{mode:'range',startDate:'2026-10-21',endDate:'2026-10-23',intervalSeconds:90,...config}});
  const fire=async()=>{const alarm=alarms.get('findfull-scan-7');if(!alarm)throw Error('alarm missing');now=alarm.when;await listeners.alarm({name:'findfull-scan-7',scheduledTime:now});};
  return {state,alarms,notifications,reloads,messages,tab,listeners,search,call,content,start,fire,advance:ms=>now+=ms,setPage:v=>page=v,setAck:v=>ack=v};
}
test('início associa automaticamente o ID aberto e não confirma por padrão',async()=>{
  const h=harness();assert.equal((await h.start()).ok,true);assert.equal(h.search().config.shipmentId,'12345678');assert.equal(h.search().config.autoConfirm,false);assert.equal(h.search().status,'scanning');assert.ok(h.alarms.size);
});
test('início ignora ID antigo do formulário e captura o da URL',async()=>{const h=harness();assert.equal((await h.start({shipmentId:'79332226'})).ok,true);assert.equal(h.search().config.shipmentId,'12345678');});

test('timer de 15 segundos recarrega uma vez e alarme mantém fallback de 30',async()=>{
 const h=harness();await h.start({intervalSeconds:15});const reply=await h.content('SCAN_COMPLETE');
 assert.equal(h.alarms.get('findfull-scan-7').when-reply.nextRefreshAt,15000);
 assert.equal((await h.content('REFRESH_DUE')).ok,false);h.advance(15000);
 await h.content('REFRESH_DUE');await h.content('REFRESH_DUE');assert.deepEqual(h.reloads,[7]);assert.equal(h.search().status,'loading');
});
test('falha aumenta 15 para 30 e 60; sucesso mantém intervalo mais estável',async()=>{
 const h=harness();await h.start({intervalSeconds:15});await h.content('RETRY',{message:'Demora'});assert.equal(h.search().effectiveIntervalSeconds,30);
 await h.content('RETRY',{message:'Demora'});assert.equal(h.search().effectiveIntervalSeconds,60);
 await h.content('SCAN_COMPLETE');assert.equal(h.search().effectiveIntervalSeconds,60);assert.equal(h.search().failures,0);
});
test('monitor sem resposta não finge que fez a leitura',async()=>{const h=harness();h.setAck(null);await h.start();assert.equal(h.search().checks,0);assert.equal(h.search().failures,1);assert.equal(h.search().status,'monitoring');});
test('leitura sem vaga agenda nova recarga e registra verificação',async()=>{
  const h=harness();await h.start();await h.content('SCAN_COMPLETE',{months:['2026-10'],message:'Sem vaga'});assert.equal(h.search().checks,1);await h.fire();assert.deepEqual(h.reloads,[7]);assert.equal(h.search().status,'loading');
});
test('aviso sem datas mantém recargas normais por mais de quatro ciclos sem pausar',async()=>{
 const h=harness();h.setPage({schedulePage:true,supported:true,shipmentId:'12345678',noCollectionDates:true,version:'0.2.0'});
 assert.equal((await h.start({intervalSeconds:15})).ok,true);
 for(let cycle=0;cycle<6;cycle++){
  await h.content('PHASE',{status:'scanning'});
  const reply=await h.content('SCAN_COMPLETE',{months:[],message:'Sem datas disponíveis para este endereço.'});
  assert.equal(reply.nextRefreshAt-h.search().updatedAt,15000);
  assert.equal(h.search().failures,0);assert.equal(h.search().effectiveIntervalSeconds,15);
  assert.equal(h.search().status,'monitoring');assert.equal(h.search().checks,cycle+1);
  h.advance(15000);await h.content('REFRESH_DUE');assert.equal(h.reloads.length,cycle+1);
 }
});
test('data encontrada interrompe alarmes e preserva a reserva',async()=>{
  const h=harness();await h.start();await h.content('FOUND_DATE',{date:'2026-10-22',message:'Reserva preservada'});assert.equal(h.search().status,'found');assert.equal(h.alarms.size,0);assert.equal(h.reloads.length,0);
});
test('data fora do intervalo não é aceita como resultado',async()=>{
  const h=harness();await h.start();assert.equal((await h.content('FOUND_DATE',{date:'2026-10-26'})).ok,false);assert.equal(h.search().status,'scanning');
});
test('falhas temporárias continuam recarregando além de quatro tentativas com espera limitada',async()=>{
 const h=harness();await h.start({intervalSeconds:15});
 for(let i=0;i<12;i++){
  await h.content('RETRY',{message:'Página incompleta'});
  assert.equal(h.search().status,'monitoring');assert.equal(h.search().running,true);
  assert.equal(h.search().failures,i+1);assert.equal(h.search().checks,0);
  assert.equal(h.search().effectiveIntervalSeconds,Math.min(15*2**(i+1),900));
  await h.fire();assert.equal(h.reloads.length,i+1);
  await h.content('PHASE',{status:'scanning'});
 }
 await h.content('SCAN_COMPLETE',{months:[]});assert.equal(h.search().failures,0);
 assert.equal(h.search().config.startDate,'2026-10-21');assert.equal(h.notifications.length,0);
 await h.call({type:'STOP_SEARCH',tabId:7});assert.equal(h.alarms.size,0);
 assert.equal((await h.content('REFRESH_DUE')).ok,false);assert.equal(h.reloads.length,12);
});
test('tentativa de recuperação após espera reinicia limite de etapas sem pausar a busca inteira',async()=>{
 const h=harness();await h.start({intervalSeconds:15});
 for(let attempt=0;attempt<5;attempt++){
  for(const step of ['error','management','preparation'])assert.equal((await h.content('PHASE',{status:'recovering',step})).ok,true);
  await h.content('RETRY',{message:'Navegação ainda carregando'});assert.equal(h.search().status,'monitoring');
  assert.equal(h.search().recoveryHops,0);await h.fire();
 }
 assert.equal(h.reloads.length,5);assert.equal(h.notifications.length,0);
});
test('parar invalida eventos atrasados',async()=>{
  const h=harness();await h.start();const id=h.search().id;await h.call({type:'STOP_SEARCH',tabId:7});await h.call({type:'CONTENT_EVENT',searchId:id,event:'SCAN_COMPLETE'}, {tab:h.tab,frameId:0,url:h.tab.url});assert.equal(h.search(),undefined);assert.equal(h.alarms.size,0);
});
test('reiniciar busca invalida mensagem da busca anterior',async()=>{
  const h=harness();await h.start();const old=h.search().id;await h.start();assert.equal((await h.call({type:'CONTENT_EVENT',searchId:old,event:'FOUND_DATE',date:'2026-10-22'},{tab:h.tab,url:h.tab.url})).ok,false);assert.equal(h.search().status,'scanning');
});
test('autorização final só vale uma vez e após seleção explícita',async()=>{
  const h=harness();await h.start({autoConfirm:true,automationVersion:2});await h.content('PHASE',{status:'selecting',date:'2026-10-22'});assert.equal((await h.content('BEFORE_CONFIRM',{date:'2026-10-22'})).ok,true);assert.equal((await h.content('BEFORE_CONFIRM',{date:'2026-10-22'})).ok,false);assert.equal(h.search().status,'confirming');
});
test('modo somente avisar não recebe autorização para confirmar',async()=>{
  const h=harness();await h.start();assert.equal((await h.content('PHASE',{status:'selecting',date:'2026-10-22'})).ok,false);assert.equal((await h.content('BEFORE_CONFIRM',{date:'2026-10-22'})).ok,false);
});
test('watchdog durante confirmação pausa e nunca recarrega',async()=>{
  const h=harness();await h.start({autoConfirm:true,automationVersion:2});await h.content('PHASE',{status:'selecting',date:'2026-10-22'});await h.content('BEFORE_CONFIRM',{date:'2026-10-22'});await h.fire();assert.equal(h.search().status,'needs_attention');assert.equal(h.reloads.length,0);
});
test('mudança para outro envio pausa antes de recarregar',async()=>{
  const h=harness();await h.start();await h.content('SCAN_COMPLETE');h.tab.url=h.tab.url.replace('12345678','79332226');await h.fire();assert.equal(h.search().status,'needs_attention');assert.equal(h.reloads.length,0);
});
test('recovery tem alarme watchdog para não ficar preso para sempre',async()=>{
  const h=harness();await h.start();await h.content('PHASE',{status:'recovering',step:'management'});assert.ok(h.alarms.size);await h.fire();assert.equal(h.search().status,'monitoring');assert.equal(h.search().failures,1);
});
test('reinício recupera alarmes de busca ativa',async()=>{
  const h=harness();await h.start();await h.content('SCAN_COMPLETE');h.alarms.clear();await h.listeners.startup();assert.ok(h.alarms.size);assert.equal(h.search().status,'monitoring');
});
test('retomar usa a configuração atual, incluindo desativar confirmação',async()=>{
  const h=harness();await h.start({autoConfirm:true,automationVersion:2});await h.content('NEEDS_ATTENTION',{message:'Revisar'});await h.call({type:'RESUME_SEARCH',tabId:7,config:{autoConfirm:false,automationVersion:2}});assert.equal(h.search().config.autoConfirm,false);
});

test('redirecionamento após F5 para Gestão preserva ID e despacha recuperação',async()=>{
 const h=harness();await h.start();await h.content('SCAN_COMPLETE');await h.fire();
 h.tab.url='https://vendedores.mercadolivre.com.br/shipping/inbounds';h.setPage({schedulePage:false,recoveryStep:'management',shipmentId:'',version:'0.2.1'});
 await h.fire();assert.equal(h.search().config.shipmentId,'12345678');assert.equal(h.search().status,'scanning');
 assert.equal(h.messages.at(-1).type,'SCAN');assert.equal(h.reloads.length,1);
});
test('carregamento perdido é retomado pelo watchdog quando a página está pronta',async()=>{
 const h=harness();await h.start();await h.content('SCAN_COMPLETE');await h.fire();await h.fire();
 assert.equal(h.search().status,'scanning');assert.equal(h.messages.at(-1).type,'SCAN');assert.equal(h.reloads.length,1);
});
test('página incompleta recebe recarga após espera em vez de só reagendar',async()=>{
 const h=harness();await h.start();await h.content('RETRY',{message:'Página incompleta'});h.setPage({schedulePage:false,recoveryStep:'',shipmentId:'12345678'});
 await h.fire();assert.equal(h.reloads.length,1);assert.equal(h.search().status,'loading');
});

test('aba em loading com calendário reconhecido mantém ciclos de 15 s sem falsos erros',async()=>{
 const h=harness();await h.start({intervalSeconds:15});h.tab.status='loading';
 for(let i=0;i<5;i++){
  await h.content('SCAN_COMPLETE');h.advance(15000);await h.content('REFRESH_DUE');
  assert.equal(h.search().status,'loading');assert.equal(h.search().failures,0);assert.equal(h.search().effectiveIntervalSeconds,15);
  await h.content('PHASE',{status:'scanning'});
 }
 assert.equal(h.reloads.length,5);assert.equal(h.notifications.length,0);
});

test('Gestão reconhecida recupera mesmo quando o navegador ainda informa loading',async()=>{
 const h=harness();await h.start({intervalSeconds:15});await h.content('SCAN_COMPLETE');
 h.tab.status='loading';h.tab.url='https://vendedores.mercadolivre.com.br/shipping/inbounds';
 h.setPage({schedulePage:false,recoveryStep:'management',shipmentId:''});
 await h.fire();assert.equal(h.search().status,'scanning');assert.equal(h.messages.at(-1).type,'SCAN');
 assert.equal(h.search().config.shipmentId,'12345678');assert.equal(h.search().failures,0);assert.equal(h.reloads.length,0);
});

test('watchdog retoma leitura pronta durante loading sem aumentar intervalo',async()=>{
 const h=harness();await h.start({intervalSeconds:15});await h.content('SCAN_COMPLETE');await h.fire();h.tab.status='loading';
 await h.fire();assert.equal(h.search().status,'scanning');assert.equal(h.messages.at(-1).type,'SCAN');
 assert.equal(h.search().failures,0);assert.equal(h.search().effectiveIntervalSeconds,15);assert.equal(h.reloads.length,1);
});

test('carregamento sem formulário continua usando espera progressiva',async()=>{
 const h=harness();await h.start({intervalSeconds:15});await h.content('SCAN_COMPLETE');h.tab.status='loading';h.setPage(null);
 await h.fire();assert.equal(h.search().failures,1);assert.equal(h.search().effectiveIntervalSeconds,30);
 assert.equal(h.search().status,'monitoring');assert.equal(h.reloads.length,0);
});

test('verificação de acesso durante loading pausa em vez de contar falha de carregamento',async()=>{
 const h=harness();await h.start();await h.content('SCAN_COMPLETE');h.tab.status='loading';
 h.setPage({challenge:true,message:'Conclua a verificação manualmente.'});await h.fire();
 assert.equal(h.search().status,'needs_attention');assert.equal(h.search().failures,0);assert.equal(h.reloads.length,0);
});

async function cleanCheck(h) {
 if(h.search().status==='monitoring')await h.fire();
 await h.content('PHASE',{status:'scanning'});
 return h.content('SCAN_COMPLETE',{message:'Sem vaga'});
}

test('agendador reduz após 20 ciclos completos simulados e devolve ao timer o novo prazo',async()=>{
 const h=harness();await h.start({intervalSeconds:15});await h.content('RETRY',{message:'Erro'});await h.content('RETRY',{message:'Erro'});
 for(let i=0;i<19;i++)await cleanCheck(h);assert.equal(h.search().effectiveIntervalSeconds,60);
 const reply=await cleanCheck(h);assert.equal(h.search().effectiveIntervalSeconds,30);
 assert.equal(reply.nextRefreshAt-h.search().updatedAt,30000);
 for(let i=0;i<20;i++)await cleanCheck(h);assert.equal(h.search().effectiveIntervalSeconds,15);
 assert.equal(h.search().nextRefreshAt-h.search().updatedAt,15000);
 assert.equal(h.notifications.length,0);
});

test('retorno da Gestão aumenta uma vez e não conta as etapas como leituras estáveis',async()=>{
 const h=harness();await h.start({intervalSeconds:15});
 for(const step of ['error','management','preparation'])await h.content('PHASE',{status:'recovering',step});
 await h.content('PHASE',{status:'scanning'});await h.content('SCAN_COMPLETE');
 assert.equal(h.search().effectiveIntervalSeconds,30);assert.equal(h.search().cadence.stableChecks,0);assert.equal(h.search().checks,1);
 await cleanCheck(h);assert.equal(h.search().cadence.stableChecks,1);
});

test('recuperação que já teve RETRY não aumenta novamente ao concluir',async()=>{
 const h=harness();await h.start({intervalSeconds:15});await h.content('PHASE',{status:'recovering',step:'management'});
 await h.content('RETRY',{message:'Lista atrasada'});await h.content('PHASE',{status:'recovering',step:'preparation'});await h.content('SCAN_COMPLETE');
 assert.equal(h.search().effectiveIntervalSeconds,30);assert.equal(h.search().cadence.stableChecks,0);
});

test('evento de conclusão duplicado não aumenta verificações nem adianta redução',async()=>{
 const h=harness();await h.start({intervalSeconds:15});await h.content('RETRY',{message:'Erro'});await cleanCheck(h);
 const before=structuredClone(h.search());
 for(let i=0;i<25;i++)assert.equal((await h.content('SCAN_COMPLETE')).ok,false);
 assert.deepEqual(h.search(),before);
});

test('falha ao experimentar 15 segundos exige 40 ciclos antes da nova tentativa',async()=>{
 const h=harness();await h.start({intervalSeconds:15});await h.content('RETRY',{message:'Erro'});
 for(let i=0;i<20;i++)await cleanCheck(h);assert.equal(h.search().effectiveIntervalSeconds,15);
 for(let i=0;i<4;i++)await cleanCheck(h);
 await h.fire();await h.content('RETRY',{message:'Erro ao acelerar'});assert.equal(h.search().effectiveIntervalSeconds,30);
 for(let i=0;i<39;i++)await cleanCheck(h);assert.equal(h.search().effectiveIntervalSeconds,30);
 await cleanCheck(h);assert.equal(h.search().effectiveIntervalSeconds,15);
});

test('reinício do worker preserva sequência estável e busca antiga sem cadência é compatível',async()=>{
 const h=harness();await h.start({intervalSeconds:15});await h.content('RETRY',{message:'Erro'});
 for(let i=0;i<19;i++)await cleanCheck(h);
 const resumed=harness(h.state);await resumed.listeners.startup();await cleanCheck(resumed);
 assert.equal(resumed.search().effectiveIntervalSeconds,15);
 delete resumed.search().cadence;delete resumed.search().cycleSampled;await resumed.content('SCAN_COMPLETE');
 assert.equal(resumed.search().effectiveIntervalSeconds,15);
});

test('recuperação depois de uma leitura encerrada também inicia novo ciclo instável',async()=>{
 const h=harness();await h.start({intervalSeconds:15});await cleanCheck(h);
 await h.content('PHASE',{status:'recovering',step:'management'});await h.content('PHASE',{status:'scanning'});await h.content('SCAN_COMPLETE');
 assert.equal(h.search().checks,2);assert.equal(h.search().effectiveIntervalSeconds,30);assert.equal(h.search().cadence.stableChecks,0);
});
