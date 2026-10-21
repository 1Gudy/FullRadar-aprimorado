// Prévia local e isolada do popup. chrome.* é simulado; não acessa o Mercado Livre ou Telegram.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const mock=`
let search=null;
const config={mode:'range',startDate:'2026-10-21',endDate:'2026-10-23',intervalSeconds:15,shipmentId:'12345678',autoConfirm:false,automationVersion:2};
const scenario=new URL(location.href).searchParams.get('cadence');
if(scenario==='reference'){const frozen=Date.now();Date.now=()=>frozen;}
if(['stable','cautious','probe','reference','recovering','found','needs_attention'].includes(scenario)){
 const seconds=scenario==='stable'?60:['cautious','reference'].includes(scenario)?30:15;
 search={running:true,status:'monitoring',config,effectiveIntervalSeconds:seconds,checks:12,lastCheckedAt:Date.now(),nextRefreshAt:Date.now()+seconds*1000,resultMessage:'SIMULAÇÃO: nenhuma reserva real.',cadence:{version:1,intervalSeconds:seconds,stableChecks:scenario==='probe'?0:12,probeFromSeconds:scenario==='probe'?30:0,probeRemaining:scenario==='probe'?3:0,penalties:scenario==='cautious'?{15:1}:{}}};
 if(scenario==='reference')search.nextRefreshAt=Date.now()+12000;
 if(['recovering','found','needs_attention'].includes(scenario)){search.status=scenario;search.running=scenario==='recovering';if(scenario==='found')search.foundDate='2026-10-22';}
}
window.chrome={storage:{local:{get:async key=>({[key]:JSON.parse(localStorage.getItem(key)||'null')}),set:async values=>{for(const [key,value] of Object.entries(values))localStorage.setItem(key,JSON.stringify(value));}}},runtime:{sendMessage:async m=>{
 if(m.type==='GET_OVERVIEW')return {activeTabId:7,activeSupportedPage:true,activeSchedulePage:true,activeRecoveryStep:search?.status==='recovering'?'management':'',tabs:[{id:7,title:'Envio de teste · 12 unidades',shipmentId:'12345678',supportedPage:true,search}],lastConfig:config,errorLog:[]};
 if(m.type==='GET_TELEGRAM_STATUS')return {available:false};
 if(m.type==='START_SEARCH'||m.type==='RESUME_SEARCH'){search={running:true,status:'monitoring',config:{...m.config,shipmentId:'12345678'},checks:1,lastCheckedAt:Date.now(),nextRefreshAt:Date.now()+m.config.intervalSeconds*1000,resultMessage:'SIMULAÇÃO: datas verificadas, sem vaga.'};return {ok:true,results:[{ok:true}]};}
 if(m.type==='STOP_SEARCH'||m.type==='STOP_ALL'){search=null;return {ok:true};}
 return {ok:true};
}},permissions:{request:async()=>false},tabs:{create:async()=>{throw Error('Navegação externa desativada na prévia');}}};
`;
const allowed=new Set(['popup.html','popup.js','popup.css','core.js','telegram-config.js','design-system/tokens.css','icons/icon128.png','icons/icon16.png','icons/icon32.png','icons/icon48.png']);
for(const dir of ['icons/ui','fonts'])for(const name of fs.readdirSync(path.join(root,dir)))allowed.add(dir+'/'+name);
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://127.0.0.1').pathname;
 if(pathname==='/preview-mock.js'){res.setHeader('Content-Type','text/javascript');return res.end(mock);}
 const file=pathname==='/'?'popup.html':pathname.slice(1);
 if(!allowed.has(file)){res.writeHead(404);return res.end('Not found');}
 let data=fs.readFileSync(path.join(root,file));
 if(file==='popup.html')data=data.toString().replace('<script src="core.js">','<script src="/preview-mock.js"></script><script src="core.js">').replace('<footer>','<p class="preview-banner">PRÉVIA LOCAL · dados simulados</p><footer>');
 res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':file.endsWith('.svg')?'image/svg+xml':file.endsWith('.woff2')?'font/woff2':'image/png');
 res.setHeader('Cache-Control','no-store');
 res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:");
 res.end(data);
});
server.listen(0,'127.0.0.1',()=>console.log('Preview: http://127.0.0.1:'+server.address().port));
