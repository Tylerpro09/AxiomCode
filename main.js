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
let scratchCore;
const SCRATCH_EXTENSION_ID = 'axiom.scratch-mode';
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
let mainWindow, backend, scratchService;
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
  if(!backend || !await backend.extensions.isInstalled(SCRATCH_EXTENSION_ID)) throw new Error('La extensión Modo Scratch no está instalada');
  if(!scratchCore) scratchCore=require('./extensions/scratch-mode/core');
}
async function ensureScratchService(){
  await requireScratchInstalled();
  if(!scratchService){ scratchService=new ScratchService(app,__dirname); await scratchService.start(); }
  return scratchService;
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
  return {name:path.basename(filePath),code:await fsp.readFile(filePath,'utf8')};
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
function createWindow() {
  mainWindow = new BrowserWindow({ width: 1500, height: 920, minWidth: 980, minHeight: 640, backgroundColor: '#1f1f1f', title: 'AxiomCode', autoHideMenuBar: true, titleBarStyle: 'hidden', titleBarOverlay: { color: '#181818', symbolColor: '#cccccc', height: 35 }, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'), {query:process.argv.includes('--scratch') ? {scratch:'1'} : {}});
}
async function tree(dir, depth = 0) {
  if (depth > 12) return [];
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const visible = entries.filter(e => !['node_modules', '.git', 'dist', 'out'].includes(e.name)).sort((a,b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
  return Promise.all(visible.map(async e => ({ name: e.name, path: path.join(dir, e.name), type: e.isDirectory() ? 'dir' : 'file', children: e.isDirectory() ? await tree(path.join(dir, e.name), depth + 1) : undefined })));
}
function run(command, cwd) { return new Promise(resolve => exec(command, { cwd: cwd || app.getPath('home'), windowsHide: true, shell: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => resolve({ ok: !error, code: error?.code ?? 0, stdout, stderr }))); }
app.whenReady().then(async()=>{backend=createBackend(app,__dirname,(channel,payload)=>mainWindow?.webContents.send(channel,payload));await backend.configuration.load();createWindow();});
app.on('window-all-closed', () => { backend?.watcher.dispose(); scratchService?.close(); if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
ipcMain.handle('workspace:open', async () => { const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] }); if (r.canceled) return null; const root = r.filePaths[0]; await backend.workspace.remember(root); backend.watcher.watch(root); return { root, tree: await tree(root) }; });
ipcMain.handle('workspace:refresh', async (_, root) => ({ root, tree: await tree(root) }));
ipcMain.handle('workspace:restore', async()=>{const root=await backend.workspace.restoreLast();if(!root)return null;backend.watcher.watch(root);return{root,tree:await tree(root)};});
ipcMain.handle('workspace:recent', ()=>backend.workspace.recent());
ipcMain.handle('file:openDialog', async (_, root) => { const r=await dialog.showOpenDialog(mainWindow,{defaultPath:root||app.getPath('home'),properties:['openFile','multiSelections']}); if(r.canceled)return []; return r.filePaths; });
ipcMain.handle('file:read', async (_, p) => ({ path: p, content: await fsp.readFile(p, 'utf8') }));
ipcMain.handle('file:write', async (_, p, content) => { await fsp.writeFile(p, content, 'utf8'); return true; });
ipcMain.handle('file:create', async (_, p, isDir) => { isDir ? await fsp.mkdir(p, { recursive: true }) : await fsp.writeFile(p, '', { flag: 'wx' }); return true; });
ipcMain.handle('file:rename', async (_, from, to) => { await fsp.rename(from, to); return true; });
ipcMain.handle('file:delete', async (_, p) => { await fsp.rm(p, { recursive: true, force: true }); return true; });
ipcMain.handle('terminal:run', async (_, command, cwd) => run(command, cwd));
ipcMain.handle('git:status', async (_, cwd) => run('git status --porcelain -b', cwd));
ipcMain.handle('git:changes', async (_,cwd)=>run('git status --porcelain',cwd));
ipcMain.handle('git:addAll', async (_,cwd)=>run('git add -A',cwd));
ipcMain.handle('git:commit', async (_,cwd,message)=>run('git commit -m '+JSON.stringify(String(message||'')),cwd));
ipcMain.handle('system:reveal', async (_, p) => { shell.showItemInFolder(p); return true; });
async function searchFiles(root, query, results = []) { if (!query || results.length >= 150) return results; for (const e of await fsp.readdir(root, { withFileTypes: true })) { if (results.length >= 150) break; if (['node_modules','.git','dist','out'].includes(e.name)) continue; const p = path.join(root,e.name); if (e.isDirectory()) await searchFiles(p,query,results); else { try { const s = await fsp.stat(p); if (s.size > 2_000_000) continue; const lines=(await fsp.readFile(p,'utf8')).split(/\r?\n/); lines.forEach((line,i)=>{ if(results.length<150 && line.toLowerCase().includes(query.toLowerCase())) results.push({path:p,line:i+1,text:line.trim().slice(0,180)}); }); } catch {} } } return results; }
ipcMain.handle('workspace:search', async (_, root, query) => searchFiles(root, query));
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
ipcMain.handle('config:get',(_,key)=>backend.configuration.get(key));
ipcMain.handle('config:set',(_,key,value)=>backend.configuration.set(key,value));
ipcMain.handle('extensions:list',()=>backend.extensions.list());
ipcMain.handle('extensions:marketplace',(_,force=false)=>backend.extensions.marketplace(Boolean(force)));
ipcMain.handle('extensions:update',async(_,id)=>backend.extensions.update(id));
ipcMain.handle('extensions:install',async(_,id)=>backend.extensions.install(id));
ipcMain.handle('extensions:uninstall',async(_,id)=>{const result=await backend.extensions.uninstall(id);if(id===SCRATCH_EXTENSION_ID){scratchService?.close();scratchService=null;}return result;});
ipcMain.handle('extensions:openFolder',()=>backend.extensions.openFolder(shell));
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