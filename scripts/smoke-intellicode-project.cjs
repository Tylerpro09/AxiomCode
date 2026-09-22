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
fs.writeFileSync(resultFile,'Starting IntelliCode project-index smoke\n');
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
    await window.axiom.installExtension('axiom.intellicode');
    await refreshExtensionState();
    await new Promise(r=>setTimeout(r,700));
    const state=window.AxiomIntelliCode?.status?.();
    return {
      version:state?.version,
      active:state?.active,
      enabled:state?.enabled,
      projectFiles:state?.projectFiles,
      projectBytes:state?.projectBytes,
      symbols:state?.symbols,
      profile:state?.memoryProfile,
      commands:[
        'intellicode.status','intellicode.rebuild','intellicode.toggle',
        'intellicode.clear','intellicode.profile','intellicode.projectIndex'
      ].every(id=>extensionCommands.has(id))
    };
  })()`);
  log('SETUP',setup);
  if(setup.version!=='1.2.0'||!setup.active||!setup.enabled||setup.projectFiles<3||setup.projectBytes<100||setup.symbols<5||!setup.commands)throw Error('Project indexing did not initialize correctly');

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

  const removed=await win.webContents.executeJavaScript(`(async()=>{
    await window.axiom.uninstallExtension('axiom.intellicode');
    await refreshExtensionState();
    return {global:Boolean(window.AxiomIntelliCode),runtime:extensionRuntimes.has('axiom.intellicode')};
  })()`);
  log('REMOVED',removed);
  if(removed.global||removed.runtime)throw Error('Runtime did not unload');

  log('PASS project indexing, controls, adaptive profile and unload');
  finish(0);
}catch(error){
  log(error.stack||error);
  finish(1);
}});
