const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, Notification } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const dns = require('dns').promises;
const net = require('net');
const { exec, spawn } = require('child_process');
const { Transform, Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { createBackend } = require('./backend');
const {scanExtensionFiles,assertExtensionSafe}=require('./backend/services/extensionSecurity');
let scratchCore;
const SCRATCH_EXTENSION_ID = 'axiom.scratch-mode';
const RUNNER_EXTENSION_ID = 'axiom.runner';
const MAX_AXIOM_SCRATCH_BYTES = 100 * 1024 * 1024;
const MAX_SB3_BYTES = 512 * 1024 * 1024;
const SCRATCH_POWER_STORAGE_MAX_BYTES = 10 * 1024 * 1024;
const SCRATCH_POWER_HTTP_MAX_BYTES = 20 * 1024 * 1024;
let scratchClipboardReadAllowed = false;

function isPrivateIp(address) {
  if (!address) return true;
  const ip = String(address).toLowerCase();
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    if (p[0] === 10 || p[0] === 127 || p[0] === 0) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;
    if (p[0] >= 224) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    if (ip === '::1' || ip === '::') return true;
    if (ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe8') || ip.startsWith('fe9') || ip.startsWith('fea') || ip.startsWith('feb')) return true;
    if (ip.startsWith('::ffff:')) return isPrivateIp(ip.slice(7));
    return false;
  }
  return true;
}
async function assertSafeScratchUrl(raw) {
  let url;
  try { url = new URL(String(raw || '')); } catch { throw new Error('URL no válida'); }
  if (url.protocol !== 'https:') throw new Error('Axiom Power solo permite HTTPS');
  const host = url.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.local')) throw new Error('Host local bloqueado');
  const resolved = await dns.lookup(host, {all:true, verbatim:true});
  if (!resolved.length || resolved.some(x => isPrivateIp(x.address))) throw new Error('Dirección privada o local bloqueada');
  return url;
}

function extensionNetworkHostAllowed(host,allowedHosts){
  const value=String(host||'').toLowerCase();
  return (allowedHosts||[]).some(raw=>{
    const rule=String(raw||'').trim().toLowerCase();
    if(!rule)return false;
    if(rule.startsWith('*.'))return value.endsWith(rule.slice(1))&&value!==rule.slice(2);
    return value===rule;
  });
}
function sanitizeExtensionRequestHeaders(input){
  const blocked=new Set(['host','content-length','connection','cookie','set-cookie','proxy-authorization','proxy-authenticate','transfer-encoding','upgrade']);
  const result={};
  const entries=Object.entries(input&&typeof input==='object'?input:{});
  if(entries.length>32)throw new Error('Demasiadas cabeceras HTTP');
  for(const [rawName,rawValue] of entries){
    const name=String(rawName||'').trim();
    const lower=name.toLowerCase();
    if(!/^[A-Za-z0-9!#$%&'*+.^_|~-]{1,64}$/.test(name)||blocked.has(lower))continue;
    const value=String(rawValue??'');
    if(value.length>8192||/[\r\n]/.test(value))throw new Error('Cabecera HTTP no válida');
    result[name]=value;
  }
  return result;
}
async function extensionNetworkRequest(extensionId, request={}){
  const item=await backend.extensions.installedEntry(String(extensionId||''));
  if(!item)throw new Error('La extensión no está instalada o está deshabilitada');
  const permission=item.contributes?.rendererRuntime?.permissions;
  const allowedHosts=Array.isArray(permission?.networkHosts)?permission.networkHosts.map(String).filter(Boolean):[];
  if(!allowedHosts.length)throw new Error('La extensión no declaró permisos de red');
  let url=await assertSafeScratchUrl(request.url);
  if(!extensionNetworkHostAllowed(url.hostname,allowedHosts))throw new Error('Host no permitido por el manifiesto de la extensión');
  let method=String(request.method||'GET').toUpperCase();
  if(!['GET','POST'].includes(method))throw new Error('Método HTTP no permitido para extensiones');
  const headers=sanitizeExtensionRequestHeaders(request.headers);
  headers['User-Agent']='AxiomCode-Extension/'+app.getVersion();
  const body=method==='POST'&&request.body!==undefined?String(request.body):undefined;
  if(body&&Buffer.byteLength(body)>2*1024*1024)throw new Error('Solicitud HTTP supera 2 MiB');
  const timeoutMs=Math.max(1000,Math.min(60000,Number(request.timeoutMs)||30000));
  for(let hop=0;hop<6;hop++){
    const response=await fetch(url,{
      method,headers,body:method==='POST'?body:undefined,redirect:'manual',
      signal:AbortSignal.timeout(timeoutMs)
    });
    if([301,302,303,307,308].includes(response.status)){
      const location=response.headers.get('location');
      if(!location)throw new Error('Redirección HTTP sin destino');
      url=await assertSafeScratchUrl(new URL(location,url).href);
      if(!extensionNetworkHostAllowed(url.hostname,allowedHosts))throw new Error('La redirección salió de los hosts permitidos');
      if(response.status===303)method='GET';
      continue;
    }
    const chunks=[];let total=0;
    const reader=response.body?.getReader();
    if(reader){
      while(true){
        const {done,value}=await reader.read();
        if(done)break;
        total+=value.byteLength;
        if(total>8*1024*1024){reader.cancel().catch(()=>{});throw new Error('Respuesta HTTP supera 8 MiB');}
        chunks.push(Buffer.from(value));
      }
    }
    const responseHeaders={};
    for(const [name,value] of response.headers.entries()){
      if(name.toLowerCase()==='set-cookie')continue;
      responseHeaders[name]=value;
    }
    return {
      status:response.status,ok:response.ok,url:url.href,
      text:Buffer.concat(chunks).toString('utf8'),
      headers:responseHeaders
    };
  }
  throw new Error('Demasiadas redirecciones HTTP');
}

async function scratchPowerFetch(rawUrl, method='GET', body='') {
  let url = await assertSafeScratchUrl(rawUrl);
  method = String(method || 'GET').toUpperCase();
  if (!['GET','POST'].includes(method)) throw new Error('Método HTTP no permitido');
  for (let hop=0; hop<6; hop++) {
    const response = await fetch(url, {
      method,
      headers:{'User-Agent':'AxiomCode-Scratch-Power/'+app.getVersion(),'Accept':'*/*', ...(method==='POST'?{'Content-Type':'text/plain; charset=utf-8'}:{})},
      body: method==='POST' ? String(body ?? '').slice(0,2*1024*1024) : undefined,
      redirect:'manual',
      signal:AbortSignal.timeout(20000)
    });
    if ([301,302,303,307,308].includes(response.status)) {
      const location=response.headers.get('location');
      if(!location) throw new Error('Redirección HTTP sin destino');
      url=await assertSafeScratchUrl(new URL(location,url).href);
      if(response.status===303) method='GET';
      continue;
    }
    const reader=response.body?.getReader();
    const chunks=[]; let total=0;
    if(reader){
      while(true){
        const {done,value}=await reader.read();
        if(done) break;
        total+=value.byteLength;
        if(total>SCRATCH_POWER_HTTP_MAX_BYTES){reader.cancel().catch(()=>{});throw new Error('Respuesta web supera 20 MiB');}
        chunks.push(Buffer.from(value));
      }
    }
    const text=Buffer.concat(chunks).toString('utf8');
    return {status:response.status,ok:response.ok,url:url.href,text};
  }
  throw new Error('Demasiadas redirecciones');
}
function scratchPowerStoragePath(){ return path.join(app.getPath('userData'),'scratch-power-storage.json'); }
async function readScratchPowerStorage(){
  try{
    const raw=await fsp.readFile(scratchPowerStoragePath(),'utf8');
    const obj=JSON.parse(raw);
    return obj && typeof obj==='object' && !Array.isArray(obj) ? obj : {};
  }catch{return {};}
}
async function writeScratchPowerStorage(data){
  const raw=JSON.stringify(data);
  if(Buffer.byteLength(raw)>SCRATCH_POWER_STORAGE_MAX_BYTES) throw new Error('Almacenamiento Axiom Power supera 10 MiB');
  const target=scratchPowerStoragePath(), tmp=target+'.tmp';
  await fsp.mkdir(path.dirname(target),{recursive:true});
  await fsp.writeFile(tmp,raw,'utf8');
  await fsp.rm(target,{force:true}).catch(()=>{});
  await fsp.rename(tmp,target);
}
async function scratchPower(op,args={}) {
  await requireScratchInstalled();
  op=String(op||'');
  if(op==='systemInfo') return {
    platform:process.platform, arch:process.arch, release:os.release(),
    cpus:os.cpus().length, memoryMB:Math.round(os.totalmem()/1024/1024),
    language:app.getLocale(), appVersion:app.getVersion()
  };
  if(op==='httpGet') return scratchPowerFetch(args.url,'GET');
  if(op==='httpPost') return scratchPowerFetch(args.url,'POST',args.body);
  if(op==='storageGet'){ const s=await readScratchPowerStorage(); return String(s[String(args.key||'')] ?? ''); }
  if(op==='storageSet'){
    const s=await readScratchPowerStorage(), key=String(args.key||'').slice(0,200), value=String(args.value??'');
    if(!key) throw new Error('Clave vacía'); if(Buffer.byteLength(value)>1024*1024) throw new Error('Valor supera 1 MiB');
    if(!Object.hasOwn(s,key) && Object.keys(s).length>=1024) throw new Error('Máximo 1024 claves');
    s[key]=value; await writeScratchPowerStorage(s); return true;
  }
  if(op==='storageDelete'){ const s=await readScratchPowerStorage(); delete s[String(args.key||'')]; await writeScratchPowerStorage(s); return true; }
  if(op==='storageKeys'){ const s=await readScratchPowerStorage(); return JSON.stringify(Object.keys(s)); }
  if(op==='openTextFile'){
    const result=await dialog.showOpenDialog(mainWindow,{title:'Scratch · Abrir archivo de texto',properties:['openFile'],filters:[{name:'Texto y datos',extensions:['txt','json','csv','md','xml','html','css','js','py']},{name:'Todos los archivos',extensions:['*']}]});
    if(result.canceled) return '';
    const p=result.filePaths[0], st=await fsp.stat(p); if(st.size>20*1024*1024) throw new Error('Archivo supera 20 MiB');
    return await fsp.readFile(p,'utf8');
  }
  if(op==='saveTextFile'){
    const suggested=String(args.name||'scratch.txt').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,120)||'scratch.txt';
    const result=await dialog.showSaveDialog(mainWindow,{title:'Scratch · Guardar archivo de texto',defaultPath:suggested,filters:[{name:'Texto',extensions:['txt']},{name:'JSON',extensions:['json']},{name:'Todos los archivos',extensions:['*']}]});
    if(result.canceled) return false;
    const text=String(args.text??''); if(Buffer.byteLength(text)>20*1024*1024) throw new Error('Contenido supera 20 MiB');
    await fsp.writeFile(result.filePath,text,'utf8'); return true;
  }
  if(op==='savePng'){
    const raw=String(args.dataUrl||'');
    const match=/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(raw);
    if(!match) throw new Error('Imagen PNG no válida');
    const bytes=Buffer.from(match[1],'base64'); if(bytes.length>50*1024*1024) throw new Error('Captura supera 50 MiB');
    const suggested=String(args.name||'escenario.png').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,120)||'escenario.png';
    const result=await dialog.showSaveDialog(mainWindow,{title:'Scratch · Guardar captura del escenario',defaultPath:suggested,filters:[{name:'PNG',extensions:['png']}]});
    if(result.canceled) return false;
    await fsp.writeFile(result.filePath,bytes); return true;
  }
  if(op==='clipboardWrite'){ clipboard.writeText(String(args.text??'')); return true; }
  if(op==='clipboardRead'){
    if(!scratchClipboardReadAllowed){
      const choice=dialog.showMessageBoxSync(mainWindow,{type:'warning',title:'Scratch quiere leer el portapapeles',message:'Un proyecto Scratch solicitó acceso de lectura al portapapeles.',detail:'Permitirlo puede revelar texto que copiaste desde otra aplicación. La autorización durará hasta cerrar AxiomCode.',buttons:['Cancelar','Permitir esta sesión'],defaultId:0,cancelId:0,noLink:true});
      if(choice!==1) throw new Error('Acceso al portapapeles cancelado');
      scratchClipboardReadAllowed=true;
    }
    return clipboard.readText().slice(0,1024*1024);
  }
  if(op==='openUrl'){
    const url=await assertSafeScratchUrl(args.url);
    const choice=dialog.showMessageBoxSync(mainWindow,{type:'question',title:'Scratch quiere abrir un enlace',message:'¿Abrir este enlace en el navegador?',detail:url.href,buttons:['Cancelar','Abrir'],defaultId:0,cancelId:0,noLink:true});
    if(choice!==1) return false;
    const err=await shell.openExternal(url.href); if(err) throw new Error(err); return true;
  }
  if(op==='notify'){
    const title=String(args.title||'Scratch').slice(0,80), body=String(args.body||'').slice(0,500);
    if(Notification.isSupported()) new Notification({title,body}).show(); else dialog.showMessageBox(mainWindow,{type:'info',title,message:body});
    return true;
  }
  throw new Error('Operación Axiom Power no válida');
}
ipcMain.handle('scratch:open', async () => {
  await requireScratchInstalled();
  const result = await dialog.showOpenDialog(mainWindow, { title: 'Abrir proyecto de bloques', filters: [{ name: 'Axiom Scratch', extensions: ['axiomscratch'] }], properties: ['openFile'] });
  if (result.canceled) return null;
  const filePath = result.filePaths[0];
  if ((await fsp.stat(filePath)).size > MAX_AXIOM_SCRATCH_BYTES) throw new Error('El proyecto supera los 100 MiB');
  const content = await fsp.readFile(filePath, 'utf8');
  scratchCore.validate(JSON.parse(content));
  return { path: filePath, content };
});
ipcMain.handle('scratch:save', async (_, data) => {
  await requireScratchInstalled();
  const project = scratchCore.validate(JSON.parse(data.content));
  let filePath = data.path;
  if (!filePath) {
    const result = await dialog.showSaveDialog(mainWindow, { title: 'Guardar proyecto de bloques', defaultPath: 'Mi proyecto.axiomscratch', filters: [{ name: 'Axiom Scratch', extensions: ['axiomscratch'] }] });
    if (result.canceled) return null;
    filePath = result.filePath;
  }
  if (typeof filePath !== 'string' || !filePath.toLowerCase().endsWith('.axiomscratch')) throw new Error('Usa la extensión .axiomscratch');
  await fsp.writeFile(filePath, JSON.stringify(project, null, 2), 'utf8');
  return filePath;
});
const { ScratchService } = require('./backend/services/scratchService');
let mainWindow, backend, scratchService, runnerService, runnerServicePath;
const UPDATE_REPO='Tylerpro09/AxiomCode';
let cachedUpdate=null,updateDownloadActive=false;
function versionParts(v){
  const [core,pre='']=String(v||'0').trim().replace(/^v/i,'').split('-',2);
  const nums=core.split('.').slice(0,4).map(x=>Number.parseInt(x,10)||0);
  while(nums.length<4)nums.push(0);
  return {nums,pre};
}
function compareVersions(a,b){
  const A=versionParts(a),B=versionParts(b);
  for(let i=0;i<4;i++)if(A.nums[i]!==B.nums[i])return A.nums[i]>B.nums[i]?1:-1;
  if(A.pre===B.pre)return 0;
  if(!A.pre)return 1;
  if(!B.pre)return -1;
  return A.pre.localeCompare(B.pre,undefined,{numeric:true,sensitivity:'base'});
}
async function fetchLatestUpdate(){
  const response=await fetch('https://api.github.com/repos/'+UPDATE_REPO+'/releases/latest',{
    headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'AxiomCode-Updater/'+app.getVersion()},
    signal:AbortSignal.timeout(15000)
  });
  if(response.status===404)return {available:false,currentVersion:app.getVersion()};
  if(!response.ok)throw new Error('GitHub HTTP '+response.status);
  const release=await response.json();
  const asset=(release.assets||[]).find(a=>/\.exe$/i.test(a.name)&&/setup/i.test(a.name))||(release.assets||[]).find(a=>/\.exe$/i.test(a.name));
  const latestVersion=String(release.tag_name||release.name||'').replace(/^v/i,'');
  const available=Boolean(asset&&latestVersion&&compareVersions(latestVersion,app.getVersion())>0);
  cachedUpdate={
    available,currentVersion:app.getVersion(),latestVersion,tag:release.tag_name||latestVersion,
    name:release.name||release.tag_name||('AxiomCode '+latestVersion),
    publishedAt:release.published_at||null,releaseUrl:release.html_url||null,
    asset:asset?{name:asset.name,size:Number(asset.size||0),url:asset.browser_download_url,digest:asset.digest||null}:null
  };
  return cachedUpdate;
}
async function downloadAndLaunchUpdate(update){
  if(updateDownloadActive)throw new Error('Ya hay una actualización descargándose');
  if(!update?.available||!update.asset?.url)throw new Error('No hay una actualización instalable disponible');
  updateDownloadActive=true;
  const dir=path.join(app.getPath('userData'),'updates');
  await fsp.mkdir(dir,{recursive:true});
  const safeName=String(update.asset.name||('AxiomCode-Setup-'+update.latestVersion+'.exe')).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_');
  const target=path.join(dir,safeName),partial=target+'.part';
  await fsp.rm(partial,{force:true}).catch(()=>{});
  mainWindow?.webContents.send('app:update:progress',{stage:'starting',percent:0,received:0,total:update.asset.size||0});
  try{
    const response=await fetch(update.asset.url,{redirect:'follow',headers:{'User-Agent':'AxiomCode-Updater/'+app.getVersion()},signal:AbortSignal.timeout(300000)});
    if(!response.ok||!response.body)throw new Error('No se pudo descargar la actualización: HTTP '+response.status);
    const total=Number(response.headers.get('content-length')||update.asset.size||0);
    let received=0,lastPercent=-1;
    const hash=require('crypto').createHash('sha256');
    const meter=new Transform({
      transform(chunk,enc,cb){
        received+=chunk.length;hash.update(chunk);
        const percent=total?Math.min(100,Math.floor(received*100/total)):0;
        if(percent!==lastPercent){lastPercent=percent;mainWindow?.webContents.send('app:update:progress',{stage:'downloading',percent,received,total});}
        cb(null,chunk);
      }
    });
    await pipeline(Readable.fromWeb(response.body),meter,fs.createWriteStream(partial));
    const actual='sha256:'+hash.digest('hex').toLowerCase();
    if(update.asset.digest&&String(update.asset.digest).toLowerCase()!==actual){
      await fsp.rm(partial,{force:true}).catch(()=>{});
      throw new Error('La verificación SHA-256 del instalador falló');
    }
    await fsp.rm(target,{force:true}).catch(()=>{});
    await fsp.rename(partial,target);
    mainWindow?.webContents.send('app:update:progress',{stage:'verified',percent:100,received,total,path:target});
    const launchError=await shell.openPath(target);
    if(launchError)throw new Error(launchError);
    mainWindow?.webContents.send('app:update:progress',{stage:'launching',percent:100,path:target});
    setTimeout(()=>app.quit(),1200);
    return {ok:true,path:target,version:update.latestVersion};
  }finally{
    updateDownloadActive=false;
  }
}
async function requireScratchInstalled(){
  if(!backend) throw new Error('AxiomCode todavía no está listo');
  const entry=await backend.extensions.installedEntry(SCRATCH_EXTENSION_ID);
  if(!entry) throw new Error('La extensión Modo Scratch no está instalada');
  if(!scratchCore) scratchCore=require(path.join(entry.path,'core.js'));
  return entry;
}
async function ensureScratchService(){
  const entry=await requireScratchInstalled();
  if(!scratchService){ scratchService=new ScratchService(app,entry.path); await scratchService.start(); }
  return scratchService;
}
async function ensureRunnerService(){
  if(!backend)throw new Error('AxiomCode todavía no está listo');
  const entry=await backend.extensions.installedEntry(RUNNER_EXTENSION_ID);
  if(!entry)throw new Error('La extensión Runner no está instalada');
  const servicePath=path.join(entry.path,'runnerService.js');
  if(runnerService&&runnerServicePath===servicePath)return runnerService;
  delete require.cache[require.resolve(servicePath)];
  const mod=require(servicePath);
  const RunnerService=mod.RunnerService||mod.default||mod;
  runnerService=new RunnerService();
  runnerServicePath=servicePath;
  return runnerService;
}
ipcMain.on('scratch:confirmDiscard', event => {
  event.returnValue = dialog.showMessageBoxSync(mainWindow, {type:'question',title:'Cambios sin guardar en Scratch',message:'Hay cambios sin guardar en el proyecto de bloques.',detail:'Guarda el proyecto antes de continuar si quieres conservar los cambios.',buttons:['Cancelar','Descartar cambios'],defaultId:0,cancelId:0,noLink:true}) === 1;
});
ipcMain.handle('scratch:info', async () => ({url:(await ensureScratchService()).url}));
ipcMain.handle('scratch:power', async (_, op, args) => scratchPower(op,args));
ipcMain.handle('scratch:openExtensionJs', async () => {
  await requireScratchInstalled();
  const result=await dialog.showOpenDialog(mainWindow,{title:'Scratch · Cargar extensión JavaScript local',properties:['openFile'],filters:[{name:'Extensión JavaScript',extensions:['js']}]});
  if(result.canceled) return null;
  const filePath=result.filePaths[0], st=await fsp.stat(filePath);
  if(st.size>2*1024*1024) throw new Error('La extensión JavaScript supera 2 MiB');
  const bytes=await fsp.readFile(filePath);
  const security=scanExtensionFiles([{path:path.basename(filePath),bytes}]);
  assertExtensionSafe(security);
  return {name:path.basename(filePath),code:bytes.toString('utf8'),security:{engine:security.engine,verdict:security.verdict,score:security.score,findings:security.findings}};
});
ipcMain.handle('scratch:openSb3', async (_, requestedPath) => {
  await requireScratchInstalled();
  let filePath = requestedPath;
  if (!filePath) {
    const result = await dialog.showOpenDialog(mainWindow, {title:'Abrir proyecto Scratch', filters:[{name:'Scratch',extensions:['sb3','sb2','sb']}],properties:['openFile']});
    if (result.canceled) return null;
    filePath = result.filePaths[0];
  }
  if (typeof filePath !== 'string' || !/\.(sb3|sb2|sb)$/i.test(filePath)) throw new Error('Selecciona un archivo Scratch');
  if ((await fsp.stat(filePath)).size > MAX_SB3_BYTES) throw new Error('El proyecto supera los 512 MiB');
  return {path:filePath,bytes:new Uint8Array(await fsp.readFile(filePath))};
});
ipcMain.handle('scratch:saveSb3', async (_, data) => {
  await requireScratchInstalled();
  if (!(data.bytes instanceof Uint8Array) || data.bytes.length > MAX_SB3_BYTES || data.bytes[0] !== 80 || data.bytes[1] !== 75) throw new Error('Proyecto .sb3 no válido o supera 512 MiB');
  let filePath = data.path;
  if (!filePath) {
    const title = String(data.title || 'Mi proyecto').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,100);
    const result = await dialog.showSaveDialog(mainWindow, {title:'Guardar proyecto Scratch',defaultPath:title+'.sb3',filters:[{name:'Scratch 3',extensions:['sb3']}]});
    if (result.canceled) return null;
    filePath = result.filePath;
  }
  if (typeof filePath !== 'string' || !filePath.toLowerCase().endsWith('.sb3')) throw new Error('Usa la extensión .sb3');
  const temporary = filePath + '.axiom-' + require('crypto').randomBytes(6).toString('hex') + '.tmp';
  try { await fsp.writeFile(temporary, data.bytes, {flag:'wx'}); await fsp.rename(temporary, filePath); }
  finally { await fsp.unlink(temporary).catch(() => {}); }
  return filePath;
});
function safeRendererSend(channel,payload){
  const win=mainWindow;
  if(!win||win.isDestroyed?.())return false;
  try{
    const contents=win.webContents;
    if(!contents||contents.isDestroyed?.())return false;
    contents.send(channel,payload);
    return true;
  }catch{
    return false;
  }
}
function createWindow() {
  const win = new BrowserWindow({ width: 1500, height: 920, minWidth: 980, minHeight: 640, backgroundColor: '#1f1f1f', title: 'AxiomCode', icon: path.join(__dirname,'assets','branding','axiomcode-icon.png'), autoHideMenuBar: true, titleBarStyle: 'hidden', titleBarOverlay: { color: '#181818', symbolColor: '#cccccc', height: 35 }, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  mainWindow=win;
  win.on('closed',()=>{if(mainWindow===win)mainWindow=null;});
  win.loadFile(path.join(__dirname, 'src', 'index.html'), {query:process.argv.includes('--scratch') ? {scratch:'1'} : {}});
}
async function tree(dir, depth = 0) {
  if (depth > 12) return [];
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const visible = entries.filter(e => !['node_modules', '.git', 'dist', 'out'].includes(e.name)).sort((a,b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
  return Promise.all(visible.map(async e => ({ name: e.name, path: path.join(dir, e.name), type: e.isDirectory() ? 'dir' : 'file', children: e.isDirectory() ? await tree(path.join(dir, e.name), depth + 1) : undefined })));
}
function run(command, cwd) { return new Promise(resolve => exec(command, { cwd: cwd || app.getPath('home'), windowsHide: true, shell: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => resolve({ ok: !error, code: error?.code ?? 0, stdout, stderr }))); }
function runGitArgs(args,cwd){
  return new Promise(resolve=>{
    const child=spawn('git',args,{cwd:cwd||app.getPath('home'),windowsHide:true,shell:false});
    let stdout='',stderr='',settled=false;
    const finish=(ok,code)=>{if(settled)return;settled=true;resolve({ok,code:code??0,stdout,stderr});};
    child.stdout?.on('data',chunk=>{stdout+=String(chunk);if(stdout.length>8*1024*1024)child.kill();});
    child.stderr?.on('data',chunk=>{stderr+=String(chunk);if(stderr.length>8*1024*1024)child.kill();});
    child.on('error',error=>{stderr+=String(error?.message||error);finish(false,error?.code||1);});
    child.on('close',code=>finish(code===0,code));
  });
}
app.whenReady().then(async()=>{backend=createBackend(app,__dirname,safeRendererSend);await backend.configuration.load();createWindow();});
app.on('window-all-closed', () => { backend?.watcher.dispose(); scratchService?.close(); if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
ipcMain.handle('workspace:open', async () => { const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] }); if (r.canceled) return null; const root = r.filePaths[0]; await backend.workspace.remember(root); backend.watcher.watch(root); return { root, tree: await tree(root) }; });
ipcMain.handle('workspace:refresh', async (_, root) => ({ root, tree: await tree(root) }));
ipcMain.handle('workspace:restore', async()=>{const root=await backend.workspace.restoreLast();if(!root)return null;backend.watcher.watch(root);return{root,tree:await tree(root)};});
ipcMain.handle('workspace:recent', ()=>backend.workspace.recent());
ipcMain.handle('workspace:openPath', async (_, requestedRoot) => {
  const root=path.resolve(String(requestedRoot||''));
  const st=await fsp.stat(root);
  if(!st.isDirectory())throw new Error('La ruta no es una carpeta');
  await backend.workspace.remember(root);
  backend.watcher.watch(root);
  return {root,tree:await tree(root)};
});
ipcMain.handle('file:openDialog', async (_, root) => { const r=await dialog.showOpenDialog(mainWindow,{defaultPath:root||app.getPath('home'),properties:['openFile','multiSelections']}); if(r.canceled)return []; return r.filePaths; });
ipcMain.handle('file:read', async (_, p) => ({ path: p, content: await fsp.readFile(p, 'utf8') }));
ipcMain.handle('file:readOptional', async (_, p) => { try { return { path:p, content:await fsp.readFile(p,'utf8') }; } catch (error) { if (error?.code==='ENOENT') return null; throw error; } });
ipcMain.handle('file:write', async (_, p, content) => { await fsp.writeFile(p, content, 'utf8'); return true; });
ipcMain.handle('file:create', async (_, p, isDir) => { isDir ? await fsp.mkdir(p, { recursive: true }) : await fsp.writeFile(p, '', { flag: 'wx' }); return true; });
ipcMain.handle('file:rename', async (_, from, to) => { await fsp.rename(from, to); return true; });
ipcMain.handle('file:copy', async (_, from, to) => { await fsp.cp(from, to, {recursive:true,errorOnExist:true,force:false}); return true; });
ipcMain.handle('file:delete', async (_, p) => { await fsp.rm(p, { recursive: true, force: true }); return true; });
ipcMain.handle('terminal:run', async (_, command, cwd) => run(command, cwd));
ipcMain.handle('git:status', async (_, cwd) => run('git status --porcelain -b', cwd));
ipcMain.handle('git:changes', async (_,cwd)=>run('git status --porcelain',cwd));
ipcMain.handle('git:addAll', async (_,cwd)=>run('git add -A',cwd));
ipcMain.handle('git:commit', async (_,cwd,message)=>run('git commit -m '+JSON.stringify(String(message||'')),cwd));
ipcMain.handle('git:stageFile', async (_,cwd,file)=>runGitArgs(['add','--',String(file||'')],cwd));
ipcMain.handle('git:unstageFile', async (_,cwd,file)=>runGitArgs(['restore','--staged','--',String(file||'')],cwd));
ipcMain.handle('git:discardFile', async (_,cwd,file)=>runGitArgs(['restore','--worktree','--',String(file||'')],cwd));
ipcMain.handle('git:branches', async (_,cwd)=>runGitArgs(['branch','--format=%(refname:short)'],cwd));
ipcMain.handle('git:checkout', async (_,cwd,branch)=>{
  const name=String(branch||'').trim();
  if(!name||/[\r\n\0]/.test(name))throw new Error('Rama Git no válida');
  return runGitArgs(['checkout',name],cwd);
});
ipcMain.handle('git:showHead', async (_,cwd,file)=>{
  const rel=String(file||'').replace(/\\/g,'/');
  if(!rel||/[\r\n\0]/.test(rel))throw new Error('Ruta Git no válida');
  return runGitArgs(['show','HEAD:'+rel],cwd);
});
ipcMain.handle('system:reveal', async (_, p) => { shell.showItemInFolder(p); return true; });
ipcMain.handle('system:clipboardWrite', async (_, text) => { clipboard.writeText(String(text??'')); return true; });
ipcMain.handle('system:openExternal', async (_, rawUrl) => {
  const url=new URL(String(rawUrl||''));
  if(url.protocol!=='https:')throw new Error('Solo se permiten enlaces HTTPS');
  const error=await shell.openExternal(url.href);
  if(error)throw new Error(error);
  return true;
});
ipcMain.handle('extensions:networkRequest', async (_, extensionId, request) => extensionNetworkRequest(extensionId,request));
function searchPattern(query,options={}){
  const raw=String(query||'');
  if(!raw)throw new Error('Escribe un texto para buscar');
  if(raw.length>500)throw new Error('La búsqueda supera 500 caracteres');
  const flags='g'+(options.matchCase?'':'i');
  if(options.regex){
    try{return new RegExp(raw,flags);}catch(error){throw new Error('Expresión regular no válida: '+error.message);}
  }
  const escaped=raw.replace(/[|\\{}()[\]^$+*?.-]/g,'\\$&');
  return new RegExp(options.wholeWord?'\\b(?:'+escaped+')\\b':escaped,flags);
}
async function searchFiles(root, query, results = [], options = {}) {
  if (!query || results.length >= 500) return results;
  const pattern=searchPattern(query,options);
  for (const e of await fsp.readdir(root, { withFileTypes: true })) {
    if (results.length >= 500) break;
    if (['node_modules','.git','dist','out','build','target','.next','coverage'].includes(e.name)) continue;
    const p = path.join(root,e.name);
    if (e.isDirectory()) await searchFiles(p,query,results,options);
    else {
      try {
        const s = await fsp.stat(p);
        if (s.size > 2_000_000) continue;
        const fileLines=(await fsp.readFile(p,'utf8')).split(/\r?\n/);
        fileLines.forEach((line,i)=>{
          if(results.length>=500)return;
          pattern.lastIndex=0;
          const match=pattern.exec(line);
          if(match)results.push({path:p,line:i+1,column:match.index+1,length:Math.max(1,match[0].length),text:line.trim().slice(0,220)});
        });
      } catch {}
    }
  }
  return results;
}
async function replaceInWorkspace(root, query, replacement, options = {}) {
  const pattern=searchPattern(query,options);
  let filesChanged=0,replacements=0,filesScanned=0;
  async function walk(dir){
    for(const e of await fsp.readdir(dir,{withFileTypes:true})){
      if(['node_modules','.git','dist','out','build','target','.next','coverage'].includes(e.name))continue;
      const p=path.join(dir,e.name);
      if(e.isDirectory()){await walk(p);continue;}
      try{
        const st=await fsp.stat(p);
        if(st.size>2_000_000)continue;
        const original=await fsp.readFile(p,'utf8');
        filesScanned++;
        pattern.lastIndex=0;
        let count=0;
        const next=original.replace(pattern,(...args)=>{
          count++;
          if(count>100000)throw new Error('Demasiadas coincidencias en '+p);
          if(options.regex){
            const match=args[0];
            const captures=args.slice(1,-2);
            return String(replacement??'').replace(/\$(\$|&|[1-9][0-9]?)/g,(token,key)=>{
              if(key==='$')return '$';
              if(key==='&')return match;
              const index=Number(key)-1;
              return Number.isInteger(index)&&index>=0&&index<captures.length&&captures[index]!==undefined?String(captures[index]):token;
            });
          }
          return String(replacement??'');
        });
        if(count&&next!==original){
          await fsp.writeFile(p,next,'utf8');
          filesChanged++;replacements+=count;
        }
      }catch(error){
        if(error?.code==='EISDIR')continue;
        if(/Demasiadas coincidencias/.test(String(error?.message||'')))throw error;
      }
    }
  }
  await walk(root);
  return {filesChanged,replacements,filesScanned};
}
ipcMain.handle('workspace:search', async (_, root, query, options={}) => searchFiles(root, query, [], options));
ipcMain.handle('workspace:replace', async (_, root, query, replacement, options={}) => replaceInWorkspace(root, query, replacement, options));
async function workspaceSymbols(root,query='',results=[],state={files:0}){
  if(results.length>=1000||state.files>=600)return results;
  const low=String(query||'').trim().toLowerCase();
  const patterns=[
    {kind:'class',re:/^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/},
    {kind:'interface',re:/^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/},
    {kind:'enum',re:/^\s*(?:export\s+)?(?:enum|struct|trait)\s+([A-Za-z_$][\w$]*)/},
    {kind:'function',re:/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/},
    {kind:'function',re:/^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\(/},
    {kind:'function',re:/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)\s*\(/},
    {kind:'function',re:/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)\s*\(/},
    {kind:'function',re:/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/},
    {kind:'method',re:/^\s*(?:(?:public|private|protected|static|final|virtual|override|async|synchronized|abstract|extern)\s+)*(?:[A-Za-z_$][\w$<>\[\],.?]*\s+)+([A-Za-z_$][\w$]*)\s*\([^;]*\)\s*(?:\{|=>)?/}
  ];
  const supported=new Set(['js','jsx','mjs','cjs','ts','tsx','py','java','c','h','cpp','cc','cxx','hpp','cs','go','rs','php','dart','kt','kts','swift']);
  async function walk(dir){
    if(results.length>=1000||state.files>=600)return;
    let entries;
    try{entries=await fsp.readdir(dir,{withFileTypes:true});}catch{return;}
    for(const entry of entries){
      if(results.length>=1000||state.files>=600)break;
      if(['node_modules','.git','dist','out','build','target','.next','coverage','.venv','vendor'].includes(entry.name))continue;
      const p=path.join(dir,entry.name);
      if(entry.isDirectory()){await walk(p);continue;}
      const ext=entry.name.includes('.')?entry.name.split('.').pop().toLowerCase():'';
      if(!supported.has(ext))continue;
      try{
        const st=await fsp.stat(p);if(st.size>2_000_000)continue;
        state.files++;
        const lines=(await fsp.readFile(p,'utf8')).split(/\r?\n/);
        for(let i=0;i<lines.length&&results.length<1000;i++){
          const line=lines[i];
          for(const pattern of patterns){
            const match=pattern.re.exec(line);
            if(!match)continue;
            const name=match[1];
            if(low&&!name.toLowerCase().includes(low))break;
            results.push({name,kind:pattern.kind,path:p,line:i+1,column:Math.max(1,line.indexOf(name)+1)});
            break;
          }
        }
      }catch{}
    }
  }
  await walk(root);
  return results;
}
ipcMain.handle('workspace:symbols', async (_,root,query='') => workspaceSymbols(root,query));
let materialIcons;
function getMaterialIcons(){
  if(!materialIcons){
    const p=path.join(__dirname,'node_modules','material-icon-theme','dist','material-icons.json');
    materialIcons=JSON.parse(fs.readFileSync(p,'utf8'));
  }
  return materialIcons;
}
ipcMain.handle('icons:manifest',()=>getMaterialIcons());
ipcMain.handle('app:info',()=>({name:'AxiomCode',version:app.getVersion(),platform:process.platform,electron:process.versions.electron,node:process.versions.node}));
ipcMain.handle('app:update:check',async()=>fetchLatestUpdate());
ipcMain.handle('app:update:install',async()=>downloadAndLaunchUpdate(cachedUpdate?.available?cachedUpdate:await fetchLatestUpdate()));
ipcMain.handle('config:getAll',()=>backend.configuration.getAll());
ipcMain.handle('config:getDefaults',()=>backend.configuration.getDefaults());
ipcMain.handle('config:get',(_,key)=>backend.configuration.get(key));
ipcMain.handle('config:set',(_,key,value)=>backend.configuration.set(key,value));
ipcMain.handle('config:setMany',(_,values)=>backend.configuration.setMany(values));
ipcMain.handle('config:reload',()=>backend.configuration.reload());
ipcMain.handle('config:reset',()=>backend.configuration.reset());
ipcMain.handle('config:path',async()=>{await backend.configuration.load();return backend.configuration.file;});
ipcMain.handle('preferences:resource',async(_,name)=>{
  const allowed={snippets:'snippets.json'};
  const fileName=allowed[String(name||'')];
  if(!fileName)throw new Error('Recurso de preferencias no válido');
  const target=path.join(app.getPath('userData'),fileName);
  try{await fsp.access(target);}catch{await fsp.writeFile(target,'{}\n','utf8');}
  return target;
});
ipcMain.handle('preferences:export',async()=>{
  const result=await dialog.showSaveDialog(mainWindow,{
    title:'AxiomCode · Exportar perfil y configuración',
    defaultPath:'AxiomCode-Preferences.json',
    filters:[{name:'AxiomCode Preferences',extensions:['json']}]
  });
  if(result.canceled)return null;
  const bundle={
    schemaVersion:1,
    app:'AxiomCode',
    exportedAt:new Date().toISOString(),
    settings:await backend.configuration.getAll(),
    extensions:await backend.extensions.readState()
  };
  await fsp.writeFile(result.filePath,JSON.stringify(bundle,null,2),'utf8');
  return result.filePath;
});
ipcMain.handle('preferences:import',async()=>{
  const result=await dialog.showOpenDialog(mainWindow,{
    title:'AxiomCode · Importar perfil y configuración',
    properties:['openFile'],
    filters:[{name:'AxiomCode Preferences',extensions:['json']}]
  });
  if(result.canceled)return null;
  const bundle=JSON.parse(await fsp.readFile(result.filePaths[0],'utf8'));
  if(bundle?.schemaVersion!==1||bundle?.app!=='AxiomCode'||!bundle.settings)throw new Error('Archivo de preferencias AxiomCode no válido');
  await backend.configuration.replaceAll(bundle.settings);
  if(bundle.extensions&&typeof bundle.extensions==='object')await backend.extensions.writeState(bundle.extensions);
  return {path:result.filePaths[0],settings:await backend.configuration.getAll()};
});
ipcMain.handle('extensions:list',()=>backend.extensions.list());
ipcMain.handle('extensions:marketplace',(_,force=false)=>backend.extensions.marketplace(Boolean(force)));
ipcMain.handle('extensions:update',async(_,id)=>{const result=await backend.extensions.update(id);if(id===SCRATCH_EXTENSION_ID){scratchService?.close();scratchService=null;scratchCore=null;}if(id===RUNNER_EXTENSION_ID){runnerService=null;runnerServicePath=null;}return result;});
ipcMain.handle('extensions:install',async(_,id)=>{const result=await backend.extensions.install(id);if(id===SCRATCH_EXTENSION_ID){scratchService?.close();scratchService=null;scratchCore=null;}if(id===RUNNER_EXTENSION_ID){runnerService=null;runnerServicePath=null;}return result;});
ipcMain.handle('extensions:uninstall',async(_,id)=>{const result=await backend.extensions.uninstall(id);if(id===SCRATCH_EXTENSION_ID){scratchService?.close();scratchService=null;scratchCore=null;}if(id===RUNNER_EXTENSION_ID){runnerService=null;runnerServicePath=null;}return result;});
ipcMain.handle('extensions:openFolder',()=>backend.extensions.openFolder(shell));
ipcMain.handle('extensions:readText',(_,id,relativePath)=>backend.extensions.readInstalledText(id,relativePath));
ipcMain.handle('runner:describe',async(_,file)=>{
  const installed=await backend.extensions.isInstalled(RUNNER_EXTENSION_ID);
  if(!installed)return {installed:false,supported:false,extension:path.extname(String(file||'')).slice(1).toLowerCase(),candidates:[]};
  const service=await ensureRunnerService();
  return {installed:true,...service.describe(file)};
});
ipcMain.handle('runner:prepare',async(_,file)=>{
  const service=await ensureRunnerService();
  return service.prepare(file);
});
ipcMain.on('renderer:ready',(_,info)=>console.log('[AxiomCode] renderer listo',info));
let pty=null; try{pty=require('node-pty');console.log('[AxiomCode] node-pty disponible');}catch(e){console.warn('[AxiomCode] node-pty no disponible, usando fallback:',e.message);}
const terminalSessions=new Map(); let terminalCounter=0;
ipcMain.handle('terminal:create',async(_,opts={})=>{
 const id=`term-${++terminalCounter}`,cwd=opts.cwd&&fs.existsSync(opts.cwd)?opts.cwd:app.getPath('home'),shellName=opts.shell==='cmd'?'cmd':'powershell';
 const command=shellName==='cmd'?(process.env.ComSpec||'cmd.exe'):'powershell.exe',args=shellName==='cmd'?['/Q']:['-NoLogo','-NoProfile'];
 if(pty){const proc=pty.spawn(command,args,{cwd,cols:100,rows:30,name:'xterm-256color',env:{...process.env,TERM:'xterm-256color',TERM_PROGRAM:'AxiomCode'}});terminalSessions.set(id,{type:'pty',proc,shell:shellName,cwd});proc.onData(data=>mainWindow?.webContents.send('terminal:data',{id,data}));proc.onExit(({exitCode,signal})=>{terminalSessions.delete(id);mainWindow?.webContents.send('terminal:exit',{id,code:exitCode,signal});});return{id,pid:proc.pid,shell:shellName,cwd,pty:true};}
 const child=spawn(command,shellName==='cmd'?['/Q','/K']:['-NoLogo','-NoProfile','-NoExit'],{cwd,windowsHide:true,env:{...process.env,TERM_PROGRAM:'AxiomCode'}});terminalSessions.set(id,{type:'spawn',child,shell:shellName,cwd});child.stdout.on('data',d=>mainWindow?.webContents.send('terminal:data',{id,data:d.toString()}));child.stderr.on('data',d=>mainWindow?.webContents.send('terminal:data',{id,data:d.toString()}));child.on('exit',(code,signal)=>{terminalSessions.delete(id);mainWindow?.webContents.send('terminal:exit',{id,code,signal});});return{id,pid:child.pid,shell:shellName,cwd,pty:false};
});
ipcMain.handle('terminal:write',(_,id,data)=>{const t=terminalSessions.get(id);if(!t)return false;if(t.type==='pty')t.proc.write(String(data));else if(!t.child.killed)t.child.stdin.write(String(data));else return false;return true;});
ipcMain.handle('terminal:resize',(_,id,cols,rows)=>{const t=terminalSessions.get(id);if(t?.type!=='pty')return false;try{t.proc.resize(Math.max(2,cols|0),Math.max(1,rows|0));return true;}catch{return false;}});
ipcMain.handle('terminal:kill',(_,id)=>{const t=terminalSessions.get(id);if(!t)return false;try{t.type==='pty'?t.proc.kill():t.child.kill();}catch{}terminalSessions.delete(id);return true;});
