const {app,BrowserWindow}=require('electron');
const fs=require('fs'),path=require('path'),os=require('os');

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'axiom-intellicode-project-'));
const project=path.join(temp,'project');
fs.mkdirSync(project,{recursive:true});
fs.writeFileSync(path.join(project,'main.js'),[
  'class QuantumInvoiceEngine {',
  '  calculateQuantumInvoice(customerProfile) {',
  '    return customerProfile.invoiceTotal;',
  '  }',
  '}',
  'const quantumInvoiceEngine = new QuantumInvoiceEngine();',
  'quantumInvoiceEngine.calculateQuantumInvoice({ invoiceTotal: 42 });'
].join('\n'));
fs.writeFileSync(path.join(project,'customer.js'),[
  'export function loadCustomerProfile() {',
  '  const user = { profile: {}, preferences: {} };',
  '  return user.profile;',
  '}'
].join('\n'));
fs.writeFileSync(path.join(project,'helper.py'),[
  'class InvoiceHelper:',
  '    def calculate_total(self, items):',
  '        return sum(items)'
].join('\n'));

const resultFile=path.join(__dirname,'intellicode-project-result.log');
fs.writeFileSync(resultFile,'Starting IntelliCode project + AI smoke\n');
const log=(...x)=>fs.appendFileSync(resultFile,x.map(v=>typeof v==='string'?v:JSON.stringify(v)).join(' ')+'\n');
app.setPath('userData',path.join(temp,'userData'));
require('../main');

const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,label)=>{for(let i=0;i<500;i++){try{const v=await fn();if(v)return v;}catch{}await wait(100)}throw Error('Timeout: '+label)};
const timer=setTimeout(()=>{log('TIMEOUT');app.exit(1)},90000);
const finish=code=>{
  clearTimeout(timer);
  app.once('quit',()=>{try{fs.rmSync(temp,{recursive:true,force:true})}catch{}});
  app.exit(code);
};

