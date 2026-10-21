const test=require('node:test');
const assert=require('node:assert/strict');
const C=require('../core.js');
test('valida datas reais, inclusive ano bissexto',()=>{
  assert.equal(C.isIsoDate('2026-02-29'),false);
  assert.equal(C.isIsoDate('2028-02-29'),true);
  assert.equal(C.isIsoDate('2026-04-31'),false);
});
test('intervalo inclusivo e virada de mês',()=>assert.deepEqual(C.requestedDates({mode:'range',startDate:'2026-10-30',endDate:'2026-11-02'}),['2026-10-30','2026-10-31','2026-11-01','2026-11-02']));
test('intervalo solicitado é exatamente 21 a 23, sem dia 26',()=>assert.deepEqual(C.requestedDates({mode:'range',startDate:'2026-10-21',endDate:'2026-10-23'}),['2026-10-21','2026-10-22','2026-10-23']));
test('período invertido ou superior a 366 dias é rejeitado',()=>{
  assert.deepEqual(C.requestedDates({mode:'range',startDate:'2026-10-23',endDate:'2026-10-21'}),[]);
  assert.deepEqual(C.requestedDates({mode:'range',startDate:'2026-01-01',endDate:'2027-12-31'}),[]);
});
test('preserva preferências e remove repetidas e passadas',()=>assert.deepEqual(C.requestedDates({mode:'specific',dates:['2026-11-03','2026-10-22','2026-11-03','2026-10-17']},'2026-10-18'),['2026-11-03','2026-10-22']));
test('configuração antiga não herda confirmação automática',()=>{
  assert.equal(C.normalizeConfig({autoConfirm:true}).autoConfirm,false);
  assert.equal(C.normalizeConfig({autoConfirm:true,automationVersion:2}).autoConfirm,true);
  assert.equal(C.normalizeConfig({}).autoConfirm,false);
});
test('datas não mudam com fuso e calendário usa horário de São Paulo',()=>assert.equal(C.today(new Date('2026-10-18T02:59:00Z')),'2026-10-17'));
test('validação não aceita ID com outros caracteres',()=>assert.throws(()=>C.validateConfig(C.normalizeConfig({dates:['2026-10-21'],shipmentId:'abc12345678'}),'2026-10-18')));
test('identidade exige HTTPS e domínio próprio',()=>{
  assert.equal(C.isMarketplaceUrl('https://vendedores.mercadolivre.com.br/shipping/inbounds'),true);
  assert.equal(C.isMarketplaceUrl('https://mercadolivre.com.br.atacante.test/'),false);
  assert.equal(C.isMarketplaceUrl('http://vendedores.mercadolivre.com.br/'),false);
});
test('reconhece texto da data e rejeita ano explícito diferente',()=>{
  assert.equal(C.labelMatchesDate('Quarta-feira, 21 de outubro','2026-10-21'),true);
  assert.equal(C.labelMatchesDate('21 de outubro de 2027','2026-10-21'),false);
  assert.equal(C.labelMatchesDate('22 de outubro','2026-10-21'),false);
});
test('espera cresce e fica limitada',()=>{
  assert.equal(C.retrySeconds(90,1),180);
  assert.equal(C.retrySeconds(300,4),900);
});
