const http=require('http');
const fs=require('fs');
const fsp=fs.promises;
const path=require('path');
const crypto=require('crypto');
const os=require('os');
const {Readable,Transform}=require('stream');
const {pipeline}=require('stream/promises');
const {URL}=require('url');
const {scanExtensionFiles,combineSecurityReports,assertExtensionSafe,shouldInspectFile}=require('../backend/services/extensionSecurity');
const vscodeGallery=require('./vscodeGallery');

// Temporary build-time validation for the new local IntelliCode integration.
// It parses desktop sources without executing Electron code and exercises the
// prediction engine. Removed after Render confirms this revision boots cleanly.
(function validateAxiomIntelliCodeBuild(){
  const vm=require('vm');
  for(const rel of ['../src/renderer.js','../backend/services/extensionService.js','../main.js','../preload.js']){
    const file=path.resolve(__dirname,rel);
    new vm.Script(fs.readFileSync(file,'utf8'),{filename:file});
  }
  const runtime=require('../extensions/intellicode/runtime.js');
  if(typeof runtime.LocalIntelliEngine!=='function')throw new Error('Axiom IntelliCode runtime inválido');
  const engine=new runtime.LocalIntelliEngine();
  engine.learnText('alpha beta gamma alpha beta gamma alpha beta delta','javascript');
  const best=engine.suggestTokens(['alpha','beta'],'g',1)[0];
  if(!best||best.value!=='gamma')throw new Error('Axiom IntelliCode self-test falló');
})();

