const test = require('node:test'), assert = require('node:assert/strict');
const C = require('../core.js');
const search = (interval = 60, minimum = 15) => ({ config: { intervalSeconds: minimum }, effectiveIntervalSeconds: interval });
const step = (s, outcome, count = 1) => { for (let i = 0; i < count; i++) Object.assign(s, C.adjustCadence(s, outcome)); return s; };

test('20 leituras limpas por degrau reduzem 60 para 30 e depois 15', () => {
 const s = search(); step(s, 'success', 19); assert.equal(s.effectiveIntervalSeconds, 60);
 step(s, 'success'); assert.equal(s.effectiveIntervalSeconds, 30);
 step(s, 'success', 19); assert.equal(s.effectiveIntervalSeconds, 30);
 step(s, 'success'); assert.equal(s.effectiveIntervalSeconds, 15);
 step(s, 'success', 100); assert.equal(s.effectiveIntervalSeconds, 15);
});

test('falha durante as primeiras cinco leituras recua e exige 40, depois 80 sucessos', () => {
 const s = search(30); step(s, 'success', 20); step(s, 'success', 4); step(s, 'failure');
 assert.equal(s.effectiveIntervalSeconds, 30); assert.equal(C.cadenceStatus(s).requiredChecks, 40);
 step(s, 'success', 39); assert.equal(s.effectiveIntervalSeconds, 30);
 step(s, 'success'); assert.equal(s.effectiveIntervalSeconds, 15);
 step(s, 'failure'); assert.equal(C.cadenceStatus(s).requiredChecks, 80);
 step(s, 'success', 80); step(s, 'failure'); assert.equal(C.cadenceStatus(s).requiredChecks, 80);
});

test('cinco leituras limpas aprovam o intervalo testado e limpam sua penalidade', () => {
 const s = search(30); step(s, 'success', 20); step(s, 'failure'); step(s, 'success', 40);
 step(s, 'success', 5); assert.equal(s.cadence.probeRemaining, 0);
 step(s, 'failure'); assert.equal(s.effectiveIntervalSeconds, 30); assert.equal(C.cadenceStatus(s).requiredChecks, 20);
});

test('erro ou recuperação interrompe a sequência estável sem apagar o teste em andamento', () => {
 const s = search(); step(s, 'success', 19); step(s, 'interrupted'); assert.equal(s.cadence.stableChecks, 0);
 step(s, 'success', 20); assert.equal(s.effectiveIntervalSeconds, 30);
 step(s, 'interrupted'); step(s, 'failure');
 assert.equal(s.effectiveIntervalSeconds, 60); assert.equal(C.cadenceStatus(s).requiredChecks, 40);
});

test('cadência respeita mínimo escolhido e teto de 15 minutos', () => {
 const s = search(120, 45); step(s, 'success', 20); assert.equal(s.effectiveIntervalSeconds, 60);
 step(s, 'success', 20); assert.equal(s.effectiveIntervalSeconds, 45);
 step(s, 'success', 100); assert.equal(s.effectiveIntervalSeconds, 45);
 step(s, 'failure', 12); assert.equal(s.effectiveIntervalSeconds, 900);
 step(s, 'success', 200); assert.equal(s.effectiveIntervalSeconds, 45);
});

test('estado persiste como JSON; versão antiga começa sem sequência inventada', () => {
 const s = search(); step(s, 'success', 19); const restored = JSON.parse(JSON.stringify(s));
 step(restored, 'success'); assert.equal(restored.effectiveIntervalSeconds, 30);
 const old = search(); old.cadence = { version: 0, intervalSeconds: 60, stableChecks: 19 };
 step(old, 'success'); assert.equal(old.effectiveIntervalSeconds, 60); assert.equal(old.cadence.stableChecks, 1);
});

test('contador de outro intervalo não antecipa a redução; cálculo não altera a entrada', () => {
 const s = search(); step(s, 'success', 19); s.effectiveIntervalSeconds = 120;
 const before = JSON.stringify(s), result = C.adjustCadence(s, 'success');
 assert.equal(result.effectiveIntervalSeconds, 120); assert.equal(result.cadence.stableChecks, 1);
 assert.equal(JSON.stringify(s), before);
});
