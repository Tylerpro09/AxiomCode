const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const {scanExtensionFiles,combineSecurityReports,assertExtensionSafe,shouldInspectFile}=require('./extensionSecurity');

const DEFAULT_MARKETPLACE_URL = 'https://axiomcode-marketplace.onrender.com/api/catalog?includeExternal=1';
const MAX_CATALOG_BYTES = Number.POSITIVE_INFINITY;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_EXTENSION_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_REPOSITORY_TREE_BYTES = 16 * 1024 * 1024;
const REPOSITORY_DOWNLOAD_CONCURRENCY = 16;
const TRUSTED_OFFICIAL_REPOSITORIES = new Map([
  ['axiom.scratch-mode',{owner:'Tylerpro09',repo:'AxiomCode',subdir:'extensions/scratch-mode'}],
  ['axiom.runner',{owner:'Tylerpro09',repo:'AxiomCode',subdir:'extensions/runner'}]
]);

class AxiomExtensionService {
  constructor(app, appRoot) {
    this.appRoot = appRoot;
    // Official/community extensions are not bundled with the application package.
    // Development sources may live under appRoot/extensions, but runtime discovery uses userData only.
    this.userRoot = path.join(app.getPath('userData'), 'extensions');
    this.statePath = path.join(app.getPath('userData'), 'extension-state.json');
    this.marketplaceCachePath = path.join(app.getPath('userData'), 'marketplace-cache.json');
    this.fallbackCatalogPath = path.join(appRoot, 'marketplace', 'fallback.json');
    this.quarantineRoot = path.join(app.getPath('userData'), 'extension-quarantine');
    this.marketplaceUrl = process.env.AXIOM_MARKETPLACE_URL || DEFAULT_MARKETPLACE_URL;
  }

  async ensure() { await fsp.mkdir(this.userRoot, {recursive:true}); }

  async readState() {
    try { return JSON.parse(await fsp.readFile(this.statePath, 'utf8')); }
    catch { return {installed:{},security:{}}; }
  }

  async writeState(state) {
    await this.ensure();
    await fsp.writeFile(this.statePath, JSON.stringify(state, null, 2), 'utf8');
  }

  async writeQuarantineReport(entry, report, phase='install') {
    await fsp.mkdir(this.quarantineRoot,{recursive:true});
    const safeId=String(entry?.id||'unknown').replace(/[^A-Za-z0-9._-]/g,'_').slice(0,128);
    const file=path.join(this.quarantineRoot,safeId+'-'+Date.now()+'.json');
    await fsp.writeFile(file,JSON.stringify({
      id:entry?.id||null,
      name:entry?.name||null,
      version:entry?.version||null,
      phase,
      quarantinedAt:new Date().toISOString(),
      report
    },null,2),'utf8');
    return file;
  }

  async scanDirectorySecurity(root) {
    const reports=[];
    const walk=async(dir,relative='')=>{
      const entries=await fsp.readdir(dir,{withFileTypes:true});
      for(const entry of entries){
        if(entry.name==='.git')continue;
        const rel=relative?relative+'/'+entry.name:entry.name;
        const full=path.join(dir,entry.name);
        if(entry.isDirectory()){ await walk(full,rel); continue; }
        if(!entry.isFile()||!shouldInspectFile(rel))continue;
        const bytes=await fsp.readFile(full);
        reports.push(scanExtensionFiles([{path:rel,bytes}]));
      }
    };
    await walk(root);
    return combineSecurityReports(reports);
  }

  async scanRoot(root, scope) {
    if (!fs.existsSync(root)) return [];
    const entries = await fsp.readdir(root, {withFileTypes:true});
    const result = [];
    for (const entry of entries.filter(e => e.isDirectory() && !e.name.startsWith('.'))) {
      const dir = path.join(root, entry.name);
      try {
        const manifest = JSON.parse(await fsp.readFile(path.join(dir, 'extension.json'), 'utf8'));
        const state=await this.readState();
        const trustedInstall=scope==='user'&&state.security?.[manifest.id]?.verdict&&state.security[manifest.id].verdict!=='blocked';
        const security=scope==='user'?(trustedInstall?state.security[manifest.id]:await this.scanDirectorySecurity(dir)):null;
        result.push({
          scope, path:dir, folder:entry.name, id:manifest.id||entry.name, name:manifest.name||entry.name,
          version:manifest.version||'0.0.0', description:manifest.description||'', manifestEnabled:manifest.enabled!==false,
          installedByDefault:manifest.installedByDefault!==false, contributes:manifest.contributes||{},
          publisher:manifest.publisher||'Local',security,securityBlocked:security?.verdict==='blocked'
        });
      } catch {}
    }
    return result;
  }