const PORT=Number(process.env.PORT||3000);
const GITHUB_OWNER=process.env.GITHUB_OWNER||'Tylerpro09';
const GITHUB_REPO=process.env.GITHUB_REPO||'AxiomCode';
const GITHUB_TOKEN=process.env.GITHUB_TOKEN||'';
const SUPABASE_URL=String(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SUPABASE_SECRET_KEY=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const SUPABASE_PUBLISHABLE_KEY=process.env.SUPABASE_PUBLISHABLE_KEY||'';
const SUPABASE_JWKS_URL=process.env.SUPABASE_JWKS_URL||'';
const SITE_ORIGIN=process.env.SITE_ORIGIN||'*';
const WEB_ROOT=path.resolve(__dirname,'../marketplace');
const MAX_BODY=64*1024;
const VIRUSTOTAL_API_KEY=String(process.env.VIRUSTOTAL_API_KEY||'').trim();
const VIRUSTOTAL_REQUIRED=/^(1|true|yes)$/i.test(String(process.env.VIRUSTOTAL_REQUIRED||'false'));
const VIRUSTOTAL_MALICIOUS_THRESHOLD=Math.max(1,Number(process.env.VIRUSTOTAL_MALICIOUS_THRESHOLD||2)||2);
const VIRUSTOTAL_SUSPICIOUS_THRESHOLD=Math.max(1,Number(process.env.VIRUSTOTAL_SUSPICIOUS_THRESHOLD||4)||4);
const VIRUSTOTAL_MAX_UPLOAD_BYTES=650*1024*1024;
const VIRUSTOTAL_SMALL_UPLOAD_BYTES=32*1024*1024;
const rate=new Map();
const virusTotalCache=new Map();
let scratchReleaseCache={expires:0,value:null};

function json(res,status,data,extra={}){
  res.writeHead(status,{
    'Content-Type':'application/json; charset=utf-8',
    'Access-Control-Allow-Origin':SITE_ORIGIN,
    'Access-Control-Allow-Headers':'Content-Type, Accept, X-Market-Client-Id, X-Market-User-Id, VSCode-SessionId, X-Market-Search-Activity-Id, Activityid, X-Vss-E2eid',
    'Access-Control-Expose-Headers':'Activityid, X-Vss-E2eid, X-Market-Search-Activity-Id, Server',
    'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
    'Cache-Control':'no-store',
    ...extra
  });
  res.end(JSON.stringify(data));
}
function cors(res){
  res.writeHead(204,{
    'Access-Control-Allow-Origin':SITE_ORIGIN,
    'Access-Control-Allow-Headers':'Content-Type, Accept, X-Market-Client-Id, X-Market-User-Id, VSCode-SessionId, X-Market-Search-Activity-Id, Activityid, X-Vss-E2eid',
    'Access-Control-Expose-Headers':'Activityid, X-Vss-E2eid, X-Market-Search-Activity-Id, Server',
    'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
    'Access-Control-Max-Age':'86400'
  });
  res.end();
}
function parseRepoUrl(value){
  const u=new URL(String(value||'').trim());
  if(u.protocol!=='https:'||u.hostname!=='github.com')throw Error('Usa una URL https://github.com/usuario/repo');
  const parts=u.pathname.replace(/^\/|\/$/g,'').split('/');
  if(parts.length<2)throw Error('Falta usuario o repositorio');
  const owner=parts[0],repo=parts[1].replace(/\.git$/i,'');
  if(!/^[A-Za-z0-9_.-]+$/.test(owner)||!/^[A-Za-z0-9_.-]+$/.test(repo))throw Error('Repositorio no válido');
  return {owner,repo,url:`https://github.com/${owner}/${repo}`};
}
function validateManifest(m){
  if(!m||typeof m!=='object')throw Error('extension.json no válido');
  if(!m.id||!m.name||!m.version)throw Error('extension.json requiere id, name y version');
  if(!/^[a-z0-9][a-z0-9._-]{1,127}$/i.test(String(m.id)))throw Error('ID de extensión no válido');
  if(String(m.name).length>120)throw Error('Nombre demasiado largo');
  if(String(m.version).length>40)throw Error('Versión demasiado larga');
  return {
    id:String(m.id),
    name:String(m.name),
    version:String(m.version),
    description:String(m.description||'').slice(0,1000),
    publisher:String(m.publisher||'').slice(0,100),
    keywords:Array.isArray(m.keywords)?m.keywords.map(String).slice(0,20):[],
    icon:typeof m.icon==='string'?m.icon:null
  };
}
function versionParts(v){
  const [core,pre='']=String(v||'0').replace(/^v/i,'').split('-',2);
  const nums=core.split('.').slice(0,4).map(x=>parseInt(x,10)||0);
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
async function gh(pathname,options={}){
  const headers={
    'Accept':'application/vnd.github+json',
    'X-GitHub-Api-Version':'2022-11-28',
    'User-Agent':'AxiomCode-Marketplace-Render/2'
  };
  if(GITHUB_TOKEN)headers.Authorization='Bearer '+GITHUB_TOKEN;
  const r=await fetch('https://api.github.com'+pathname,{...options,headers:{...headers,...options.headers}});
  const text=await r.text();
  let body=null;try{body=text?JSON.parse(text):null}catch{body=text}
  if(!r.ok)throw Error('GitHub HTTP '+r.status+': '+(body?.message||String(body||'error')));
  return body;
}
async function readRepoFile(owner,repo,filePath,ref){
  const data=await gh(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${filePath.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`);
  if(Array.isArray(data)||!data.content)throw Error(filePath+' no es un archivo');
  return Buffer.from(data.content,'base64');
}
async function tryReadRepoFile(owner,repo,filePath,ref){try{return await readRepoFile(owner,repo,filePath,ref)}catch(error){if(/GitHub HTTP 404/.test(error.message))return null;throw error}}
function validateVsCodeManifest(m){
  if(!m||typeof m!=='object')throw Error('package.json no válido');
  if(!m.name||!m.publisher||!m.version||!m.engines?.vscode)throw Error('package.json requiere name, publisher, version y engines.vscode');
  if(!/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(String(m.name)))throw Error('name de extensión no válido');
  if(!/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(String(m.publisher)))throw Error('publisher no válido');
  const id=String(m.publisher)+'.'+String(m.name);
  return {id,name:String(m.displayName||m.name).slice(0,120),version:String(m.version).slice(0,40),description:String(m.description||'').slice(0,1000),publisher:String(m.publisher).slice(0,100),keywords:[...(Array.isArray(m.keywords)?m.keywords:[]),...(Array.isArray(m.categories)?m.categories:[])].map(String).slice(0,30),icon:typeof m.icon==='string'?m.icon:null,raw:m};
}
async function fetchRawBytes(url,maxBytes=100*1024*1024){
  const r=await fetch(url,{headers:{'User-Agent':'AxiomCode-AxiomGuard/1'},signal:AbortSignal.timeout(60000)});
  if(!r.ok)throw Error('No se pudo descargar archivo para análisis: HTTP '+r.status);
  const len=Number(r.headers.get('content-length')||0);
  if(len&&len>maxBytes)throw Error('Archivo demasiado grande para análisis');
  const bytes=Buffer.from(await r.arrayBuffer());
  if(bytes.length>maxBytes)throw Error('Archivo demasiado grande para análisis');
  return bytes;
}
async function virusTotalCheck(report){
  if(!VIRUSTOTAL_API_KEY){
    if(VIRUSTOTAL_REQUIRED)throw Error('VirusTotal es obligatorio pero VIRUSTOTAL_API_KEY no está configurada');
    return {enabled:false,checked:0,detections:[]};
  }
  const detections=[]; let checked=0;
  const hashes=Object.entries(report?.hashes||{}).slice(0,4);
  for(const [file,hash] of hashes){
    const cached=virusTotalCache.get(hash);
    if(cached&&cached.expires>Date.now()){
      checked++;
      if(cached.malicious>=VIRUSTOTAL_MALICIOUS_THRESHOLD||cached.suspicious>=VIRUSTOTAL_SUSPICIOUS_THRESHOLD)detections.push({file,hash,malicious:cached.malicious,suspicious:cached.suspicious});
      continue;
    }
    const r=await fetch('https://www.virustotal.com/api/v3/files/'+encodeURIComponent(hash),{
      headers:{'x-apikey':VIRUSTOTAL_API_KEY,'Accept':'application/json'},
      signal:AbortSignal.timeout(15000)
    });
    if(r.status===404){virusTotalCache.set(hash,{expires:Date.now()+60*60*1000,malicious:0,suspicious:0,unknown:true});checked++;continue;}
    if(!r.ok){
      if(VIRUSTOTAL_REQUIRED)throw Error('VirusTotal HTTP '+r.status);
      break;
    }
    const body=await r.json();
    const stats=body?.data?.attributes?.last_analysis_stats||{};
    const malicious=Number(stats.malicious||0),suspicious=Number(stats.suspicious||0);
    virusTotalCache.set(hash,{expires:Date.now()+60*60*1000,malicious,suspicious});
    checked++;
    if(malicious>=VIRUSTOTAL_MALICIOUS_THRESHOLD||suspicious>=VIRUSTOTAL_SUSPICIOUS_THRESHOLD){
      detections.push({file,hash,malicious,suspicious});
    }
  }
  return {enabled:true,checked,detections};
}
async function scanRepositorySecurity(parsed,commitSha,files){
  const reports=[];
  const rawUrl=p=>'https://raw.githubusercontent.com/'+parsed.owner+'/'+parsed.repo+'/'+commitSha+'/'+p.split('/').map(encodeURIComponent).join('/');
  for(const f of files){
    if(!shouldInspectFile(f.path))continue;
    const bytes=await fetchRawBytes(rawUrl(f.path));
    reports.push(scanExtensionFiles([{path:f.path,bytes}]));
  }
  const report=combineSecurityReports(reports);
  report.virusTotal=await virusTotalCheck(report);
  if(report.virusTotal.detections.length){
    for(const hit of report.virusTotal.detections){
      report.findings.push({file:hit.file,rule:'virustotal-detection',severity:'critical',score:20,message:'VirusTotal detectó este archivo como malicioso o sospechoso'});
      report.score+=20;
    }
    report.verdict='blocked';
  }
  assertExtensionSafe(report);
  return report;
}

async function latestBundledScratch(){
  const now=Date.now();
  if(scratchReleaseCache.value && scratchReleaseCache.expires>now) return scratchReleaseCache.value;
  try{
    const release=await gh(`/repos/${encodeURIComponent(GITHUB_OWNER)}/${encodeURIComponent(GITHUB_REPO)}/releases/latest`);
    const tag=release.tag_name;
    if(!tag) throw Error('Release sin tag');
    const bytes=await readRepoFile(GITHUB_OWNER,GITHUB_REPO,'extensions/scratch-mode/extension.json',tag);
    const manifest=validateManifest(JSON.parse(bytes.toString('utf8')));
    const value={version:manifest.version,description:manifest.description,publisher:manifest.publisher||'AxiomCode',tag};
    scratchReleaseCache={expires:now+10*60*1000,value};
    return value;
  }catch(error){
    console.warn('scratch release metadata failed:',error.message);
    scratchReleaseCache={expires:now+60*1000,value:null};
    return null;
  }
}

async function inspectRepository(repoUrl,{includeFiles=false}={}){
  const parsed=parseRepoUrl(repoUrl);
  const repo=await gh('/repos/'+encodeURIComponent(parsed.owner)+'/'+encodeURIComponent(parsed.repo));
  if(repo.private)throw Error('El repositorio debe ser público');
  const branch=repo.default_branch;

  let format='legacy',manifest=null,vscodeManifest=null;
  const packageBytes=await tryReadRepoFile(parsed.owner,parsed.repo,'package.json',branch);
  if(packageBytes){
    try{
      const pkg=JSON.parse(packageBytes.toString('utf8'));
      if(pkg?.engines?.vscode&&pkg?.name&&pkg?.publisher&&pkg?.version){
        const validated=validateVsCodeManifest(pkg);
        format='vscode';
        manifest=validated;
        vscodeManifest=validated.raw;
      }
    }catch(error){
      if(!/package.json requiere/.test(error.message)&&!/no válido/.test(error.message))throw Error('package.json contiene JSON inválido');
    }
  }
  if(!manifest){
    const manifestBytes=await readRepoFile(parsed.owner,parsed.repo,'extension.json',branch);
    let raw;try{raw=JSON.parse(manifestBytes.toString('utf8'))}catch{throw Error('extension.json contiene JSON inválido')}
    manifest=validateManifest(raw);
  }

  const commit=await gh('/repos/'+encodeURIComponent(parsed.owner)+'/'+encodeURIComponent(parsed.repo)+'/commits/'+encodeURIComponent(branch));
  const result={
    repoUrl:parsed.url,owner:parsed.owner,repo:parsed.repo,branch,commitSha:commit.sha,format,
    manifest:{...manifest,publisher:manifest.publisher||parsed.owner}
  };
  if(vscodeManifest)result.vscodeManifest=vscodeManifest;
  if(!includeFiles)return result;

  const treeSha=commit.commit?.tree?.sha;
  if(!treeSha)throw Error('No se pudo resolver el árbol del repositorio');
  const tree=await gh('/repos/'+encodeURIComponent(parsed.owner)+'/'+encodeURIComponent(parsed.repo)+'/git/trees/'+encodeURIComponent(treeSha)+'?recursive=1');
  if(tree.truncated)throw Error('GitHub API devolvió el árbol del repositorio truncado; no se puede publicar un paquete incompleto');
  const files=(tree.tree||[]).filter(x=>x.type==='blob'&&x.path&&!x.path.startsWith('.github/')&&!x.path.startsWith('node_modules/')&&x.path!=='.gitignore');
  const required=format==='vscode'?'package.json':'extension.json';
  if(!files.some(x=>x.path===required))throw Error(required+' debe estar en la raíz');

  let total=0;
  for(const f of files){
    const size=Number(f.size||0);
    if(size>100*1024*1024)throw Error('GitHub no permite objetos Git normales mayores de 100 MiB: '+f.path);
    total+=size;
  }

  const rawUrl=x=>'https://raw.githubusercontent.com/'+parsed.owner+'/'+parsed.repo+'/'+commit.sha+'/'+x.split('/').map(encodeURIComponent).join('/');
  result.security=await scanRepositorySecurity(parsed,commit.sha,files);
  result.files=files.map(f=>({path:f.path,url:rawUrl(f.path),size:Number(f.size||0)}));
  result.icon=manifest.icon&&files.some(f=>f.path===manifest.icon)?rawUrl(manifest.icon):null;
  result.totalBytes=total;

  if(format==='vscode'){
    const byLower=new Map(files.map(f=>[String(f.path).toLowerCase(),f.path]));
    const findOne=(...names)=>{for(const n of names){const hit=byLower.get(n.toLowerCase());if(hit)return hit}return null};
    const readmePath=findOne('README.md','README.txt','README');
    const changelogPath=findOne('CHANGELOG.md','CHANGELOG.txt','CHANGELOG');
    const licensePath=findOne('LICENSE','LICENSE.md','LICENSE.txt');
    result.vscode={
      manifest:vscodeManifest,
      engine:String(vscodeManifest.engines?.vscode||''),
      web:Boolean(vscodeManifest.browser),
      iconPath:manifest.icon||null,
      iconUrl:result.icon,
      readmePath,
      readmeUrl:readmePath?rawUrl(readmePath):null,
      changelogPath,
      changelogUrl:changelogPath?rawUrl(changelogPath):null,
      licensePath,
      licenseUrl:licensePath?rawUrl(licensePath):null
    };
  }
  return result;
}
function supabaseConfig(){return {url:SUPABASE_URL,secretConfigured:Boolean(SUPABASE_SECRET_KEY),publishableConfigured:Boolean(SUPABASE_PUBLISHABLE_KEY),jwksUrl:SUPABASE_JWKS_URL||null};}
function requireSupabase(){
  if(!SUPABASE_URL||!SUPABASE_SECRET_KEY)throw Error('Supabase no está configurado en Render');
}
async function sb(endpoint,options={}){
  requireSupabase();
  const headers={
    apikey:SUPABASE_SECRET_KEY,
    Accept:'application/json',
    ...options.headers
  };
  if(options.body)headers['Content-Type']='application/json';
  const r=await fetch(SUPABASE_URL+'/rest/v1/'+endpoint,{...options,headers});
  const text=await r.text();
  let body=null;try{body=text?JSON.parse(text):null}catch{body=text}
  if(!r.ok)throw Error('Supabase HTTP '+r.status+': '+(body?.message||body?.hint||String(body||'error')));
  return body;
}
function rowToExtension(row){
  return {
    id:row.id,name:row.name,version:row.version,description:row.description||'',
    publisher:row.publisher||'Comunidad',verified:Boolean(row.verified),featured:Boolean(row.featured),
    tags:Array.isArray(row.tags)?row.tags:[],homepage:row.homepage||row.source_repo||null,
    sourceRepo:row.source_repo||null,sourceCommit:row.source_commit||null,icon:row.icon||null,
    downloads:Number(row.downloads||0),publishedAt:row.published_at||null,updatedAt:row.updated_at||null,
    install:row.install
  };
}
function catalogFromRows(rows){
  return {
    schemaVersion:1,
    name:'AxiomCode Marketplace',
    generatedAt:new Date().toISOString(),
    extensions:(rows||[]).map(rowToExtension)
  };
}
async function readFallbackCatalog(){
  try{
    const raw=JSON.parse(await fsp.readFile(path.join(WEB_ROOT,'fallback.json'),'utf8'));
    if(raw&&Array.isArray(raw.extensions))return raw;
  }catch(error){console.warn('fallback catalog failed:',error.message)}
  return {schemaVersion:1,name:'AxiomCode Marketplace',generatedAt:new Date().toISOString(),extensions:[]};
}
function bundledScratchExtension(ext,scratch){
  const version=String(scratch?.version||ext.version||'2.4.1');
  const description=scratch?.description||ext.description||'Scratch Power para AxiomCode.';
  const publisher=scratch?.publisher||ext.publisher||'AxiomCode';
  return {...ext,version,description,publisher,
    sourceRepo:'https://github.com/Tylerpro09/AxiomCode',
    install:{
      kind:'repository',
      repoUrl:'https://github.com/Tylerpro09/AxiomCode',
      ref:'main',
      subdir:'extensions/scratch-mode'
    }
  };
}
async function readCatalog(){
  const fallback=await readFallbackCatalog();
  const scratch=await latestBundledScratch();
  const bundled=(fallback.extensions||[]).map(ext=>ext.id==='axiom.scratch-mode'?bundledScratchExtension(ext,scratch):ext);
  if(!SUPABASE_URL||!SUPABASE_SECRET_KEY)return {...fallback,extensions:bundled};
  try{
    const rows=await sb('marketplace_extensions?select=*&status=eq.published&order=featured.desc,name.asc',{method:'GET'});
    const normalized=(rows||[]).map(row=>row.id==='axiom.scratch-mode'?bundledScratchExtension(row,scratch):row);
    const merged=new Map(bundled.map(ext=>[ext.id,ext]));
    for(const ext of catalogFromRows(normalized).extensions)merged.set(ext.id,{...(merged.get(ext.id)||{}),...ext});
    return {schemaVersion:1,name:'AxiomCode Marketplace',generatedAt:new Date().toISOString(),extensions:[...merged.values()]};
  }catch(error){
    console.warn('Supabase catalog failed, using fallback:',error.message);
    return {...fallback,extensions:bundled};
  }
}
async function findExtension(id){
  const rows=await sb('marketplace_extensions?select=*&id=eq.'+encodeURIComponent(id)+'&limit=1',{method:'GET'});
  return rows?.[0]||null;
}
async function recordPublication(entry,inspected,ipHash,status='published'){
  try{
    await sb('marketplace_publications',{
      method:'POST',
      headers:{Prefer:'return=minimal'},
      body:JSON.stringify({
        extension_id:entry.id,repo_url:inspected.repoUrl,version:entry.version,
        commit_sha:inspected.commitSha,ip_hash:ipHash,status
      })
    });
  }catch(error){console.warn('publication log failed:',error.message)}
}
async function publishRepository(repoUrl,ipHash=''){
  const inspected=await inspectRepository(repoUrl,{includeFiles:true});
  const existing=await findExtension(inspected.manifest.id);

  if(existing?.reserved)throw Error('Ese ID está reservado por AxiomCode');
  if(existing?.source_repo&&String(existing.source_repo).toLowerCase()!==inspected.repoUrl.toLowerCase())throw Error('Ese ID ya pertenece a otro repositorio');
  if(existing&&compareVersions(inspected.manifest.version,existing.version)<=0)throw Error('Publica una versión mayor que '+existing.version);

  const entry={
    id:inspected.manifest.id,
    name:inspected.manifest.name,
    version:inspected.manifest.version,
    description:inspected.manifest.description,
    publisher:inspected.manifest.publisher,
    verified:false,featured:false,reserved:false,status:'published',
    tags:inspected.manifest.keywords,
    homepage:inspected.repoUrl,
    source_repo:inspected.repoUrl,
    source_commit:inspected.commitSha,
    icon:inspected.icon,
    install:inspected.format==='vscode'
      ? {kind:'vscode-files',files:inspected.files,vscode:inspected.vscode,security:{engine:inspected.security.engine,verdict:inspected.security.verdict,score:inspected.security.score,scannedAt:new Date().toISOString(),virusTotal:inspected.security.virusTotal}}
      : {kind:'files',files:inspected.files,security:{engine:inspected.security.engine,verdict:inspected.security.verdict,score:inspected.security.score,scannedAt:new Date().toISOString(),virusTotal:inspected.security.virusTotal}},
    updated_at:new Date().toISOString(),
    published_at:new Date().toISOString()
  };
  const rows=await sb('marketplace_extensions?on_conflict=id',{
    method:'POST',
    headers:{Prefer:'resolution=merge-duplicates,return=representation'},
    body:JSON.stringify(entry)
  });
  const published=rowToExtension(rows?.[0]||entry);
  await recordPublication(published,inspected,ipHash);
  return published;
}
async function resolveReleaseCommit(tag){
  try{
    const c=await gh(`/repos/${encodeURIComponent(GITHUB_OWNER)}/${encodeURIComponent(GITHUB_REPO)}/commits/${encodeURIComponent(tag)}`);
    return c?.sha||null;
  }catch{return null}
}
async function latestEditorRelease(){
  try{
    const release=await gh(`/repos/${encodeURIComponent(GITHUB_OWNER)}/${encodeURIComponent(GITHUB_REPO)}/releases/latest`);
    const tag=release.tag_name||release.name||'latest';
    return {
      available:true,
      tag,
      name:release.name||release.tag_name||'AxiomCode',
      publishedAt:release.published_at||null,
      url:release.html_url||null,
      notes:String(release.body||'').slice(0,5000),
      commitSha:await resolveReleaseCommit(tag),
      targetCommitish:release.target_commitish||null,
      assets:(release.assets||[]).map(a=>({
        name:a.name,size:a.size,downloads:a.download_count,url:a.browser_download_url,
        contentType:a.content_type,digest:a.digest||null
      }))
    };
  }catch(error){
    if(/GitHub HTTP 404/.test(error.message))return {available:false,assets:[]};
    throw error;
  }
}
function releaseVersion(tag){
  const value=String(tag||'').trim().replace(/^v/i,'');
  const m=value.match(/^(\d+)\.(\d+)\.(\d+)/);
  return m?{raw:value,major:Number(m[1]),minor:Number(m[2]),patch:Number(m[3])}:null;
}
function selectEditorUpdateAsset(release,platform){
  const assets=Array.isArray(release?.assets)?release.assets:[];
  const p=String(platform||'').toLowerCase();
  if(p.startsWith('win32-')){
    if(p.endsWith('-archive'))return assets.find(a=>/\.zip$/i.test(a.name||'')&&/win|windows/i.test(a.name||''))||null;
    if(p.includes('-user')){
      return assets.find(a=>/\.exe$/i.test(a.name||'')&&/user.?setup|setup/i.test(a.name||''))
        ||assets.find(a=>/\.exe$/i.test(a.name||''))||null;
    }
    return assets.find(a=>/\.exe$/i.test(a.name||'')&&/setup/i.test(a.name||''))
      ||assets.find(a=>/\.exe$/i.test(a.name||''))||null;
  }
  if(p.startsWith('darwin-'))return assets.find(a=>/\.(zip|dmg)$/i.test(a.name||'')&&/darwin|mac|osx/i.test(a.name||''))||null;
  if(p.startsWith('linux-'))return assets.find(a=>/\.(tar\.gz|deb|rpm|appimage)$/i.test(a.name||''))||null;
  return null;
}
async function editorUpdateFeed(platform,quality,currentCommit){
  if(String(quality||'').toLowerCase()!=='stable')return null;
  const release=await latestEditorRelease();
  if(!release?.available)return null;
  const ver=releaseVersion(release.tag);
  // v0.x belongs to the legacy Electron editor and must never be installed
  // over the Code - OSS based AxiomCode line.
  if(!ver||ver.major<2)return null;
  if(release.commitSha&&String(release.commitSha).toLowerCase()===String(currentCommit||'').toLowerCase())return null;
  const asset=selectEditorUpdateAsset(release,platform);
  if(!asset?.url)return null;
  const digest=String(asset.digest||'');
  const sha256hash=/^sha256:[0-9a-f]{64}$/i.test(digest)?digest.slice(7):undefined;
  return {
    url:asset.url,
    version:release.commitSha||String(release.tag||'').replace(/^v/i,''),
    productVersion:ver.raw,
    timestamp:release.publishedAt?Date.parse(release.publishedAt):Date.now(),
    ...(sha256hash?{sha256hash}:{})
  };
}

function clientIp(req){return String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'unknown').split(',')[0].trim()}
function ipHash(req){return crypto.createHash('sha256').update(clientIp(req)+'|axiom-market').digest('hex')}
function enforceRate(req){
  const ip=clientIp(req),now=Date.now(),windowMs=60*60*1000;
  const current=(rate.get(ip)||[]).filter(t=>now-t<windowMs);
  if(current.length>=5)throw Error('Límite de 5 publicaciones por hora');
  current.push(now);rate.set(ip,current);
}
async function bodyJson(req){
  let size=0,chunks=[];
  for await(const c of req){size+=c.length;if(size>MAX_BODY)throw Error('Solicitud demasiado grande');chunks.push(c)}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}catch{throw Error('JSON inválido')}
}
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
async function serveStatic(req,res,u){
  let rel=decodeURIComponent(u.pathname);
  if(rel==='/'||rel==='')rel='/index.html';
  const normalized=path.posix.normalize(rel).replace(/^\/+/, '');
  if(normalized.startsWith('..'))return false;
  const file=path.resolve(WEB_ROOT,normalized);
  if(!file.startsWith(WEB_ROOT+path.sep))return false;
  const stat=await fsp.stat(file).catch(()=>null);
  if(!stat?.isFile())return false;
  res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':normalized==='index.html'?'no-cache':'public, max-age=300'});
  fs.createReadStream(file).pipe(res);
  return true;
}
function publicBase(req){
  const proto=String(req.headers['x-forwarded-proto']||'http').split(',')[0].trim();
  const host=String(req.headers['x-forwarded-host']||req.headers.host||'localhost').split(',')[0].trim();
  return proto+'://'+host;
}
async function galleryCatalogEntry(id,version){
  const catalog=await readCatalog();
  const entry=(catalog.extensions||[]).find(x=>String(x.id).toLowerCase()===String(id).toLowerCase());
  if(!entry)return null;
  if(version&&String(entry.version)!==String(version))return null;
  return entry;
}
function redirect(res,url){
  res.writeHead(302,{'Location':url,'Cache-Control':'public, max-age=300','Access-Control-Allow-Origin':SITE_ORIGIN});
  res.end();
}
async function serveGalleryAsset(req,res,u,match){
  const id=decodeURIComponent(match[1]),version=decodeURIComponent(match[2]),assetType=decodeURIComponent(match[3]);
  const entry=await galleryCatalogEntry(id,version);
  if(!entry||!vscodeGallery.native(entry))return json(res,404,{error:'Extensión o versión no encontrada'});
  const v=entry.install.vscode||{};
  if(assetType===vscodeGallery.ASSET.manifest){
    return json(res,200,v.manifest||{});
  }
  if(assetType===vscodeGallery.ASSET.vsix){
    res.writeHead(200,{
      'Content-Type':'application/vsix',
      'Content-Disposition':'attachment; filename="'+String(id).replace(/[^A-Za-z0-9._-]/g,'_')+'-'+String(version).replace(/[^A-Za-z0-9._-]/g,'_')+'.vsix"',
      'Cache-Control':'public, max-age=300',
      'Access-Control-Allow-Origin':SITE_ORIGIN
    });
    await vscodeGallery.streamVsix(entry,res);
    return;
  }
  if(assetType===vscodeGallery.ASSET.icon&&v.iconUrl)return redirect(res,v.iconUrl);
  if(assetType===vscodeGallery.ASSET.details&&v.readmeUrl)return redirect(res,v.readmeUrl);
  if(assetType===vscodeGallery.ASSET.changelog&&v.changelogUrl)return redirect(res,v.changelogUrl);
  if(assetType===vscodeGallery.ASSET.license&&v.licenseUrl)return redirect(res,v.licenseUrl);
  return json(res,404,{error:'Asset no disponible'});
}

async function handler(req,res){
  if(req.method==='OPTIONS')return cors(res);
  const u=new URL(req.url,'http://localhost');
  try{
    if(req.method==='GET'&&u.pathname==='/health')return json(res,200,{ok:true,service:'axiomcode-marketplace',supabase:Boolean(SUPABASE_URL&&SUPABASE_SECRET_KEY),axiomGuard:true,virusTotal:Boolean(VIRUSTOTAL_API_KEY)});
    if(req.method==='GET'&&u.pathname==='/api/catalog'){
      const catalog=await readCatalog();
      const includeExternal=u.searchParams.get('includeExternal')==='1';
      const features=new Set(String(u.searchParams.get('features')||'').split(',').map(x=>x.trim()).filter(Boolean));
      const extensions=(catalog.extensions||[]).filter(x=>{
        if(x.install?.kind==='external'&&!includeExternal)return false;
        if(x.requiresFeature&&!features.has(String(x.requiresFeature)))return false;
        return true;
      });
      return json(res,200,{...catalog,extensions});
    }
    if(req.method==='GET'&&u.pathname==='/api/editor/latest')return json(res,200,await latestEditorRelease());
    const updateMatch=u.pathname.match(/^\/api\/update\/([^/]+)\/([^/]+)\/([^/]+)$/);
    if(req.method==='GET'&&updateMatch){
      const update=await editorUpdateFeed(decodeURIComponent(updateMatch[1]),decodeURIComponent(updateMatch[2]),decodeURIComponent(updateMatch[3]));
      if(!update){res.writeHead(204,{'Cache-Control':'no-store','Access-Control-Allow-Origin':SITE_ORIGIN});return res.end();}
      return json(res,200,update,{'Cache-Control':'no-store'});
    }
    if(req.method==='GET'&&u.pathname==='/api/gallery/control')return json(res,200,{malicious:[],deprecated:{},search:[],unsupportedPreReleaseExtensions:{}});
    if(req.method==='POST'&&u.pathname==='/_apis/public/gallery/extensionquery'){
      const b=await bodyJson(req);
      const catalog=await readCatalog();
      return json(res,200,vscodeGallery.query(catalog,b,publicBase(req)),{'Cache-Control':'public, max-age=60'});
    }
    const latestMatch=u.pathname.match(/^\/_apis\/public\/gallery\/vscode\/([^/]+)\/([^/]+)\/latest$/);
    if(req.method==='GET'&&latestMatch){
      const id=decodeURIComponent(latestMatch[1])+'.'+decodeURIComponent(latestMatch[2]);
      const entry=await galleryCatalogEntry(id);
      if(!entry||!vscodeGallery.native(entry))return json(res,404,{error:'Extensión no encontrada'});
      return json(res,200,vscodeGallery.toRawGalleryExtension(entry,publicBase(req)),{'Cache-Control':'public, max-age=60'});
    }
    const assetMatch=u.pathname.match(/^\/_apis\/public\/gallery\/assets\/([^/]+)\/([^/]+)\/(.+)$/);
    if(req.method==='GET'&&assetMatch)return serveGalleryAsset(req,res,u,assetMatch);
    const statsMatch=u.pathname.match(/^\/_apis\/public\/gallery\/publishers\/([^/]+)\/extensions\/([^/]+)\/([^/]+)\/stats$/);
    if((req.method==='GET'||req.method==='POST')&&statsMatch){res.writeHead(204,{'Access-Control-Allow-Origin':SITE_ORIGIN});return res.end();}
    if(req.method==='POST'&&u.pathname==='/api/inspect'){
      const b=await bodyJson(req);
      const inspected=await inspectRepository(b.repoUrl,{includeFiles:true});
      return json(res,200,{ok:true,extension:{
        repoUrl:inspected.repoUrl,owner:inspected.owner,repo:inspected.repo,branch:inspected.branch,
        commitSha:inspected.commitSha,manifest:inspected.manifest,icon:inspected.icon,totalBytes:inspected.totalBytes,
        security:{
          engine:inspected.security.engine,verdict:inspected.security.verdict,score:inspected.security.score,
          filesScanned:inspected.security.filesScanned,findings:inspected.security.findings,
          virusTotal:inspected.security.virusTotal
        }
      }});
    }
    if(req.method==='POST'&&u.pathname==='/api/publish'){
      enforceRate(req);
      const b=await bodyJson(req);
      return json(res,201,{ok:true,extension:await publishRepository(b.repoUrl,ipHash(req))});
    }
    if(req.method==='GET'&&await serveStatic(req,res,u))return;
    return json(res,404,{ok:false,error:'Ruta no encontrada'});
  }catch(error){
    const status=/Límite/.test(error.message)?429:/no encontrado|HTTP 404/i.test(error.message)?404:/no está configurado/i.test(error.message)?503:400;
    return json(res,status,{ok:false,error:error.message});
  }
}
if(require.main===module){
  http.createServer(handler).listen(PORT,'0.0.0.0',()=>console.log('AxiomCode Marketplace on '+PORT));
}
module.exports={parseRepoUrl,validateManifest,compareVersions,catalogFromRows,rowToExtension,supabaseConfig,inspectRepository,publishRepository,latestEditorRelease,handler};
