const {app,BrowserWindow,dialog}=require('electron');
const fs=require('fs'),path=require('path'),os=require('os');

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'axiom-preview-smoke-'));
const project=path.join(temp,'workspace');
const resultFile=path.join(__dirname,'live-preview-smoke-result.log');
fs.mkdirSync(project,{recursive:true});
fs.writeFileSync(path.join(project,'index.html'),'<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><h1>ORIGINAL</h1><script src="app.js"></script></body></html>');
fs.writeFileSync(path.join(project,'style.css'),'body{font-family:sans-serif;color:rgb(1,2,3)}');
fs.writeFileSync(path.join(project,'app.js'),'function previewSymbol(){ window.previewLoaded=true; } previewSymbol();');
fs.writeFileSync(resultFile,'Starting Axiom Live Preview smoke\n');
const log=(...x)=>fs.appendFileSync(resultFile,x.map(v=>typeof v==='string'?v:JSON.stringify(v)).join(' ')+'\n');

app.setPath('userData',path.join(temp,'userdata'));
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
    const root=${JSON.stringify(project)};
    const opened=await window.axiom.openWorkspacePath(root);
    useWorkspace(opened,false);
    const html=root+'\\\\index.html';
    await openFile(html);
    const openedPreview=await openLivePreview();
    await renderWelcomeRecents();
    const recentRows=document.querySelectorAll('.welcome-recent').length;
    showPalette('unified');await buildPalette('index');const omniFile=paletteItems.some(x=>/index\.html/i.test(x.name));
    await buildPalette('> Live Preview');const omniCommand=paletteItems.some(x=>/Live Preview/i.test(x.name));
    await buildPalette('@previewSymbol');const omniSymbol=paletteItems.some(x=>/previewSymbol/i.test(x.name));hidePalette();
    setSideMode('pulse');await new Promise(r=>setTimeout(r,350));
    const pulseCards=document.querySelectorAll('.pulse-card').length;
    const pulseActions=document.querySelectorAll('.pulse-action').length;
    const pulseCommand=commands.some(x=>x.name==='Ver: Axiom Pulse');
    return {
      openedPreview,recentRows,omniFile,omniCommand,omniSymbol,pulseCards,pulseActions,pulseCommand,
      id:livePreviewState.id,
      url:livePreviewState.url,
      entry:livePreviewState.entry,
      bodyClass:document.body.classList.contains('preview-open'),
      frameSrc:document.querySelector('#previewFrame')?.src,
      commandCoverage:commands.some(x=>x.name==='Ver: Axiom Live Preview')&&commands.some(x=>x.name==='Ver: Modo Zen')
    };
  })()`);
  log('INITIAL',initial);
  if(!initial.openedPreview||!initial.id||!initial.url||!initial.bodyClass||!initial.commandCoverage)throw new Error('Live Preview UI/session did not open');
  if(initial.recentRows<1||!initial.omniFile||!initial.omniCommand||!initial.omniSymbol)throw new Error('Welcome recents or Omni Search failed');
  if(initial.pulseCards<4||initial.pulseActions<5||!initial.pulseCommand)throw new Error('Axiom Pulse failed');
  const htmlText=await (await fetch(initial.url)).text();
  const cssText=await (await fetch(new URL('style.css',initial.url))).text();
  if(!htmlText.includes('ORIGINAL')||!cssText.includes('rgb(1,2,3)'))throw new Error('Preview server did not serve project assets');

  const live=await win.webContents.executeJavaScript(`(async()=>{
    const html=${JSON.stringify(path.join(project,'index.html'))};
    const outside=${JSON.stringify(path.join(temp,'outside.html'))};
    tabs.get(html).model.setValue('<!doctype html><html><body><h1>UNSAVED LIVE</h1></body></html>');
    await new Promise(r=>setTimeout(r,750));
    let blocked=false;
    try{await window.axiom.updateLivePreview(livePreviewState.id,outside,'x');}catch{blocked=true;}
    setPreviewDevice('mobile');
    const mobile=document.querySelector('#previewCanvas')?.dataset.device==='mobile';
    const zenOn=toggleZenMode(true)&&document.body.classList.contains('zen-mode');
    const zenOff=!toggleZenMode(false)&&!document.body.classList.contains('zen-mode');
    return {url:livePreviewState.url,blocked,mobile,zenOn,zenOff};
  })()`);
  log('LIVE',live);
  if(!live.blocked||!live.mobile||!live.zenOn||!live.zenOff)throw new Error('Preview security/device/Zen behavior failed');

  const updated=await (await fetch(live.url)).text();
  if(!updated.includes('UNSAVED LIVE'))throw new Error('Unsaved editor content did not reach Live Preview');
  const closed=await win.webContents.executeJavaScript(`(async()=>{
    const before=livePreviewState.id;
    await closeLivePreview();
    return {before,after:livePreviewState.id,bodyClass:document.body.classList.contains('preview-open'),frame:document.querySelector('#previewFrame')?.getAttribute('src')};
  })()`);
  log('CLOSED',closed);
  if(!closed.before||closed.after||closed.bodyClass)throw new Error('Live Preview did not close cleanly');
  const stale=await fetch(initial.url);
  if(stale.status!==404)throw new Error('Closed preview session still serves content');

  const originalOpenDialog=dialog.showOpenDialog;
  dialog.showOpenDialog=async()=>({canceled:false,filePaths:[temp]});
  let starter;
  try{starter=await win.webContents.executeJavaScript(`window.axiom.createStarterProject('node','GeneratedNode')`);}finally{dialog.showOpenDialog=originalOpenDialog;}
  const starterEntry=path.join(temp,'GeneratedNode','src','index.js');
  if(!starter?.root||!fs.existsSync(starterEntry)||!fs.existsSync(path.join(temp,'GeneratedNode','package.json')))throw new Error('Starter Kit did not create Node project');
  let invalidStarterBlocked=false;
  try{await win.webContents.executeJavaScript(`window.axiom.createStarterProject('web','bad:name')`);}catch{invalidStarterBlocked=true;}
  if(!invalidStarterBlocked)throw new Error('Starter Kit accepted invalid project name');
  log('STARTER',{root:starter.root,entry:fs.existsSync(starterEntry),invalidStarterBlocked});

  log('PASS Live Preview, Omni Search, Pulse, Starter Kits, device presets, Zen Mode and cleanup');
  clearTimeout(timer);finish(0);
}catch(error){
  log(error.stack||error);
  clearTimeout(timer);finish(1);
}});
