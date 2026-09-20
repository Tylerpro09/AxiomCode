const API=(window.AXIOM_MARKETPLACE_API||((location.protocol==='http:'||location.protocol==='https:')?location.origin:'https://axiomcode-marketplace.onrender.com')).replace(/\/$/,'');
const $=s=>document.querySelector(s);
let catalog=[],candidate=null;

function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function card(x){
  const icon=x.icon?'<img alt="" src="'+esc(x.icon)+'">':esc((x.name||'A')[0].toUpperCase());
  const tags=(x.tags||[]).slice(0,4).map(t=>'<span class="tag">'+esc(t)+'</span>').join('');
  return '<article class="card"><div class="card-head"><div class="icon">'+icon+'</div><div><h3>'+esc(x.name)+(x.verified?' <span class="verified" title="Verificada">◆</span>':'')+'</h3><div class="publisher">'+esc(x.publisher||'Comunidad')+'</div></div></div><p class="desc">'+esc(x.description||'Sin descripción')+'</p><div class="tags">'+tags+'</div><div class="meta"><span>v'+esc(x.version)+'</span><span>'+esc(x.id)+'</span></div></article>';
}
function render(q=''){
  const low=q.trim().toLowerCase();
  const rows=catalog.filter(x=>(x.name+' '+x.id+' '+x.publisher+' '+(x.tags||[]).join(' ')).toLowerCase().includes(low));
  $('#extensionGrid').innerHTML=rows.length?rows.map(card).join(''):'<div class="empty">No se encontraron extensiones.</div>';
}
async function api(path,options={}){
  if(!API)throw Error('API de marketplace no configurada');
  const r=await fetch(API+path,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});
  const data=await r.json().catch(()=>({}));
  if(!r.ok||data.ok===false)throw Error(data.error||('HTTP '+r.status));
  return data;
}
function formatBytes(n){n=Number(n||0);if(n<1024)return n+' B';if(n<1048576)return (n/1024).toFixed(1)+' KB';if(n<1073741824)return (n/1048576).toFixed(1)+' MB';return (n/1073741824).toFixed(1)+' GB';}
async function loadEditorRelease(){
  const card=$('#releaseCard'),state=$('#releaseState');
  try{
    const r=await api('/api/editor/latest');
    if(!r.available){
      state.textContent='Sin release publicada';
      card.innerHTML='<div class="empty">Todavía no hay una versión pública de AxiomCode en GitHub Releases.</div>';
      return;
    }
    const assets=(r.assets||[]).filter(a=>a.url);
    const buttons=assets.length?assets.map(a=>'<a class="download-btn" href="'+esc(a.url)+'"><span>'+esc(a.name)+'</span><small>'+formatBytes(a.size)+'</small></a>').join(''):
      (r.url?'<a class="download-btn" href="'+esc(r.url)+'"><span>Ver release en GitHub</span></a>':'');
    const date=r.publishedAt?new Date(r.publishedAt).toLocaleDateString('es',{year:'numeric',month:'short',day:'numeric'}):'';
    card.innerHTML='<div class="release-main"><div class="release-logo">A</div><div><h3>'+esc(r.name)+'</h3><p>'+esc(r.tag)+(date?' · '+esc(date):'')+'</p></div></div><div class="release-assets">'+buttons+'</div>';
    state.textContent=assets.length+' archivos disponibles';
  }catch(e){
    state.textContent='GitHub no disponible';
    card.innerHTML='<div class="empty">No se pudo consultar la última versión del editor.</div>';
  }
}
async function loadCatalog(){
  try{
    let data;
    try{data=await api('/api/catalog');}
    catch{
      const r=await fetch('./catalog.json',{cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);data=await r.json();
    }
    catalog=Array.isArray(data.extensions)?data.extensions:[];
    $('#catalogState').textContent=catalog.length+' extensiones · online';render();
  }catch(e){$('#catalogState').textContent='Catálogo no disponible';$('#extensionGrid').innerHTML='<div class="empty">No se pudo cargar el catálogo.</div>';}
}
$('#publishForm').addEventListener('submit',async e=>{
  e.preventDefault();candidate=null;$('#preview').classList.add('hidden');$('#submitExtension').classList.add('hidden');
  const msg=$('#repoMessage');msg.className='message';msg.textContent='Analizando repositorio en Render…';
  try{
    const data=await api('/api/inspect',{method:'POST',body:JSON.stringify({repoUrl:$('#repoUrl').value})});
    candidate={repoUrl:$('#repoUrl').value,extension:data.extension};
    const m=data.extension.manifest;
    $('#preview').innerHTML='<h3>'+esc(m.name)+' <small>v'+esc(m.version)+'</small></h3><p>'+esc(m.description||'Sin descripción')+'</p><p><code>'+esc(m.id)+'</code> · '+esc(data.extension.owner+'/'+data.extension.repo)+'</p><p>Commit: <code>'+esc(data.extension.commitSha.slice(0,12))+'</code></p>';
    $('#preview').classList.remove('hidden');$('#submitExtension').classList.remove('hidden');msg.textContent='Repositorio válido. Listo para publicar.';
  }catch(err){msg.className='message error';msg.textContent=err.message;}
});
$('#submitExtension').addEventListener('click',async()=>{
  if(!candidate)return;
  const btn=$('#submitExtension'),msg=$('#repoMessage');
  btn.disabled=true;btn.textContent='Publicando…';msg.className='message';
  try{
    const data=await api('/api/publish',{method:'POST',body:JSON.stringify({repoUrl:candidate.repoUrl})});
    msg.textContent=data.extension.name+' v'+data.extension.version+' publicada correctamente.';
    btn.textContent='Publicada';candidate=null;
    await loadCatalog();
loadEditorRelease();
  }catch(err){msg.className='message error';msg.textContent=err.message;btn.disabled=false;btn.textContent='Reintentar publicación';}
});
$('#search').addEventListener('input',e=>render(e.target.value));
loadCatalog();
loadEditorRelease();