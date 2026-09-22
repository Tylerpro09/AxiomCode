const {app,BrowserWindow}=require('electron');
const fs=require('fs'),path=require('path'),os=require('os');

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'axiom-extension-network-'));
const resultFile=path.join(__dirname,'extension-network-result.log');
fs.writeFileSync(resultFile,'Starting extension network permission smoke\n');
const log=(...x)=>fs.appendFileSync(resultFile,x.map(v=>typeof v==='string'?v:JSON.stringify(v)).join(' ')+'\n');
app.setPath('userData',temp);
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
  const result=await win.webContents.executeJavaScript(`(async()=>{
    await window.axiom.installExtension('axiom.intellicode');
    await refreshExtensionState();
    const requestId=crypto.randomUUID();
    const allowed=await window.axiom.extensionNetworkRequest('axiom.intellicode',{
      url:'https://api.victors.qzz.io/v1/models',
      method:'GET',
      headers:{'X-Request-ID':requestId},
      timeoutMs:15000
    });
    let blocked='';
    try{
      await window.axiom.extensionNetworkRequest('axiom.intellicode',{
        url:'https://example.com/',
        method:'GET',
        headers:{'X-Request-ID':crypto.randomUUID()}
      });
    }catch(error){blocked=String(error?.message||error);}
    return {
      status:allowed.status,ok:allowed.ok,url:allowed.url,
      echoedRequestId:allowed.headers?.['x-request-id']||allowed.headers?.['X-Request-ID']||null,
      sentRequestId:requestId,
      blocked
    };
  })()`);
  log('RESULT',result);
  if(![200,401].includes(result.status))throw Error('Unexpected Victorsia status '+result.status);
  if(!String(result.url).startsWith('https://api.victors.qzz.io/'))throw Error('Allowed request target mismatch');
  if(!/Host no permitido|hosts permitidos/i.test(result.blocked))throw Error('Manifest host permission was not enforced');
  log('PASS permission-scoped HTTPS bridge reached Victorsia and blocked undeclared host');
  finish(0);
}catch(error){log(error.stack||error);finish(1)}});
