const {app,BrowserWindow}=require('electron');
const fs=require('fs'),path=require('path'),os=require('os');

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'axiom-problems-smoke-'));
const resultFile=path.join(__dirname,'problems-smoke-result.log');
fs.writeFileSync(resultFile,'Starting Problems diagnostics smoke\n');
const log=(...x)=>fs.appendFileSync(resultFile,x.map(v=>typeof v==='string'?v:JSON.stringify(v)).join(' ')+'\n');

app.setPath('userData',temp);
require('../main');

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(fn,label)=>{
  for(let i=0;i<500;i++){
    try{const value=await fn();if(value)return value;}catch{}
    await wait(100);
  }
  throw new Error('Timeout: '+label);
};
const finish=code=>{
  app.once('quit',()=>{try{fs.rmSync(temp,{recursive:true,force:true})}catch{}});
  app.exit(code);
};
const timer=setTimeout(()=>{log('TIMEOUT');finish(1)},90000);

app.whenReady().then(async()=>{try{
  const win=await until(()=>BrowserWindow.getAllWindows()[0],'window');
  await until(()=>win.webContents.executeJavaScript("Boolean(window.axiom&&document.querySelector('.monaco-editor'))"),'workbench');

  const initial=await win.webContents.executeJavaScript(`(async()=>{
    const js=monaco.editor.createModel('const answer = 42;','javascript',monaco.Uri.file('C:/tmp/problems-live.js'));
    editor.setModel(js);
    await new Promise(r=>setTimeout(r,700));
    return {
      markers:monaco.editor.getModelMarkers({resource:js.uri}).length,
      tab:document.querySelector('#problemsTab')?.textContent
    };
  })()`);
  log('INITIAL',initial);
  if(initial.markers!==0)throw new Error('Valid JavaScript unexpectedly has diagnostics');

  const broken=await win.webContents.executeJavaScript(`(async()=>{
    const js=editor.getModel();
    js.setValue('function broken( {\\n  const x = ;\\n}');
    const json=monaco.editor.createModel('{"x": }','json',monaco.Uri.file('C:/tmp/problems-broken.json'));
    const html=monaco.editor.createModel('<div><span></div>','html',monaco.Uri.file('C:/tmp/problems-broken.html'));
    await new Promise(r=>setTimeout(r,1600));
    setPanelMode('problems');
    await new Promise(r=>setTimeout(r,100));
    return {
      js:monaco.editor.getModelMarkers({resource:js.uri}).length,
      json:monaco.editor.getModelMarkers({resource:json.uri}).length,
      html:monaco.editor.getModelMarkers({resource:html.uri}).length,
      tab:document.querySelector('#problemsTab')?.textContent,
      body:document.querySelector('#terminalOutput')?.innerText
    };
  })()`);
  log('BROKEN',broken);
  if(broken.js<1||broken.json<1||broken.html<1)throw new Error('One or more diagnostics engines failed');
  if(!/^PROBLEMAS \([1-9]\d*\)$/.test(broken.tab||''))throw new Error('Problems badge did not update');
  if(!/broken\.js|problems-live\.js/.test(broken.body||'')||!/broken\.json/.test(broken.body||'')||!/broken\.html/.test(broken.body||''))throw new Error('Problems panel did not list diagnostic files');

  const repaired=await win.webContents.executeJavaScript(`(async()=>{
    const js=editor.getModel();
    js.setValue('function fixed() {\\n  const x = 1;\\n  return x;\\n}');
    for(const model of monaco.editor.getModels()){
      if(model.uri.fsPath.endsWith('problems-broken.json'))model.setValue('{"x": 1}');
      if(model.uri.fsPath.endsWith('problems-broken.html'))model.setValue('<div><span></span></div>');
    }
    await new Promise(r=>setTimeout(r,1600));
    return {
      total:currentProblemMarkers().length,
      tab:document.querySelector('#problemsTab')?.textContent,
      body:(setPanelMode('problems'),document.querySelector('#terminalOutput')?.innerText)
    };
  })()`);
  log('REPAIRED',repaired);
  if(repaired.total!==0||repaired.tab!=='PROBLEMAS')throw new Error('Problems did not clear after code was repaired');

  log('PASS live JS/TS worker diagnostics, JSON validation, HTML structure, panel updates and clearing');
  clearTimeout(timer);finish(0);
}catch(error){
  log(error.stack||error);
  clearTimeout(timer);finish(1);
}});
