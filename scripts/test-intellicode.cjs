const test=require('node:test');
const assert=require('node:assert/strict');
const {
  LocalIntelliEngine,tokenise,languageFromPath,fuzzyMatch,version
}=require('../extensions/intellicode/runtime.js');

test('Axiom IntelliCode 1.1.0 exposes the original local engine',()=>{
  assert.equal(version,'1.1.0');
  assert.deepEqual(tokenise('alpha?.beta::gamma->delta'),['alpha','?.','beta','::','gamma','->','delta']);
});

test('detects supported languages from workspace paths',()=>{
  assert.equal(languageFromPath('src/app.tsx'),'typescript');
  assert.equal(languageFromPath('tools/build.ps1'),'powershell');
  assert.equal(languageFromPath('README.md'),'markdown');
  assert.equal(languageFromPath('image.png'),null);
});

test('fuzzy matching supports prefix, case-insensitive and camelCase initials',()=>{
  assert.ok(fuzzyMatch('customerProfile','customer')>0);
  assert.ok(fuzzyMatch('CustomerProfile','customer')>0);
  assert.ok(fuzzyMatch('customerProfile','cp')>0);
  assert.equal(fuzzyMatch('customerProfile','xyz'),0);
});

test('three-token context outranks weaker alternatives',()=>{
  const engine=new LocalIntelliEngine();
  engine.learnText('alpha beta gamma delta alpha beta gamma delta alpha beta gamma omega','javascript');
  const rows=engine.suggestTokens(['alpha','beta','gamma'],'d',4,{language:'javascript'});
  assert.ok(rows.length);
  assert.equal(rows[0].value,'delta');
  assert.equal(rows[0].source,'context-3');
});

test('learns symbols by language and infers completion kind',()=>{
  const engine=new LocalIntelliEngine();
  engine.learnText('class CustomerProfile {} function loadCustomer() {} const customerCache = new Map();','javascript');
  const classes=engine.suggestTokens([],'Cust',8,{language:'javascript'});
  const functions=engine.suggestTokens([],'load',8,{language:'javascript'});
  assert.equal(classes.find(x=>x.value==='CustomerProfile')?.kind,'class');
  assert.equal(functions.find(x=>x.value==='loadCustomer')?.kind,'function');
});

test('learns receiver-specific member completions',()=>{
  const engine=new LocalIntelliEngine();
  engine.learnText('user.profile user.profile user.preferences account.balance','javascript');
  const rows=engine.suggestTokens(['user','.'],'p',8,{language:'javascript',receiver:'user'});
  assert.equal(rows[0].value,'profile');
  assert.ok(rows.some(x=>x.value==='preferences'));
});

test('learns line-prefix ghost text candidates',()=>{
  const engine=new LocalIntelliEngine();
  engine.learnText('const customerProfile = await loadCustomerProfile();\nconst customerProfile = await loadCustomerProfile();','javascript');
  const rows=engine.suggestLinePrefix('const customer','javascript',4);
  assert.ok(rows.length);
  assert.equal(rows[0].value,'const customerProfile = await loadCustomerProfile();');
  assert.ok(rows[0].suffix.startsWith('Profile'));
});

test('compact cache restores symbols without storing source text',()=>{
  const source=new LocalIntelliEngine();
  source.learnText('function calculateInvoiceTotal() {} invoiceTotal invoiceTotal','javascript');
  const compact=source.compact();
  assert.ok(JSON.stringify(compact).length<450000);
  assert.equal(JSON.stringify(compact).includes('function calculateInvoiceTotal()'),false);
  const restored=new LocalIntelliEngine();
  assert.equal(restored.seedCompact(compact),true);
  assert.ok(restored.suggestTokens([],'invoice',6,{language:'javascript'}).some(x=>x.value==='invoiceTotal'));
});

test('engine keeps corpus, symbols and contexts bounded',()=>{
  const engine=new LocalIntelliEngine();
  engine.learnText(('symbolName.memberName anotherSymbol thirdSymbol\n').repeat(250000),'javascript');
  const stats=engine.status();
  assert.ok(stats.bytes<=6*1024*1024);
  assert.ok(stats.symbols<=18000);
  assert.ok(stats.contexts<=120000);
  assert.ok(stats.lines<=5000);
});