app.whenReady().then(async()=>{try{
  const win=await until(()=>BrowserWindow.getAllWindows()[0],'window');
  await until(()=>win.webContents.executeJavaScript("Boolean(window.axiom&&document.querySelector('.monaco-editor'))"),'workbench');

  const tree=[
    {type:'file',name:'main.js',path:path.join(project,'main.js')},
    {type:'file',name:'customer.js',path:path.join(project,'customer.js')},
    {type:'file',name:'helper.py',path:path.join(project,'helper.py')}
  ];

  const setup=await win.webContents.executeJavaScript(`(async()=>{
    workspace=${JSON.stringify({root:project,tree})};
    sessionStorage.setItem('axiom.intellicode.victors.key','test-session-key');
    localStorage.removeItem('axiom.intellicode.victors.model');
    window.__intellicodeAiRequests=[];
    window.fetch=async(url,options={})=>{
      const headers=options.headers||{};
      window.__intellicodeAiRequests.push({
        url:String(url),
        requestId:headers['X-Request-ID']||null,
        hasAuthorization:Boolean(headers.Authorization),
        bodyModel:options.body?JSON.parse(options.body).model:null
      });
      const makeHeaders=values=>({get:name=>values[String(name).toLowerCase()]??null});
      if(String(url).endsWith('/v1/models')){
        return {
          status:200,ok:true,
          headers:makeHeaders({'x-request-id':'server-models','x-response-time-ms':'12.5'}),
          async json(){return {data:[{id:'auto:coding'},{id:'online/openrouter/cohere/north-mini-code:free'}]}}
        };
      }
      if(String(url).endsWith('/v1/chat/completions')){
        return {
          status:200,ok:true,
          headers:makeHeaders({
            'x-request-id':'server-chat',
            'x-response-time-ms':'30.1',
            'x-ratelimit-remaining':'8'
          }),
          async json(){return {
            model:'auto:coding',
            choices:[{message:{content:'42;'}}],
            usage:{prompt_tokens:20,completion_tokens:2,total_tokens:22}
          }}
        };
      }
      throw new Error('Unexpected fetch '+url);
    };

    await window.axiom.installExtension('axiom.intellicode');
    await refreshExtensionState();
    await new Promise(r=>setTimeout(r,700));
    const state=window.AxiomIntelliCode?.status?.();
    const commandIds=[
      'intellicode.status','intellicode.rebuild','intellicode.toggle',
      'intellicode.clear','intellicode.profile','intellicode.projectIndex',
      'intellicode.ai.configure','intellicode.ai.model','intellicode.ai.complete',
      'intellicode.ai.explain','intellicode.ai.fix','intellicode.ai.inline',
      'intellicode.ai.diagnostics','intellicode.ai.clearKey'
    ];
    return {
      version:state?.version,
      active:state?.active,
      enabled:state?.enabled,
      projectFiles:state?.projectFiles,
      projectBytes:state?.projectBytes,
      symbols:state?.symbols,
      profile:state?.memoryProfile,
      aiConfigured:state?.ai?.configured,
      commands:commandIds.every(id=>extensionCommands.has(id))
    };
  })()`);
  log('SETUP',setup);
  if(setup.version!=='1.3.0'||!setup.active||!setup.enabled||setup.projectFiles<3||setup.projectBytes<100||setup.symbols<5||!setup.aiConfigured||!setup.commands)throw Error('Project/AI setup did not initialize correctly');

  const controls=await win.webContents.executeJavaScript(`(async()=>{
    const off=await window.AxiomIntelliCode.runCommand('intellicode.projectIndex');
    const on=await window.AxiomIntelliCode.runCommand('intellicode.projectIndex');
    const profile=await window.AxiomIntelliCode.runCommand('intellicode.profile');
    const paused=await window.AxiomIntelliCode.runCommand('intellicode.toggle');
    const resumed=await window.AxiomIntelliCode.runCommand('intellicode.toggle');
    return {
      off:{enabled:off.projectIndexEnabled,files:off.projectFiles},
      on:{enabled:on.projectIndexEnabled,files:on.projectFiles},
      profile:{mode:profile.profileMode,name:profile.memoryProfile},
      paused:paused.enabled,
      resumed:resumed.enabled
    };
  })()`);
  log('CONTROLS',controls);
  if(controls.off.enabled!==false||controls.off.files!==0)throw Error('Project-index disable failed');
  if(controls.on.enabled!==true||controls.on.files<3)throw Error('Project-index re-enable failed');
  if(controls.profile.mode!=='light'||controls.profile.name!=='ligero')throw Error('Profile cycling failed');
  if(controls.paused!==false||controls.resumed!==true)throw Error('Enable/pause toggle failed');

  const ai=await win.webContents.executeJavaScript(`(async()=>{
    const model=monaco.editor.createModel('const value = ','javascript');
    editor.setModel(model);
    editor.setPosition({lineNumber:1,column:model.getLineMaxColumn(1)});
    const diagnostic=await window.AxiomIntelliCode.runCommand('intellicode.ai.complete');
    const state=window.AxiomIntelliCode.status();
    const requests=window.__intellicodeAiRequests.map(x=>({...x}));
    return {
      value:model.getValue(),
      model:state.ai.model,
      diagnostic:{
        status:diagnostic?.status,
        requestId:diagnostic?.requestId,
        remaining:diagnostic?.remaining,
        totalTokens:diagnostic?.usage?.total_tokens
      },
      requests,
      leakedSecret:JSON.stringify(state).includes('test-session-key')
    };
  })()`);
  log('AI',{
    value:ai.value,model:ai.model,diagnostic:ai.diagnostic,
    requests:ai.requests.map(x=>({url:x.url,requestId:x.requestId,hasAuthorization:x.hasAuthorization,bodyModel:x.bodyModel})),
    leakedSecret:ai.leakedSecret
  });
  if(ai.value!=='const value = 42;')throw Error('AI completion was not inserted');
  if(ai.model!=='auto:coding')throw Error('Full model ID was not selected from /models');
  if(ai.diagnostic.status!==200||ai.diagnostic.requestId!=='server-chat'||ai.diagnostic.remaining!=='8'||ai.diagnostic.totalTokens!==22)throw Error('AI diagnostics mismatch');
  if(ai.requests.length!==2||!ai.requests.every(x=>x.requestId&&x.hasAuthorization)||ai.requests[0].requestId===ai.requests[1].requestId)throw Error('Request-ID/auth flow failed');
  if(ai.requests[1].bodyModel!=='auto:coding')throw Error('Chat request did not use discovered full model id');
  if(ai.leakedSecret)throw Error('API key leaked into status telemetry');

  const removed=await win.webContents.executeJavaScript(`(async()=>{
    await window.axiom.uninstallExtension('axiom.intellicode');
    await refreshExtensionState();
    return {global:Boolean(window.AxiomIntelliCode),runtime:extensionRuntimes.has('axiom.intellicode')};
  })()`);
  log('REMOVED',removed);
  if(removed.global||removed.runtime)throw Error('Runtime did not unload');

  log('PASS project indexing, AI model discovery, AI completion, telemetry privacy, controls and unload');
  finish(0);
}catch(error){
  log(error.stack||error);
  finish(1);
}});
