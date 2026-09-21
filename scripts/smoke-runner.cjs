const {app,BrowserWindow}=require('electron');
const fs=require('fs');
const path=require('path');
const os=require('os');

const log=path.join(__dirname,'runner-smoke-result.log');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'axiom-runner-smoke-'));
const sample=path.join(temp,'hello.js');
fs.writeFileSync(sample,'console.log("RUNNER_SMOKE_OK");\n');
fs.writeFileSync(log,'Starting Runner smoke test\n');
app.setPath('userData',temp);
const extensionSource=path.join(__dirname,'..','extensions','runner');
const extensionTarget=path.join(temp,'extensions','runner');
fs.mkdirSync(path.dirname(extensionTarget),{recursive:true});
fs.cpSync(extensionSource,extensionTarget,{recursive:true});
fs.writeFileSync(path.join(temp,'extension-state.json'),JSON.stringify({installed:{'axiom.runner':true},security:{'axiom.runner':{engine:'AxiomGuard Static 1.0',verdict:'clean',score:0,scannedAt:new Date().toISOString(),version:'1.0.0',hashes:{}}}}));
app.on('browser-window-created',(_,win)=>win.hide());
require('../main');
const timeout=setTimeout(()=>{fs.appendFileSync(log,'TIMEOUT\n');app.exit(1);},25000);
app.whenReady().then(async()=>{
  try{
    let win;
    for(let i=0;i<120;i++){
      win=BrowserWindow.getAllWindows()[0];
      if(win&&await win.webContents.executeJavaScript("Boolean(window.axiom&&document.querySelector('#extensionsBtn'))").catch(()=>false))break;
      await new Promise(r=>setTimeout(r,100));
    }
    if(!win)throw new Error('No AxiomCode window');
    await win.webContents.executeJavaScript(`openFile(${JSON.stringify(sample)})`);
    await new Promise(r=>setTimeout(r,250));
    await win.webContents.executeJavaScript("setSideMode('extensions')");
    await new Promise(r=>setTimeout(r,250));
    const card=await win.webContents.executeJavaScript("Boolean(document.querySelector('.runner-extension-open'))");
    if(!card)throw new Error('Missing Runner extension launch button');
    await win.webContents.executeJavaScript("openRunnerMode()");
    await new Promise(r=>setTimeout(r,150));
    const ui=await win.webContents.executeJavaScript("({title:document.querySelector('.run-view h3')?.textContent,runtime:document.querySelector('#runnerRuntime')?.textContent,run:Boolean(document.querySelector('#runActiveSide')),stop:Boolean(document.querySelector('#stopRunnerSide'))})");
    if(ui.title!=='Runner'||!ui.run||!ui.stop)throw new Error('Runner UI incomplete: '+JSON.stringify(ui));
    const plan=await win.webContents.executeJavaScript(`window.axiom.prepareRunner(${JSON.stringify(sample)})`);
    if(!plan.supported||!plan.available||plan.name!=='JavaScript')throw new Error('Runner plan failed: '+JSON.stringify(plan));
    fs.writeFileSync(path.join(__dirname,'runner-smoke.png'),(await win.webContents.capturePage()).toPNG());
    fs.appendFileSync(log,'PASS '+JSON.stringify({ui,plan:{name:plan.name,tool:plan.tool}})+'\n');
    clearTimeout(timeout);app.exit(0);
  }catch(error){
    fs.appendFileSync(log,(error.stack||String(error))+'\n');
    clearTimeout(timeout);app.exit(1);
  }
});
