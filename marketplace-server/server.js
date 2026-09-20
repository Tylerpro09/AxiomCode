const http=require('http');
const fs=require('fs');
const fsp=fs.promises;
const path=require('path');
const crypto=require('crypto');
const {URL}=require('url');

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
const rate=new Map();

function json(res,status,data,extra={}){
  res.writeHead(status,{
    'Content-Type':'application/json; charset=utf-8',
    'Access-Control-Allow-Origin':SITE_ORIGIN,
    'Access-Control-Allow-Headers':'Content-Type',
    'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
    'Cache-Control':'no-store',
    ...extra
  });
  res.end(JSON.stringify(data));
}
function cors(res){
  res.writeHead(204,{
    'Access-Control-Allow-Origin':SITE_ORIGIN,
    'Access-Control-Allow-Headers':'Content-Type',
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
async function inspectRepository(repoUrl,{includeFiles=false}={}){
  const parsed=parseRepoUrl(repoUrl);
  const repo=await gh(`/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`);
  if(repo.private)throw Error('El repositorio debe ser público');
  const branch=repo.default_branch;
  const manifestBytes=await readRepoFile(parsed.owner,parsed.repo,'extension.json',branch);
  let raw;try{raw=JSON.parse(manifestBytes.toString('utf8'))}catch{throw Error('extension.json contiene JSON inválido')}
  const manifest=validateManifest(raw);
  const commit=await gh(`/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/commits/${encodeURIComponent(branch)}`);
  const result={
    repoUrl:parsed.url,owner:parsed.owner,repo:parsed.repo,branch,commitSha:commit.sha,
    manifest:{...manifest,publisher:manifest.publisher||parsed.owner}
  };
  if(!includeFiles)return result;

  const treeSha=commit.commit?.tree?.sha;
  if(!treeSha)throw Error('No se pudo resolver el árbol del repositorio');
  const tree=await gh(`/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`);
  if(tree.truncated)throw Error('GitHub API devolvió el árbol del repositorio truncado; no se puede publicar un paquete incompleto');
  const files=(tree.tree||[]).filter(x=>x.type==='blob'&&x.path&&!x.path.startsWith('.github/')&&!x.path.startsWith('node_modules/')&&x.path!=='.gitignore');
  if(!files.some(x=>x.path==='extension.json'))throw Error('extension.json debe estar en la raíz');
  let total=0;
  for(const f of files){
    const size=Number(f.size||0);
    if(size>100*1024*1024)throw Error('GitHub no permite objetos Git normales mayores de 100 MiB: '+f.path);
    total+=size;
  }

  const rawUrl=p=>'https://raw.githubusercontent.com/'+parsed.owner+'/'+parsed.repo+'/'+commit.sha+'/'+p.split('/').map(encodeURIComponent).join('/');
  result.files=files.map(f=>({path:f.path,url:rawUrl(f.path),size:Number(f.size||0)}));
  result.icon=manifest.icon&&files.some(f=>f.path===manifest.icon)?rawUrl(manifest.icon):null;
  result.totalBytes=total;
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
async function readCatalog(){
  const rows=await sb('marketplace_extensions?select=*&status=eq.published&order=featured.desc,name.asc',{method:'GET'});
  return catalogFromRows(rows);
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
    install:{kind:'files',files:inspected.files},
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
async function latestEditorRelease(){
  try{
    const release=await gh(`/repos/${encodeURIComponent(GITHUB_OWNER)}/${encodeURIComponent(GITHUB_REPO)}/releases/latest`);
    return {
      available:true,
      tag:release.tag_name||release.name||'latest',
      name:release.name||release.tag_name||'AxiomCode',
      publishedAt:release.published_at||null,
      url:release.html_url||null,
      notes:String(release.body||'').slice(0,5000),
      assets:(release.assets||[]).map(a=>({
        name:a.name,size:a.size,downloads:a.download_count,url:a.browser_download_url,
        contentType:a.content_type
      }))
    };
  }catch(error){
    if(/GitHub HTTP 404/.test(error.message))return {available:false,assets:[]};
    throw error;
  }
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
async function handler(req,res){
  if(req.method==='OPTIONS')return cors(res);
  const u=new URL(req.url,'http://localhost');
  try{
    if(req.method==='GET'&&u.pathname==='/health')return json(res,200,{ok:true,service:'axiomcode-marketplace',supabase:Boolean(SUPABASE_URL&&SUPABASE_SECRET_KEY)});
    if(req.method==='GET'&&u.pathname==='/api/catalog')return json(res,200,await readCatalog());
    if(req.method==='GET'&&u.pathname==='/api/editor/latest')return json(res,200,await latestEditorRelease());
    if(req.method==='POST'&&u.pathname==='/api/inspect'){
      const b=await bodyJson(req);
      return json(res,200,{ok:true,extension:await inspectRepository(b.repoUrl)});
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