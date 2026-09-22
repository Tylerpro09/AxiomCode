const test=require('node:test');
const assert=require('node:assert/strict');
const {
  LocalIntelliEngine,VictorsAIClient,tokenise,languageFromPath,fuzzyMatch,
  chooseVictorsModel,stripCodeFence,version
}=require('../extensions/intellicode/runtime.js');

function response(status,body,headers={}){
  const map=new Map(Object.entries(headers).map(([k,v])=>[k.toLowerCase(),String(v)]));
  return {
    status,
    ok:status>=200&&status<300,
    headers:{get(name){return map.get(String(name).toLowerCase())??null}},
    async json(){return body}
  };
}

test('Axiom IntelliCode 1.3.0 exposes local and Victorsia AI engines',()=>{
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

test('Victorsia model selection uses a full model id returned by /models',()=>{
  const models=['online/openrouter/cohere/north-mini-code:free','auto:coding','online/xkiro/mistralai/codestral-2508'];
  assert.equal(chooseVictorsModel(models,'online/xkiro/mistralai/codestral-2508'),'online/xkiro/mistralai/codestral-2508');
  assert.equal(chooseVictorsModel(models,''),'auto:coding');
});

test('Victorsia /models sends auth and unique request id without leaking the key into diagnostics',async()=>{
  let seen=null;
  const client=new VictorsAIClient({
    keyProvider:()=> 'test-key',
    uuidFn:()=> 'req-models-1',
    fetchFn:async(url,options)=>{
      seen={url,options};
      return response(200,{data:[{id:'auto:coding'}]},{
        'X-Request-ID':'server-models-1',
        'X-Response-Time-Ms':'75.44'
      });
    }
  });
  const result=await client.models();
  assert.equal(seen.url,'https://api.victors.qzz.io/v1/models');
  assert.equal(seen.options.headers.Authorization,'Bearer test-key');
  assert.equal(seen.options.headers['X-Request-ID'],'req-models-1');
  assert.deepEqual(result.models,['auto:coding']);
  assert.equal(result.diagnostic.requestId,'server-models-1');
  assert.equal(result.diagnostic.responseTimeMs,'75.44');
  assert.equal(JSON.stringify(result.diagnostic).includes('test-key'),false);
});

test('Victorsia chat completion preserves model and usage but never stores prompt/response telemetry',async()=>{
  let sent=null;
  const client=new VictorsAIClient({
    keyProvider:()=> 'test-key',
    uuidFn:()=> 'req-chat-1',
    fetchFn:async(_url,options)=>{
      sent=JSON.parse(options.body);
      return response(200,{
        model:'auto:coding',
        choices:[{message:{content:'const answer = 42;'}}],
        usage:{prompt_tokens:12,completion_tokens:5,total_tokens:17}
      },{
        'X-Request-ID':'server-chat-1',
        'X-RateLimit-Remaining':'9'
      });
    }
  });
  const result=await client.complete({
    model:'auto:coding',
    messages:[{role:'user',content:'SECRET_PROMPT'}],
    temperature:0.2,
    maxTokens:64
  });
  assert.equal(sent.model,'auto:coding');
  assert.equal(sent.max_tokens,64);
  assert.equal(result.content,'const answer = 42;');
  assert.deepEqual(result.diagnostic.usage,{prompt_tokens:12,completion_tokens:5,total_tokens:17});
  assert.equal(result.diagnostic.remaining,'9');
  const telemetry=JSON.stringify(result.diagnostic);
  assert.equal(telemetry.includes('SECRET_PROMPT'),false);
  assert.equal(telemetry.includes('const answer = 42;'),false);
  assert.equal(telemetry.includes('test-key'),false);
});

test('Victorsia 429 waits for rate limit and retries once with a new request id',async()=>{
  const waits=[],ids=[],responses=[
    response(429,{error:'rate'},{'Retry-After':'1','X-Request-ID':'rate-1'}),
    response(200,{model:'auto:coding',choices:[{message:{content:'ok'}}],usage:{}},{'X-Request-ID':'ok-2'})
  ];
  const client=new VictorsAIClient({
    keyProvider:()=> 'test-key',
    uuidFn:()=>{const id='client-'+(ids.length+1);ids.push(id);return id},
    sleepFn:async ms=>{waits.push(ms)},
    fetchFn:async()=>responses.shift()
  });
  const result=await client.complete({model:'auto:coding',messages:[{role:'user',content:'x'}]});
  assert.equal(result.content,'ok');
  assert.deepEqual(waits,[1000]);
  assert.deepEqual(ids,['client-1','client-2']);
});

test('Victorsia 401 and 503 are mapped to actionable errors',async()=>{
  const auth=new VictorsAIClient({
    keyProvider:()=> 'bad',
    uuidFn:()=> 'auth-1',
    fetchFn:async()=>response(401,{})
  });
  await assert.rejects(()=>auth.models(),error=>error.code==='AUTH'&&error.status===401);

  const offline=new VictorsAIClient({
    keyProvider:()=> 'test-key',
    uuidFn:()=> 'offline-1',
    fetchFn:async()=>response(503,{})
  });
  await assert.rejects(()=>offline.models(),error=>error.code==='PROVIDER_OFFLINE'&&error.status===503);
});

test('AI code fences are removed before editor insertion',()=>{
  const fence=String.fromCharCode(96).repeat(3);
  assert.equal(stripCodeFence(fence+'js\nconst x = 1;\n'+fence),'const x = 1;');
  assert.equal(stripCodeFence('const x = 1;'),'const x = 1;');
});