  async entries() {
    await this.ensure();
    return this.scanRoot(this.userRoot,'user');
  }

  async list() {
    const state = await this.readState(), entries = await this.entries();
    const userIds = new Set(entries.filter(x=>x.scope==='user'&&!x.securityBlocked).map(x=>x.id));
    return entries.filter((x,i,a)=>a.findIndex(y=>y.id===x.id)===i).map(x => {
      const explicit = state.installed?.[x.id];
      const installed = !x.securityBlocked && (userIds.has(x.id) || (explicit === undefined ? x.installedByDefault : explicit === true));
      return {...x,installed,enabled:installed&&x.manifestEnabled&&!x.securityBlocked,security:x.security||state.security?.[x.id]||null};
    });
  }

  async isInstalled(id) {
    return Boolean((await this.list()).find(x=>x.id===id)?.installed);
  }

  async installedEntry(id) {
    const item=(await this.list()).find(x=>x.id===id&&x.installed&&x.enabled);
    return item||null;
  }

  async readInstalledText(id, relativePath, maxBytes=8*1024*1024) {
    const item=await this.installedEntry(id);
    if(!item)throw new Error('La extensión no está instalada');
    const rel=this.safeRelativeFile(relativePath);
    const full=path.resolve(item.path,...rel.split('/'));
    const root=path.resolve(item.path)+path.sep;
    if(!full.startsWith(root))throw new Error('Ruta de extensión no permitida');
    const stat=await fsp.stat(full);
    if(!stat.isFile()||stat.size>maxBytes)throw new Error('Recurso de extensión no válido');
    return fsp.readFile(full,'utf8');
  }

  normalizeMarketplace(data, source) {
    if (!data || data.schemaVersion !== 1 || !Array.isArray(data.extensions)) throw new Error('Catálogo de marketplace no válido');
    const seen = new Set();
    const extensions = [];
    for (const raw of data.extensions.slice(0, 2000)) {
      if (!raw || typeof raw.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{1,127}$/i.test(raw.id) || seen.has(raw.id)) continue;
      if (typeof raw.name !== 'string' || typeof raw.version !== 'string') continue;
      seen.add(raw.id);
      extensions.push({
        id:raw.id, name:raw.name.slice(0,120), version:raw.version.slice(0,40),
        description:String(raw.description||'').slice(0,1000), publisher:String(raw.publisher||'AxiomCode').slice(0,100),
        icon:typeof raw.icon==='string'?raw.icon:null, homepage:typeof raw.homepage==='string'?raw.homepage:null,
        tags:Array.isArray(raw.tags)?raw.tags.map(x=>String(x).slice(0,40)).slice(0,20):[],
        featured:Boolean(raw.featured), verified:raw.verified!==false,
        install:raw.install && typeof raw.install==='object' ? raw.install : null
      });
    }
    return {
      schemaVersion:1,
      name:String(data.name||'AxiomCode Marketplace').slice(0,120),
      source,
      fetchedAt:new Date().toISOString(),
      extensions
    };
  }

