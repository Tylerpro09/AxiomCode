const test=require('node:test');
const assert=require('node:assert/strict');
const {
  LocalIntelliEngine,VictorsAIClient,tokenise,languageFromPath,fuzzyMatch,
  chooseVictorsModel,stripCodeFence,diagnosticFromResponse,version
}=require('../extensions/intellicode/runtime.js');

function fakeResponse(status,body,headers={}){
  const map=new Map(Object.entries(headers).map(([k,v])=>[k.toLowerCase(),String(v)]));
  return {
    status,
    ok:status>=200&&status<300,
    headers:{get:name=>map.get(String(name).toLowerCase())??null},
    json:async()=>body
  };
}

test('Axiom IntelliCode 1.3.0 exposes local and Victorsia engines',()=>{
  assert.equal(version,'1.3.0');
  assert.equal(typeof VictorsAIClient,'function');
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

test('Victorsia client refuses requests without an API key',async()=>{
  const client=new VictorsAIClient({keyProvider:()=>''});
  await assert.rejects(()=>client.models(),error=>error?.code==='NO_API_KEY');
});

test('Victorsia client lists models first with unique request ID and bearer auth',async()=>{
  let captured=null;
  const client=new VictorsAIClient({
    keyProvider:()=> 'test-secret',
    uuidFn:()=> 'req-models-1',
    fetchFn:async(url,options)=>{
      captured={url,options};
      return fakeResponse(200,{data:[{id:'auto:coding'},{id:'online/example/model:free'}]},{'X-Request-ID':'req-models-1','X-Response-Time-Ms':'12.5'});
    }
  });
  const result=await client.models();
  assert.deepEqual(result.models,['auto:coding','online/example/model:free']);
  assert.equal(captured.url,'https://api.victors.qzz.io/v1/models');
  assert.equal(captured.options.headers.Authorization,'Bearer test-secret');
  assert.equal(captured.options.headers['X-Request-ID'],'req-models-1');
  assert.equal(result.diagnostic.requestId,'req-models-1');
  assert.equal(result.diagnostic.responseTimeMs,'12.5');
});

test('Victorsia model selector only chooses identifiers returned by models API',()=>{
  const models=['online/example/code-model:free','auto:coding','online/example/general:free'];
  assert.equal(chooseVictorsModel(models,'not-returned'), 'auto:coding');
  assert.equal(chooseVictorsModel(models,'online/example/general:free'),'online/example/general:free');
});

test('Victorsia chat sends exact model and reads usage and rate telemetry',async()=>{
  let sent=null;
  const client=new VictorsAIClient({
    keyProvider:()=> 'test-secret',
    uuidFn:()=> 'req-chat-1',
    fetchFn:async(url,options)=>{
      sent={url,options,body:JSON.parse(options.body)};
      return fakeResponse(200,{
        model:'auto:coding',
        choices:[{message:{content:'const answer = 42;'}}],
        usage:{prompt_tokens:21,completion_tokens:6,total_tokens:27}
      },{
        'X-Request-ID':'req-chat-1',
        'X-Response-Time-Ms':'88',
        'X-RateLimit-Limit':'100',
        'X-RateLimit-Remaining':'99',
        'X-RateLimit-Reset':'12345',
        'X-RateLimit-Policy':'test-policy'
      });
    }
  });
  const result=await client.complete({
    model:'auto:coding',
    messages:[{role:'user',content:'test prompt'}],
    temperature:0.1,
    maxTokens:64
  });
  assert.equal(sent.url,'https://api.victors.qzz.io/v1/chat/completions');
  assert.equal(sent.body.model,'auto:coding');
  assert.equal(sent.body.max_tokens,64);
  assert.equal(result.content,'const answer = 42;');
  assert.deepEqual(result.diagnostic.usage,{prompt_tokens:21,completion_tokens:6,total_tokens:27});
  assert.equal(result.diagnostic.remaining,'99');
  assert.equal(result.diagnostic.policy,'test-policy');
});

test('Victorsia client respects 429 before retrying once',async()=>{
  let calls=0;
  const waits=[];
  const client=new VictorsAIClient({
    keyProvider:()=> 'test-secret',
    uuidFn:()=> 'req-'+(++calls),
    sleepFn:async ms=>{waits.push(ms);},
    fetchFn:async()=>{
      if(waits.length===0)return fakeResponse(429,{error:'rate limited'},{'Retry-After':'0.1'});
      return fakeResponse(200,{data:[{id:'auto:coding'}]},{'X-Request-ID':'req-ok'});
    }
  });
  const result=await client.models();
  assert.equal(result.models[0],'auto:coding');
  assert.equal(waits.length,1);
  assert.ok(waits[0]>=250);
});

test('Victorsia client maps 401 and 503 to actionable errors',async()=>{
  const auth=new VictorsAIClient({keyProvider:()=> 'test-secret',uuidFn:()=> 'req-a',fetchFn:async()=>fakeResponse(401,{})});
  await assert.rejects(()=>auth.models(),error=>error?.code==='AUTH'&&error?.status===401);
  const offline=new VictorsAIClient({keyProvider:()=> 'test-secret',uuidFn:()=> 'req-b',fetchFn:async()=>fakeResponse(503,{})});
  await assert.rejects(()=>offline.models(),error=>error?.code==='PROVIDER_OFFLINE'&&error?.status===503);
});

test('code fence cleanup does not leak markdown wrappers',()=>{
  assert.equal(stripCodeFence('~~~not-a-fence~~~'),'~~~not-a-fence~~~');
  const ticks=String.fromCharCode(96).repeat(3);
  assert.equal(stripCodeFence(ticks+'js\nconst x = 1;\n'+ticks),'const x = 1;');
});

test('diagnostic reports unavailable fields as null instead of inventing data',()=>{
  const d=diagnosticFromResponse(fakeResponse(200,{},{}),{},'auto:coding','req-fallback');
  assert.equal(d.model,'auto:coding');
  assert.equal(d.requestId,'req-fallback');
  assert.equal(d.remaining,null);
  assert.deepEqual(d.usage,{prompt_tokens:null,completion_tokens:null,total_tokens:null});
});
