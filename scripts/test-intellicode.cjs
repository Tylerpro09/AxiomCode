const test=require('node:test');
const assert=require('node:assert/strict');
const {LocalIntelliEngine,tokenise,version}=require('../extensions/intellicode/runtime.js');

test('Axiom IntelliCode runtime is original local engine',()=>{
  assert.equal(version,'1.0.1');
  assert.deepEqual(tokenise('alpha.beta(gamma)'),['alpha','.','beta','(','gamma',')']);
});

test('learns two-token context and predicts the next token',()=>{
  const engine=new LocalIntelliEngine();
  engine.learnText('alpha beta gamma alpha beta gamma alpha beta delta','javascript');
  const rows=engine.suggestTokens(['alpha','beta'],'g',4);
  assert.ok(rows.length);
  assert.equal(rows[0].value,'gamma');
});

test('learns project symbols for prefix completion',()=>{
  const engine=new LocalIntelliEngine();
  engine.learnText('customerProfile customerProfile customerPreferences','typescript');
  const rows=engine.suggestTokens([],'customerP',5);
  assert.ok(rows.some(x=>x.value==='customerProfile'));
  assert.ok(rows.some(x=>x.value==='customerPreferences'));
});

test('engine enforces bounded local corpus',()=>{
  const engine=new LocalIntelliEngine();
  engine.learnText('symbolName '.repeat(100000),'javascript');
  const stats=engine.status();
  assert.ok(stats.bytes<=2*1024*1024);
  assert.ok(stats.symbols<=12000);
  assert.ok(stats.contexts<=46000);
});