  async fetchText(url, maxBytes, timeoutMs=12000) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') throw new Error('La marketplace solo acepta HTTPS');
    if (['localhost','127.0.0.1','::1'].includes(parsed.hostname)) throw new Error('Host de marketplace no permitido');
    const response = await fetch(parsed, {signal:AbortSignal.timeout(timeoutMs), headers:{'User-Agent':'AxiomCode-Marketplace/1'}});
    if (!response.ok) throw new Error('HTTP '+response.status+' al descargar '+parsed.hostname);
    const length = Number(response.headers.get('content-length')||0);
    if (length && length > maxBytes) throw new Error('Descarga demasiado grande');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw new Error('Descarga demasiado grande');
    return bytes;
  }

  async readFallbackCatalog() {
    try {
      const data = JSON.parse(await fsp.readFile(this.fallbackCatalogPath,'utf8'));
      return this.normalizeMarketplace(data, 'fallback');
    } catch { return this.normalizeMarketplace({schemaVersion:1,name:'AxiomCode Marketplace',extensions:[]}, 'empty'); }
  }

  async marketplace(force=false) {
    let catalog;
    try {
      const bytes = await this.fetchText(this.marketplaceUrl, MAX_CATALOG_BYTES, 10000);
      catalog = this.normalizeMarketplace(JSON.parse(bytes.toString('utf8')), 'online');
      await fsp.writeFile(this.marketplaceCachePath, JSON.stringify(catalog, null, 2), 'utf8').catch(()=>{});
    } catch (error) {
      try {
        const cached = JSON.parse(await fsp.readFile(this.marketplaceCachePath,'utf8'));
        catalog = this.normalizeMarketplace(cached, 'cache');
        catalog.error = error.message;
      } catch {
        catalog = await this.readFallbackCatalog();
        catalog.error = error.message;
      }
    }

    // Las extensiones oficiales se distribuyen desde el repositorio, nunca
    // desde el Setup. El fallback integrado es la autoridad para su origen
    // de instalación y además garantiza que sigan visibles si la API remota
    // todavía conserva metadata antigua.
    const officialFallback=await this.readFallbackCatalog();
    const merged=new Map(catalog.extensions.map(x=>[x.id,x]));
    for(const fallbackEntry of officialFallback.extensions){
      if(!TRUSTED_OFFICIAL_REPOSITORIES.has(fallbackEntry.id))continue;
      const current=merged.get(fallbackEntry.id);
      if(!current){
        merged.set(fallbackEntry.id,fallbackEntry);
        continue;
      }
      const metadata=this.compareVersions(fallbackEntry.version,current.version)>0
        ? {...current,...fallbackEntry}
        : {...fallbackEntry,...current};
      merged.set(fallbackEntry.id,{...metadata,install:fallbackEntry.install});
    }
    catalog.extensions=[...merged.values()];
    if(catalog.source!=='fallback'&&officialFallback.extensions.length)catalog.source=catalog.source+'+official';

    const installed = await this.list();
    const byId = new Map(installed.filter(x=>x.installed).map(x=>[x.id,x]));
    catalog.extensions = catalog.extensions.map(x => {
      const local = byId.get(x.id);
      return {...x, installed:Boolean(local), installedVersion:local?.version||null,
        updateAvailable:Boolean(local && this.compareVersions(x.version, local.version)>0)};
    });
    return catalog;
  }

  versionParts(v) {
    const [core, pre=''] = String(v||'0').trim().replace(/^v/i,'').split('-',2);
    const nums = core.split('.').slice(0,4).map(x=>Number.parseInt(x,10)||0);
    while(nums.length<4) nums.push(0);
    return {nums,pre};
  }

  compareVersions(a,b) {
    const A=this.versionParts(a), B=this.versionParts(b);
    for(let i=0;i<4;i++) if(A.nums[i]!==B.nums[i]) return A.nums[i]>B.nums[i]?1:-1;
    if(A.pre===B.pre) return 0;
    if(!A.pre) return 1;
    if(!B.pre) return -1;
    return A.pre.localeCompare(B.pre,undefined,{numeric:true,sensitivity:'base'});
  }

  safeRelativeFile(rel) {
    if (typeof rel !== 'string' || !rel || rel.length>240) throw new Error('Ruta de paquete no válida');
    const clean = rel.replace(/\\/g,'/');
    if (clean.startsWith('/') || clean.includes('../') || clean.includes('/..') || clean==='..' || /^[A-Za-z]:/.test(clean)) throw new Error('Ruta de paquete no permitida');
    return clean;
  }

  parseRepositoryInstall(entry) {
    const install=entry?.install;
    if(!install||install.kind!=='repository')throw new Error('La extensión no usa instalación desde repositorio');
    const match=/^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(String(install.repoUrl||''));
    if(!match)throw new Error('Repositorio de extensión no válido');
    const ref=String(install.ref||'main').trim();
    if(!/^[A-Za-z0-9._\/-]{1,120}$/.test(ref)||ref.includes('..'))throw new Error('Referencia de repositorio no válida');
    const subdir=String(install.subdir||'').replace(/\\/g,'/').replace(/^\/+|\/+$/g,'');
    if(!subdir||subdir.split('/').some(x=>!x||x==='.'||x==='..'))throw new Error('Subcarpeta de extensión no válida');
    return {owner:match[1],repo:match[2],ref,subdir};
  }

  isTrustedOfficialRepository(entry,spec) {
    const trusted=TRUSTED_OFFICIAL_REPOSITORIES.get(entry?.id);
    return Boolean(trusted && String(entry?.publisher||'')==='AxiomCode' && spec.owner===trusted.owner && spec.repo===trusted.repo && spec.subdir===trusted.subdir);
  }

  async repositorySnapshot(spec) {
    const base='https://api.github.com/repos/'+encodeURIComponent(spec.owner)+'/'+encodeURIComponent(spec.repo);
    const commitBytes=await this.fetchText(base+'/commits/'+encodeURIComponent(spec.ref),4*1024*1024,30000);
    const commit=JSON.parse(commitBytes.toString('utf8'));
    const commitSha=String(commit?.sha||'');
    const treeSha=String(commit?.commit?.tree?.sha||'');
    if(!/^[0-9a-f]{40}$/i.test(commitSha)||!/^[0-9a-f]{40}$/i.test(treeSha))throw new Error('GitHub no devolvió un commit válido para la extensión');
    const treeBytes=await this.fetchText(base+'/git/trees/'+treeSha+'?recursive=1',MAX_REPOSITORY_TREE_BYTES,60000);
    const tree=JSON.parse(treeBytes.toString('utf8'));
    if(tree?.truncated)throw new Error('El árbol del repositorio es demasiado grande para instalarlo de forma segura');
    if(!Array.isArray(tree?.tree))throw new Error('GitHub no devolvió un árbol de repositorio válido');
    const prefix=spec.subdir+'/';
    if(tree.tree.some(x=>x?.path?.startsWith(prefix)&&x.mode==='120000'))throw new Error('La extensión contiene enlaces simbólicos no permitidos');
    const selected=tree.tree.filter(x=>x?.type==='blob'&&x.path?.startsWith(prefix));
    if(!selected.length)throw new Error('La extensión no existe en la subcarpeta indicada del repositorio');
    if(selected.length>10000)throw new Error('La extensión contiene demasiados archivos');
    let total=0;
    const files=selected.map(item=>{
      const rel=this.safeRelativeFile(item.path.slice(prefix.length));
      const size=Number(item.size||0);
      if(!Number.isSafeInteger(size)||size<0||size>MAX_FILE_BYTES)throw new Error('Archivo demasiado grande o inválido: '+rel);
      total+=size;
      if(total>MAX_EXTENSION_TOTAL_BYTES)throw new Error('La extensión supera el tamaño máximo permitido');
      const encodedPath=item.path.split('/').map(encodeURIComponent).join('/');
      return {rel,size,sha:String(item.sha||''),url:'https://raw.githubusercontent.com/'+encodeURIComponent(spec.owner)+'/'+encodeURIComponent(spec.repo)+'/'+commitSha+'/'+encodedPath};
    });
    return {commitSha,treeSha,total,files};
  }

  async downloadRepositoryExtension(entry) {
    const spec=this.parseRepositoryInstall(entry);
    const trustedOfficial=this.isTrustedOfficialRepository(entry,spec);
    const snapshot=await this.repositorySnapshot(spec);

    await this.ensure();
    const temp=path.join(this.userRoot,'.install-'+crypto.randomBytes(8).toString('hex'));
    const target=path.join(this.userRoot,entry.id);
    const backup=target+'.backup-'+Date.now();
    const securityReports=[];
    let backedUp=false,securityReport=null;
    await fsp.mkdir(temp,{recursive:true});
    try{
      let cursor=0,firstError=null;
      const rootPath=path.resolve(temp)+path.sep;
      const fetchFile=async file=>{
        let lastError=null;
        const maxBytes=Math.min(MAX_FILE_BYTES,Math.max(1024*1024,file.size+64*1024));
        for(let attempt=0;attempt<3;attempt++){
          try{return await this.fetchText(file.url,maxBytes,120000);}
          catch(error){lastError=error;if(attempt<2)await new Promise(r=>setTimeout(r,300*(2**attempt)));}
        }
        throw lastError;
      };
      const worker=async()=>{
        while(!firstError){
          const index=cursor++;
          if(index>=snapshot.files.length)return;
          const file=snapshot.files[index];
          try{
            const content=await fetchFile(file);
            if(content.length!==file.size)throw new Error('Tamaño incorrecto para '+file.rel);
            if(/^[0-9a-f]{40}$/i.test(file.sha)){
              const header=Buffer.from('blob '+content.length+'\0','utf8');
              const actual=crypto.createHash('sha1').update(header).update(content).digest('hex');
              if(actual.toLowerCase()!==file.sha.toLowerCase())throw new Error('Integridad Git incorrecta para '+file.rel);
            }
            if(shouldInspectFile(file.rel))securityReports.push(scanExtensionFiles([{path:file.rel,bytes:content}]));
            const out=path.join(temp,...file.rel.split('/'));
            const resolved=path.resolve(out);
            if(!resolved.startsWith(rootPath))throw new Error('Ruta fuera del paquete');
            await fsp.mkdir(path.dirname(out),{recursive:true});
            await fsp.writeFile(out,content);
          }catch(error){firstError=error;return;}
        }
      };
      const workers=Array.from({length:Math.min(REPOSITORY_DOWNLOAD_CONCURRENCY,snapshot.files.length)},()=>worker());
      await Promise.all(workers);
      if(firstError)throw firstError;

      securityReport=combineSecurityReports(securityReports);
      if(securityReport.verdict==='blocked'&&!trustedOfficial){
        securityReport.quarantineReport=await this.writeQuarantineReport(entry,securityReport,'install');
        assertExtensionSafe(securityReport);
      }
      if(securityReport.verdict==='blocked'&&trustedOfficial){
        securityReport={...securityReport,originalVerdict:'blocked',verdict:'trusted',trustedSource:true,trustReason:'official-repository'};
      }
      const manifest=JSON.parse(await fsp.readFile(path.join(temp,'extension.json'),'utf8'));
      if(manifest.id!==entry.id)throw new Error('El ID del paquete no coincide con la marketplace');
      if(String(manifest.version||'')!==entry.version)throw new Error('La versión del paquete no coincide con la marketplace');
      if(fs.existsSync(target)){await fsp.rename(target,backup);backedUp=true;}
      await fsp.rename(temp,target);
      if(backedUp)await fsp.rm(backup,{recursive:true,force:true});
      const state=await this.readState();
      state.installed||={};state.security||={};state.installed[entry.id]=true;
      state.security[entry.id]={
        engine:securityReport?.engine||'AxiomGuard Static 1.0',
        verdict:securityReport?.verdict||'clean',
        score:securityReport?.score||0,
        scannedAt:new Date().toISOString(),
        version:entry.version,
        sourceCommit:snapshot.commitSha,
        hashes:securityReport?.hashes||{}
      };
      await this.writeState(state);
      return (await this.list()).find(x=>x.id===entry.id);
    }catch(error){
      await fsp.rm(temp,{recursive:true,force:true}).catch(()=>{});
      if(backedUp&&!fs.existsSync(target))await fsp.rename(backup,target).catch(()=>{});
      throw error;
    }
  }

  async downloadMarketplaceExtension(entry) {
    if(entry?.install?.kind==='repository')return this.downloadRepositoryExtension(entry);
    if (!entry.install || entry.install.kind !== 'files' || !Array.isArray(entry.install.files)) throw new Error('La extensión no tiene un paquete instalable');
    const files = entry.install.files;
    if (!files.length) throw new Error('La extensión no contiene archivos instalables');
    await this.ensure();
    const temp = path.join(this.userRoot, '.install-'+crypto.randomBytes(8).toString('hex'));
    const target = path.join(this.userRoot, entry.id);
    const backup = target+'.backup-'+Date.now();
    let total = 0, backedUp = false;
    const securityReports=[];
    let securityReport=null;
    await fsp.mkdir(temp,{recursive:true});
    try {
      for (const spec of files) {
        const rel=this.safeRelativeFile(spec.path);
        if (typeof spec.url!=='string') throw new Error('URL de archivo no válida');
        const bytes=await this.fetchText(spec.url, MAX_FILE_BYTES, 300000);
        total += bytes.length;
        if(spec.sha256) {
          const actual=crypto.createHash('sha256').update(bytes).digest('hex');
          if(actual.toLowerCase()!==String(spec.sha256).toLowerCase()) throw new Error('SHA-256 incorrecto para '+rel);
        }
        if(shouldInspectFile(rel)) securityReports.push(scanExtensionFiles([{path:rel,bytes}]));
        const out=path.join(temp,...rel.split('/'));
        const resolved=path.resolve(out), root=path.resolve(temp)+path.sep;
        if(!resolved.startsWith(root)) throw new Error('Ruta fuera del paquete');
        await fsp.mkdir(path.dirname(out),{recursive:true});
        await fsp.writeFile(out,bytes);
      }
      securityReport=combineSecurityReports(securityReports);
      if(securityReport.verdict==='blocked'){
        securityReport.quarantineReport=await this.writeQuarantineReport(entry,securityReport,'install');
        assertExtensionSafe(securityReport);
      }
      const manifestPath=path.join(temp,'extension.json');
      const manifest=JSON.parse(await fsp.readFile(manifestPath,'utf8'));
      if(manifest.id!==entry.id) throw new Error('El ID del paquete no coincide con la marketplace');
      if(String(manifest.version||'')!==entry.version) throw new Error('La versión del paquete no coincide con la marketplace');
      if(fs.existsSync(target)){await fsp.rename(target,backup);backedUp=true;}
      await fsp.rename(temp,target);
      if(backedUp) await fsp.rm(backup,{recursive:true,force:true});
      const state=await this.readState();state.installed||={};state.security||={};state.installed[entry.id]=true;state.security[entry.id]={engine:securityReport?.engine||'AxiomGuard Static 1.0',verdict:securityReport?.verdict||'clean',score:securityReport?.score||0,scannedAt:new Date().toISOString(),version:entry.version,hashes:securityReport?.hashes||{}};await this.writeState(state);
      return (await this.list()).find(x=>x.id===entry.id);
    } catch(error) {
      await fsp.rm(temp,{recursive:true,force:true}).catch(()=>{});
      if(backedUp && !fs.existsSync(target)) await fsp.rename(backup,target).catch(()=>{});
      throw error;
    }
  }

  async install(id) {
    const local=(await this.entries()).find(x=>x.id===id && x.scope==='catalog');
    if(local){
      const state=await this.readState();state.installed||={};state.installed[id]=true;await this.writeState(state);
      return (await this.list()).find(x=>x.id===id);
    }
    const online=(await this.marketplace(true)).extensions.find(x=>x.id===id);
    if(!online) throw new Error('Extensión no encontrada en AxiomCode Marketplace');
    if(online.install?.kind==='bundled'){
      const bundled=(await this.entries()).find(x=>x.id===(online.install.bundledId||id) && x.scope==='catalog');
      if(!bundled) throw new Error('El componente incluido no está disponible en esta versión de AxiomCode');
      const state=await this.readState();state.installed||={};state.installed[id]=true;await this.writeState(state);
      return (await this.list()).find(x=>x.id===id);
    }
    return this.downloadMarketplaceExtension(online);
  }

  async update(id) {
    const online=(await this.marketplace(true)).extensions.find(x=>x.id===id);
    if(!online) throw new Error('La extensión ya no existe en la marketplace');
    const local=(await this.list()).find(x=>x.id===id && x.installed);
    if(!local) return this.install(id);
    if(this.compareVersions(online.version,local.version)<=0) return {...local,upToDate:true};
    if(online.install?.kind==='bundled') return {...local,requiresAppUpdate:true,availableVersion:online.version};
    return this.downloadMarketplaceExtension(online);
  }

  async uninstall(id) {
    const entries=await this.entries();
    const user=entries.find(x=>x.id===id && x.scope==='user');
    if(user) await fsp.rm(user.path,{recursive:true,force:true});
    const known=entries.some(x=>x.id===id) || (await this.marketplace()).extensions.some(x=>x.id===id);
    if(!known) throw new Error('Extensión no encontrada');
    const state=await this.readState();state.installed||={};state.installed[id]=false;await this.writeState(state);
    return {id,installed:false};
  }

  async openFolder(shell) { await this.ensure(); shell.openPath(this.userRoot); return this.userRoot; }
}

module.exports = { AxiomExtensionService, DEFAULT_MARKETPLACE_URL };
