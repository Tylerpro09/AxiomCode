const {app,BrowserWindow}=require('electron');
const fs=require('fs'),path=require('path'),os=require('os');
const logFile=path.join(__dirname,'scratch-power-result.log');
fs.writeFileSync(logFile,'Starting Axiom Power test\n');
const log=(...a)=>fs.appendFileSync(logFile,a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ')+'\n');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'axiom-power-test-'));
app.setPath('userData',temp);
fs.writeFileSync(path.join(temp,'extension-state.json'),JSON.stringify({installed:{'axiom.scratch-mode':true}}));
require('../main');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,label)=>{for(let i=0;i<300;i++){try{const v=await fn();if(v)return v;}catch{}await wait(100)}throw Error('Timeout: '+label)};
const timer=setTimeout(()=>{log('TIMEOUT');app.exit(1)},60000);
app.whenReady().then(async()=>{try{
  const win=await until(()=>BrowserWindow.getAllWindows()[0],'window');
  await until(()=>win.webContents.executeJavaScript("Boolean(window.AxiomScratch&&document.querySelector('#scratchBtn')?.onclick&&getComputedStyle(document.querySelector('#scratchBtn')).display!=='none')"),'workbench');
  await win.webContents.executeJavaScript('document.querySelector("#scratchBtn").click()');
  const frame=await until(()=>win.webContents.mainFrame.frames.find(f=>f.url.includes('editor.html')),'Scratch frame');
  await until(()=>frame.executeJavaScript('Boolean(window.scratchEditor?.ready&&window.AxiomPower&&window.AxiomScratchSDK)'),'Axiom Power');
  await until(()=>frame.executeJavaScript("document.body.innerText.includes('Axiom Power')"),'Axiom Power UI');

  const info=await frame.executeJavaScript("({loaded:scratchEditor.vm.extensionManager.isExtensionLoaded('axiompower'),blockInfo:scratchEditor.vm.runtime._blockInfo.some(x=>x.id==='axiompower'),primitives:Object.keys(scratchEditor.vm.runtime._primitives||{}).filter(k=>k.startsWith('axiompower_')).length,ui:document.body.innerText.includes('Axiom Power')})");
  log('REGISTERED',info);
  if(!info.loaded||!info.blockInfo||info.primitives<20||!info.ui)throw Error('Axiom Power was not fully registered');

  const local=await frame.executeJavaScript("(async()=>{const json=AxiomPower.jsonGet({JSON:'{\"jugador\":{\"vida\":100}}',PATH:'jugador.vida'});const changed=AxiomPower.jsonSet({JSON:'{\"vida\":100}',PATH:'vida',VALUE:'80'});const b64=AxiomPower.base64Encode({TEXT:'Axiom ✓'});const decoded=AxiomPower.base64Decode({TEXT:b64});const hash=await AxiomPower.hashSha256({TEXT:'abc'});await AxiomPower.storageSet({KEY:'score',VALUE:'9001'});const stored=await AxiomPower.storageGet({KEY:'score'});const keys=await AxiomPower.storageKeys();const platform=await AxiomPower.systemValue({ITEM:'sistema'});return {json,changed,b64,decoded,hash,stored,keys,platform,online:AxiomPower.online(),width:AxiomPower.viewportValue({VIEW:'ancho'})};})()");
  log('POWER_LOCAL',local);
  if(local.json!=='100'||!local.changed.includes('80')||local.decoded!=='Axiom ✓'||local.hash!=='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'||local.stored!=='9001'||!local.keys.includes('score')||!local.platform||local.width<100)throw Error('Axiom Power local/bridge features failed');

  const extensionCode="module.exports=class TestLocalExtension{getInfo(){return{id:'localtest',name:'Local Test',blocks:[{opcode:'echo',blockType:'reporter',text:'eco [TEXT]',arguments:{TEXT:{type:'string',defaultValue:'hola'}}}]};}echo(args){return 'E:'+String(args.TEXT||'');}};";
  const loaded=await frame.executeJavaScript("AxiomScratchSDK.loadCode("+JSON.stringify(extensionCode)+",'local-test.js')");
  const custom=await frame.executeJavaScript("({loaded:scratchEditor.vm.extensionManager.isExtensionLoaded('localtest'),primitive:Boolean(scratchEditor.vm.runtime._primitives['localtest_echo']),blockInfo:scratchEditor.vm.runtime._blockInfo.some(x=>x.id==='localtest')})");
  log('LOCAL_EXTENSION',loaded,custom);
  if(loaded.id!=='localtest'||!custom.loaded||!custom.primitive||!custom.blockInfo)throw Error('Local extension SDK failed');

  const roundtrip=await frame.executeJavaScript("(async()=>{const vm=scratchEditor.vm;const project=JSON.parse(vm.toJSON());project.extensions=[...new Set([...(project.extensions||[]),'axiompower'])];await vm.loadProject(JSON.stringify(project));const blob=await vm.saveProjectSb3();const bytes=await blob.arrayBuffer();await vm.loadProject(bytes);return {bytes:blob.size,power:vm.extensionManager.isExtensionLoaded('axiompower')};})()");
  log('ROUNDTRIP',roundtrip);
  if(roundtrip.bytes<1000||!roundtrip.power)throw Error('Axiom Power SB3 roundtrip failed');

  log('PASS Axiom Power blocks, privileged bridge, local extension SDK and SB3 roundtrip');
  clearTimeout(timer);app.exit(0);
}catch(e){log(e.stack||e);clearTimeout(timer);app.exit(1)}});