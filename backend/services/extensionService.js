const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const DEFAULT_MARKETPLACE_URL = 'https://axiomcode-marketplace.onrender.com/api/catalog';
const MAX_CATALOG_BYTES = Number.POSITIVE_INFINITY;
const MAX_FILE_BYTES = 100 * 1024 * 1024;

class AxiomExtensionService {
  constructor(app, appRoot) {
    this.appRoot = appRoot;
    this.catalogRoot = path.join(appRoot, 'extensions');
    this.userRoot = path.join(app.getPath('userData'), 'extensions');
    this.statePath = path.join(app.getPath('userData'), 'extension-state.json');
    this.marketplaceCachePath = path.join(app.getPath('userData'), 'marketplace-cache.json');
    this.fallbackCatalogPath = path.join(appRoot, 'marketplace', 'fallback.json');
    this.marketplaceUrl = process.env.AXIOM_MARKETPLACE_URL || DEFAULT_MARKETPLACE_URL;
  }

  async ensure() { await fsp.mkdir(this.userRoot, {recursive:true}); }

  async readState() {
    try { return JSON.parse(await fsp.readFile(this.statePath, 'utf8')); }
    catch { return {installed:{}}; }
  }

  async writeState(state) {
    await this.ensure();
    await fsp.writeFile(this.statePath, JSON.stringify(state, null, 2), 'utf8');
  }

  async scanRoot(root, scope) {
    if (!fs.existsSync(root)) return [];
    const entries = await fsp.readdir(root, {withFileTypes:true});
    const result = [];
    for (const entry of entries.filter(e => e.isDirectory() && !e.name.startsWith('.'))) {
      const dir = path.join(root, entry.name);
      try {
        const manifest = JSON.parse(await fsp.readFile(path.join(dir, 'extension.json'), 'utf8'));
        result.push({
          scope, path:dir, folder:entry.name, id:manifest.id||entry.name, name:manifest.name||entry.name,
          version:manifest.version||'0.0.0', description:manifest.description||'', manifestEnabled:manifest.enabled!==false,
          installedByDefault:manifest.installedByDefault!==false, contributes:manifest.contributes||{},
          publisher:manifest.publisher||'Local'
        });
      } catch {}
    }
    return result;
  }

  async entries() {
    await this.ensure();
    return [...await this.scanRoot(this.catalogRoot,'catalog'), ...await this.scanRoot(this.userRoot,'user')];
  }

  async list() {
    const state = await this.readState(), entries = await this.entries();
    const userIds = new Set(entries.filter(x=>x.scope==='user').map(x=>x.id));
    return entries.filter((x,i,a)=>a.findIndex(y=>y.id===x.id)===i).map(x => {
      const explicit = state.installed?.[x.id];
      const installed = userIds.has(x.id) || (explicit === undefined ? x.installedByDefault : explicit === true);
      return {...x,installed,enabled:installed&&x.manifestEnabled};
    });
  }

  async isInstalled(id) {
    return Boolean((await this.list()).find(x=>x.id===id)?.installed);
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

  async downloadMarketplaceExtension(entry) {
    if (!entry.install || entry.install.kind !== 'files' || !Array.isArray(entry.install.files)) throw new Error('La extensión no tiene un paquete instalable');
    const files = entry.install.files;
    if (!files.length) throw new Error('La extensión no contiene archivos instalables');
    await this.ensure();
    const temp = path.join(this.userRoot, '.install-'+crypto.randomBytes(8).toString('hex'));
    const target = path.join(this.userRoot, entry.id);
    const backup = target+'.backup-'+Date.now();
    let total = 0, backedUp = false;
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
        const out=path.join(temp,...rel.split('/'));
        const resolved=path.resolve(out), root=path.resolve(temp)+path.sep;
        if(!resolved.startsWith(root)) throw new Error('Ruta fuera del paquete');
        await fsp.mkdir(path.dirname(out),{recursive:true});
        await fsp.writeFile(out,bytes);
      }
      const manifestPath=path.join(temp,'extension.json');
      const manifest=JSON.parse(await fsp.readFile(manifestPath,'utf8'));
      if(manifest.id!==entry.id) throw new Error('El ID del paquete no coincide con la marketplace');
      if(String(manifest.version||'')!==entry.version) throw new Error('La versión del paquete no coincide con la marketplace');
      if(fs.existsSync(target)){await fsp.rename(target,backup);backedUp=true;}
      await fsp.rename(temp,target);
      if(backedUp) await fsp.rm(backup,{recursive:true,force:true});
      const state=await this.readState();state.installed||={};state.installed[entry.id]=true;await this.writeState(state);
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
