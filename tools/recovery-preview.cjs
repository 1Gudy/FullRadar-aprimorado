// Teste manual em localhost com content.js real e chrome.* simulado.
// Não acessa conta, cookies ou APIs do Mercado Livre. Navega entre documentos reais.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const F=require('../tests/fixtures.cjs'),root=path.resolve(__dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
const script=`
const stateKey='fullradar-recovery-test';
const read=()=>JSON.parse(localStorage.getItem(stateKey)||'null');
const write=s=>{localStorage.setItem(stateKey,JSON.stringify(s));render();};
function render(){const s=read();document.getElementById('testTrace').textContent=s?JSON.stringify({status:s.status,envio:s.config.shipmentId,etapas:s.trace},null,2):'Teste ainda não iniciado.';}
const OriginalDate=Date;
class TestDate extends OriginalDate {constructor(...args){super(...(args.length?args:['2026-10-18T15:00:00Z']));}}
window.Date=TestDate;
window.chrome={runtime:{getManifest:()=>({version:${JSON.stringify(manifest.version)}}),onMessage:{addListener:()=>{}},sendMessage:async m=>{
 const s=read();
 if(m.type==='GET_TAB_SEARCH')return s&&s.status!=='complete'?s:null;
 if(m.type!=='CONTENT_EVENT'||!s||s.id!==m.searchId)return {ok:false};
 if(m.event==='PHASE'){s.status=m.status;s.trace.push(m.step||m.status);}
 if(m.event==='SCAN_COMPLETE'){s.status='complete';s.trace.push('calendário lido; nenhuma seleção ou confirmação');}
 if(m.event==='RETRY'||m.event==='NEEDS_ATTENTION'){s.status='needs_attention';s.trace.push(m.event+': '+m.message);}
 if(m.event==='BEFORE_CONFIRM')throw Error('Confirmação proibida neste teste');
 write(s);return {ok:true};
}}};
render();
document.getElementById('testStart')?.addEventListener('click',()=>{
 write({id:crypto.randomUUID(),status:'monitoring',config:{mode:'range',startDate:'2026-10-21',endDate:'2026-10-23',shipmentId:'12345678',intervalSeconds:15,autoConfirm:false,automationVersion:2},trace:['erro simulado após recarga']});
 location.assign('/shipping/inbounds/12345678/appointment-v2?testError=1');
});
if(location.pathname==='/shipping/inbounds')setTimeout(()=>{
 document.getElementById('fixture').innerHTML=${JSON.stringify(F.management())};
 for(const row of document.querySelectorAll('#fixture tr'))row.querySelector('button').addEventListener('click',()=>{
  const id=row.textContent.match(/#(\\d+)/)[1];if(id!=='12345678')throw Error('Envio errado');
  location.assign('/shipping/inbounds/'+id+'/hub-v2');
 });
},500);
if(location.pathname.endsWith('/hub-v2'))setTimeout(()=>{document.getElementById('fixture').innerHTML=${JSON.stringify(F.hub())};},500);
`;
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'none'");
 if(url.pathname==='/test-runner.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');return res.end(script);}
 if(['/core.js','/dom-adapter.js','/content.js'].includes(url.pathname)){res.setHeader('Content-Type','text/javascript; charset=utf-8');return res.end(fs.readFileSync(path.join(root,url.pathname.slice(1))));}
 let fixture='',start=false;
 if(url.pathname==='/'){fixture='<h1>Teste de recuperação do Full Radar</h1><p>Cenário fixo de 18/10/2026: erro sem link → lista atrasada → envio correto → edição atrasada → calendário.</p><button id="testStart">Iniciar simulação de recuperação</button>';start=true;}
 else if(url.searchParams.has('testError'))fixture='<main><h2>Ocorreu um erro. Tente novamente mais tarde.</h2></main>';
 else if(url.pathname==='/shipping/inbounds')fixture='<main><h1>Gestão de envios Full</h1><input placeholder="Buscar por nome ou n. º de envio"><div role="progressbar">Carregando lista…</div></main>';
 else if(url.pathname==='/shipping/inbounds/12345678/hub-v2')fixture='<main><h1>Preparação do envio</h1><p>Envio #12345678</p><div role="progressbar">Carregando detalhes…</div></main>';
 else if(url.pathname==='/shipping/inbounds/12345678/appointment'){res.writeHead(302,{Location:'/shipping/inbounds/12345678/appointment-v2'});return res.end();}
 else if(url.pathname==='/shipping/inbounds/12345678/appointment-v2')fixture=F.appointment().match(/<body>([\s\S]*)<\/body>/)[1];
 else{res.writeHead(404);return res.end('Not found');}
 fixture='<style>#fixture,#testTrace{max-width:800px}table{width:100%;table-layout:fixed}td{font-size:12px}[aria-hidden="true"]{display:none}</style>'+fixture;
 res.setHeader('Content-Type','text/html; charset=utf-8');
 res.end('<!doctype html><html lang="pt-BR"><head><title>Full Radar — teste local de recuperação</title><style>body{font:16px system-ui;margin:24px;background:#181621;color:#eee}h1,h2{font-size:22px}button,a,input{margin:6px;padding:8px}a{color:#ccb4ff}td{padding:5px}pre{padding:16px;background:#30283e;white-space:pre-wrap}#fixture{border:1px solid #66577b;padding:16px}.day--disabled{opacity:.4}.day--selected{border:1px solid #ab8ef2}</style></head><body><p>SIMULAÇÃO LOCAL · nenhum acesso ao Mercado Livre</p><section id="fixture">'+fixture+'</section><pre id="testTrace" role="status"></pre><script src="/core.js"></script><script src="/test-runner.js"></script>'+(start?'':'<script src="/dom-adapter.js"></script><script src="/content.js"></script>')+'</body></html>');
});
server.listen(0,'127.0.0.1',()=>console.log('Recovery preview: http://127.0.0.1:'+server.address().port));
