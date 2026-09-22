const {app,BrowserWindow}=require('electron');
const fs=require('fs'),path=require('path'),os=require('os');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'axiom-generic-runtime-'));
const resultFile=path.join(__dirname,'generic-extension-runtime-result.log');
fs.writeFileSync(resultFile,'Starting generic renderer runtime smoke\n');
const log=(...x)=>fs.appendFileSync(resultFile,x.map(v=>typeof v==='string'?v:JSON.stringify(v)).join(' ')+'\n');
app.setPath('userData',temp);
require('../main');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,label)=>{for(let i=0;i<500;i++){try{const v=await fn();if(v)return v;}catch{}await wait(100)}throw Error('Timeout: '+label)};
const timer=setTimeout(()=>{log('TIMEOUT');app.exit(1)},90000);
const finish=code=>{clearTimeout(timer);app.once('quit',()=>{try{fs.rmSync(temp,{recursive:true,force:true})}catch{}});app.exit(code);};
app.whenReady().then(async()=>{try{
 const win=await until(()=>BrowserWindow.getAllWindows()[0],'window');
 await until(()=>win.webContents.executeJavaScript("Boolean(window.axiom&&document.querySelector('.monaco-editor'))"),'workbench');
 const installed=await win.webContents.executeJavaScript(`(async()=>{
   await window.axiom.installExtension('axiom.intellicode');
   await refreshExtensionState();
   await new Promise(r=>setTimeout(r,500));
   const list=await window.axiom.listExtensions();
   const item=list.find(x=>x.id==='axiom.intellicode');
   const state=window.AxiomIntelliCode?.status?.();
   return {installed:item?.installed,enabled:item?.enabled,scope:item?.scope,runtime:Boolean(state?.active),cloud:state?.cloud,telemetry:state?.telemetry,commands:extensionCommands.has('intellicode.status')&&extensionCommands.has('intellicode.rebuild')};
 })()`);
 log('INSTALLED',installed);
 if(!installed.installed||!installed.enabled||installed.scope!=='user'||!installed.runtime||installed.cloud!==false||installed.telemetry!==false||!installed.commands)throw Error('Generic renderer runtime did not activate correctly');
 const removed=await win.webContents.executeJavaScript(`(async()=>{
   await window.axiom.uninstallExtension('axiom.intellicode');
   await refreshExtensionState();
   await new Promise(r=>setTimeout(r,100));
   return {global:Boolean(window.AxiomIntelliCode),runtime:extensionRuntimes.has('axiom.intellicode'),command:extensionCommands.has('intellicode.status')};
 })()`);
 log('REMOVED',removed);
 if(removed.global||removed.runtime||removed.command)throw Error('Generic renderer runtime did not unload cleanly');
 log('PASS repo install -> generic runtime activate -> commands -> unload');
 finish(0);
}catch(e){log(e.stack||e);finish(1)}});
