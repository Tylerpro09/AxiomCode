const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
let editor=null,workspace=null,activePath=null,iconManifest=null,paletteMode='commands',paletteItems=[],paletteBuildVersion=0,sideMode='explorer',panelMode='terminal',sidebarVisible=true,scratchInstalled=false,runnerInstalled=false,scratchAssetsLoaded=false,appUpdate=null,updateBusy=false;
const tabs=new Map(), terminalState={sessions:new Map(),active:null};
const extensionRuntimes=new Map(), extensionCommands=new Map();
const outputLog=[], debugLog=[];let autoSaveTimer=null,explorerClipboard=null,explorerSelection=null;
async function ensureScratchAssetsLoaded(){
  if(scratchAssetsLoaded&&window.AxiomScratch)return true;
  if(!scratchInstalled)return false;
  const css=await window.axiom.readExtensionText('axiom.scratch-mode','style.css');
  let style=document.querySelector('style[data-axiom-extension="axiom.scratch-mode"]');
  if(!style){style=document.createElement('style');style.dataset.axiomExtension='axiom.scratch-mode';document.head.appendChild(style);}
  style.textContent=css;
  for(const file of ['core.js','view.js','official-view.js']){
    const code=await window.axiom.readExtensionText('axiom.scratch-mode',file);
    const script=document.createElement('script');
    script.dataset.axiomExtension='axiom.scratch-mode';
    script.textContent=code+'\n//# sourceURL=axiom-extension://axiom.scratch-mode/'+file;
    const nonce=document.querySelector('script[nonce]')?.nonce;
    if(nonce)script.nonce=nonce;
    document.body.appendChild(script);
  }
  scratchAssetsLoaded=Boolean(window.AxiomScratch);
  if(!scratchAssetsLoaded)throw new Error('Modo Scratch no pudo inicializarse');
  return true;
}
function unregisterRendererExtensionCommands(extensionId){
  for(const [id,entry] of extensionCommands)if(entry.extensionId===extensionId)extensionCommands.delete(id);
}
async function unloadRendererRuntime(extensionId){
  const loaded=extensionRuntimes.get(extensionId);
  if(!loaded)return;
  unregisterRendererExtensionCommands(extensionId);
  try{await loaded.api?.deactivate?.();}catch(e){logOutput((loaded.name||extensionId)+': error al desactivar runtime: '+e.message);}
  try{loaded.script?.remove();}catch{}
  if(loaded.globalName){try{delete window[loaded.globalName];}catch{}}
  extensionRuntimes.delete(extensionId);
}
function registerRendererExtensionCommands(item,api){
  unregisterRendererExtensionCommands(item.id);
  const contributed=Array.isArray(item.contributes?.commands)?item.contributes.commands:[];
  for(const raw of contributed){
    const spec=typeof raw==='string'?{id:raw,title:raw}:raw;
    if(!spec||typeof spec.id!=='string'||!spec.id.trim())continue;
    const title=String(spec.title||spec.id).slice(0,160);
    extensionCommands.set(spec.id,{
      extensionId:item.id,
      name:title,
      hint:'',
      run:async()=>{
        try{
          if(typeof api?.runCommand!=='function')throw new Error('La extensión no implementa runCommand');
          await api.runCommand(spec.id);
        }catch(e){
          showInfo(item.name||item.id,'<p>'+escapeHtml(e.message)+'</p>');
        }
      }
    });
  }
}
function rendererRuntimeHost(item){
  return {
    monaco,
    editor,
    getModels:()=>monaco.editor.getModels(),
    getWorkspace:()=>workspace,
    getActivePath:()=>activePath,
    network:{
      request:request=>window.axiom.extensionNetworkRequest(item.id,request)
    },
    log:message=>logOutput((item.name||item.id)+': '+String(message)),
    status:setStatus,
    info:(title,html)=>showInfo(title,html)
  };
}
async function loadRendererRuntime(item){
  const spec=item?.contributes?.rendererRuntime;
  if(!spec||!item.installed||!item.enabled||!editor||typeof monaco==='undefined')return false;
  const entry=String(spec.entry||'').replace(/\\/g,'/');
  if(!entry||entry.startsWith('/')||entry.includes('../')||entry.includes('/..'))throw new Error('Entrada de runtime no válida');
  const globalName=String(spec.global||'');
  if(!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(globalName))throw new Error('Global de runtime no válido');
  const current=extensionRuntimes.get(item.id);
  if(current&&current.version===item.version&&current.entry===entry)return true;
  if(current)await unloadRendererRuntime(item.id);
  const code=await window.axiom.readExtensionText(item.id,entry);
  const script=document.createElement('script');
  script.dataset.axiomRendererExtension=item.id;
  script.textContent=code+'\n//# sourceURL=axiom-extension://'+encodeURIComponent(item.id)+'/'+entry.split('/').map(encodeURIComponent).join('/');
  const nonce=document.querySelector('script[nonce]')?.nonce;
  if(nonce)script.nonce=nonce;
  document.body.appendChild(script);
  const api=window[globalName];
  if(!api||typeof api.activate!=='function'){
    script.remove();
    try{delete window[globalName];}catch{}
    throw new Error('El runtime no expone activate()');
  }
  await api.activate(rendererRuntimeHost(item));
  extensionRuntimes.set(item.id,{id:item.id,name:item.name,version:item.version,entry,globalName,api,script});
  registerRendererExtensionCommands(item,api);
  logOutput((item.name||item.id)+': runtime activado desde la extensión instalada');
  return true;
}
async function syncRendererExtensionRuntimes(items){
  const enabled=(items||[]).filter(x=>x.installed&&x.enabled&&x.contributes?.rendererRuntime);
  const wanted=new Set(enabled.map(x=>x.id));
  for(const id of [...extensionRuntimes.keys()])if(!wanted.has(id))await unloadRendererRuntime(id);
  for(const item of enabled){
    try{await loadRendererRuntime(item);}
    catch(e){logOutput((item.name||item.id)+': '+e.message);}
  }
}
async function refreshExtensionState(){
  const items=await window.axiom.listExtensions();
  scratchInstalled=Boolean(items.find(x=>x.id==='axiom.scratch-mode'&&x.installed&&x.enabled));
  runnerInstalled=Boolean(items.find(x=>x.id==='axiom.runner'&&x.installed&&x.enabled));
  if(scratchInstalled&&!scratchAssetsLoaded){try{await ensureScratchAssetsLoaded();}catch(e){logOutput('Scratch: '+e.message);}}
  await syncRendererExtensionRuntimes(items);
  const b=$('#scratchBtn');if(b)b.style.display=scratchInstalled&&scratchAssetsLoaded?'':'none';
  return items;
}
async function openScratchMode(path){
  if(!scratchInstalled){setSideMode('extensions');showInfo('Modo Scratch','<p>La extensión <b>Modo Scratch</b> no está instalada.</p><p>Instálala desde Extensiones para abrir proyectos .sb3.</p>');return false;}
  try{await ensureScratchAssetsLoaded();}catch(e){showInfo('Modo Scratch','<p>'+escapeHtml(e.message)+'</p>');return false;}
  if(path)await window.AxiomScratch.open(path);else await window.AxiomScratch.show();return true;
}
function openRunnerMode(){if(!runnerInstalled){setSideMode('extensions');showInfo('Runner','<p>La extensión <b>Runner</b> no está instalada.</p><p>Instálala desde Extensiones para activar el ejecutor universal.</p>');return false;}setSideMode('run');return true;}
const lang={js:'javascript',mjs:'javascript',cjs:'javascript',ts:'typescript',tsx:'typescript',jsx:'javascript',py:'python',html:'html',htm:'html',css:'css',scss:'scss',json:'json',md:'markdown',xml:'xml',yaml:'yaml',yml:'yaml',java:'java',c:'c',h:'c',cpp:'cpp',hpp:'cpp',cs:'csharp',php:'php',sql:'sql',sh:'shell',ps1:'powershell',bat:'bat',go:'go',rs:'rust',lua:'lua'};
const basename=p=>(p||'').split(/[\\/]/).filter(Boolean).pop()||p;
const dirname=p=>(p||'').replace(/[\\/][^\\/]+$/,'');
const join=(a,b)=>a+(a.includes('\\')?'\\':'/')+b;
const fileLang=p=>lang[(p.split('.').pop()||'').toLowerCase()]||'plaintext';
const filesOf=nodes=>nodes.flatMap(n=>n.type==='file'?[n]:filesOf(n.children||[]));
const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const setStatus=t=>{$('#statusMessage').textContent=t;};
const logOutput=t=>{outputLog.push(`[${new Date().toLocaleTimeString()}] ${t}`);if(panelMode==='output')renderPanelContent();};
const normalizeSlash=p=>String(p||'').replace(/\\/g,'/');
const relativeToWorkspace=p=>{if(!workspace?.root)return basename(p);const root=normalizeSlash(workspace.root).replace(/\/$/,'');const full=normalizeSlash(p);return full.toLowerCase().startsWith((root+'/').toLowerCase())?full.slice(root.length+1):full;};
async function runEditorAction(id){
  const action=editor?.getAction(id);
  if(!action)return setStatus('Acción no disponible: '+id);
  try{await action.run();}catch(e){showInfo('Editor','<p>'+escapeHtml(e.message)+'</p>');}
}
async function tsWorkerForActive(){
  const model=editor?.getModel();if(!model)return null;
  const language=model.getLanguageId();
  if(language!=='javascript'&&language!=='typescript')return null;
  const factory=language==='typescript'?monaco.languages.typescript.getTypeScriptWorker:monaco.languages.typescript.getJavaScriptWorker;
  const getWorker=await factory();
  return {model,worker:await getWorker(model.uri),uri:model.uri.toString(),offset:model.getOffsetAt(editor.getPosition())};
}
function tsEntryPath(fileName){
  try{
    const uri=monaco.Uri.parse(String(fileName||''));
    return uri.scheme==='file'?uri.fsPath:String(fileName||'');
  }catch{return String(fileName||'');}
}
async function openTsSpan(entry,select=false){
  if(!entry?.fileName||!entry?.textSpan)return false;
  const targetPath=tsEntryPath(entry.fileName);
  let targetModel=monaco.editor.getModels().find(m=>m.uri.toString()===entry.fileName||m.uri.fsPath?.toLowerCase()===targetPath.toLowerCase());
  if(!targetModel&&targetPath){await openFile(targetPath);targetModel=editor?.getModel();}
  else if(targetModel){const tab=[...tabs.entries()].find(([,t])=>t.model===targetModel);if(tab)activate(tab[0]);else editor.setModel(targetModel);}
  if(!targetModel)return false;
  const start=targetModel.getPositionAt(Math.max(0,Number(entry.textSpan.start)||0));
  const end=targetModel.getPositionAt(Math.max(0,(Number(entry.textSpan.start)||0)+(Number(entry.textSpan.length)||1)));
  editor.revealPositionInCenter(start);
  editor.setSelection(select?new monaco.Selection(start.lineNumber,start.column,end.lineNumber,end.column):new monaco.Selection(start.lineNumber,start.column,start.lineNumber,start.column));
  editor.focus();
  return true;
}
async function goToDefinition(){
  const ctx=await tsWorkerForActive();
  if(!ctx)return setStatus('Ir a definición está disponible para JavaScript/TypeScript');
  const rows=await ctx.worker.getDefinitionAtPosition(ctx.uri,ctx.offset)||[];
  if(!rows.length)return setStatus('No se encontró una definición');
  await openTsSpan(rows[0],true);
}
async function peekDefinition(){
  const ctx=await tsWorkerForActive();
  if(!ctx)return setStatus('Vista de definición disponible para JavaScript/TypeScript');
  const rows=await ctx.worker.getDefinitionAtPosition(ctx.uri,ctx.offset)||[];
  if(!rows.length)return setStatus('No se encontró una definición');
  const entry=rows[0],targetPath=tsEntryPath(entry.fileName);
  let content='';
  try{
    const model=monaco.editor.getModels().find(m=>m.uri.toString()===entry.fileName||m.uri.fsPath?.toLowerCase()===targetPath.toLowerCase());
    content=model?model.getValue():(await window.axiom.readFile(targetPath)).content;
  }catch{return setStatus('No se pudo leer la definición');}
  const before=content.slice(0,Math.max(0,Number(entry.textSpan.start)||0));
  const line=before.split(/\r?\n/).length;
  const lines=content.split(/\r?\n/),from=Math.max(0,line-3),to=Math.min(lines.length,line+4);
  showInfo('Definición · '+escapeHtml(entry.name||basename(targetPath)),`<pre class="definition-preview">${escapeHtml(lines.slice(from,to).map((x,i)=>String(from+i+1).padStart(4,' ')+'  '+x).join('\n'))}</pre><p>${escapeHtml(relativeToWorkspace(targetPath))}:${line}</p>`);
}
async function showReferences(){
  const ctx=await tsWorkerForActive();
  if(!ctx)return setStatus('Referencias disponibles para JavaScript/TypeScript');
  const rows=await ctx.worker.getReferencesAtPosition(ctx.uri,ctx.offset)||[];
  if(!rows.length)return setStatus('No se encontraron referencias');
  const back=document.createElement('div');back.className='quick-dialog-backdrop';
  const box=document.createElement('div');box.className='quick-dialog references-dialog';
  box.innerHTML='<h3>Referencias ('+rows.length+')</h3><div class="reference-list"></div><button class="reference-close">Cerrar</button>';
  const list=box.querySelector('.reference-list');
  for(const row of rows){
    const p=tsEntryPath(row.fileName),b=document.createElement('button');b.className='reference-row';
    let line=1;
    try{
      const model=monaco.editor.getModels().find(m=>m.uri.toString()===row.fileName||m.uri.fsPath?.toLowerCase()===p.toLowerCase());
      if(model)line=model.getPositionAt(Number(row.textSpan?.start)||0).lineNumber;
    }catch{}
    b.innerHTML='<b>'+escapeHtml(relativeToWorkspace(p))+'</b><span>Línea '+line+(row.isWriteAccess?' · escritura':'')+'</span>';
    b.onclick=async()=>{back.remove();await openTsSpan(row,true);};
    list.appendChild(b);
  }
  box.querySelector('.reference-close').onclick=()=>back.remove();
  back.appendChild(box);document.body.appendChild(back);
}
function renderBreadcrumbs(){
  const host=$('.breadcrumbs');if(!host)return;
  host.innerHTML='';
  if(!activePath){
    host.innerHTML='<span class="codicon codicon-folder"></span><span>'+(workspace?escapeHtml(basename(workspace.root)):'AxiomCode')+'</span>';
    return;
  }
  const rel=relativeToWorkspace(activePath),parts=normalizeSlash(rel).split('/').filter(Boolean);
  const root=workspace?.root||dirname(activePath);
  const rootBtn=document.createElement('button');rootBtn.className='breadcrumb-item';rootBtn.innerHTML='<span class="codicon codicon-folder"></span>'+escapeHtml(workspace?basename(workspace.root):basename(root));rootBtn.onclick=()=>workspace&&window.axiom.reveal(workspace.root);host.appendChild(rootBtn);
  let current=root;
  for(let i=0;i<parts.length;i++){
    const sep=document.createElement('span');sep.className='codicon codicon-chevron-right breadcrumb-sep';host.appendChild(sep);
    current=join(current,parts[i]);
    const btn=document.createElement('button');btn.className='breadcrumb-item'+(i===parts.length-1?' current':'');btn.textContent=parts[i];
    const target=current;
    btn.onclick=()=>i===parts.length-1?editor?.focus():window.axiom.reveal(target);
    host.appendChild(btn);
  }
}
async function showRecentWorkspaces(){
  const recent=await window.axiom.recentWorkspaces();
  if(!recent?.length)return showInfo('Abrir reciente','<p>No hay carpetas recientes.</p>');
  const back=document.createElement('div');back.className='quick-dialog-backdrop';
  const box=document.createElement('div');box.className='quick-dialog recent-workspaces';
  box.innerHTML='<h3>Abrir reciente</h3><div class="recent-list"></div><button class="recent-cancel">Cancelar</button>';
  const list=box.querySelector('.recent-list');
  for(const p of recent){
    const b=document.createElement('button');b.className='recent-row';b.innerHTML='<b>'+escapeHtml(basename(p))+'</b><span>'+escapeHtml(p)+'</span>';
    b.onclick=async()=>{back.remove();try{useWorkspace(await window.axiom.openWorkspacePath(p),false);}catch(e){showInfo('Abrir reciente','<p>'+escapeHtml(e.message)+'</p>');}};
    list.appendChild(b);
  }
  box.querySelector('.recent-cancel').onclick=()=>back.remove();
  back.appendChild(box);document.body.appendChild(back);
}
function askInput(title,initial=''){return new Promise(resolve=>{const back=document.createElement('div');back.className='quick-dialog-backdrop';back.innerHTML=`<div class="quick-dialog"><label>${escapeHtml(title)}</label><input autocomplete="off"></div>`;const input=back.querySelector('input');input.value=initial;const done=v=>{back.remove();resolve(v);};input.onkeydown=e=>{if(e.key==='Enter')done(input.value);else if(e.key==='Escape')done(null);};back.onclick=e=>{if(e.target===back)done(null);};document.body.appendChild(back);input.focus();input.select();});}
function showInfo(title,html){const back=document.createElement('div');back.className='quick-dialog-backdrop';back.innerHTML=`<div class="quick-dialog info-dialog"><h3>${escapeHtml(title)}</h3><div>${html}</div><button>Aceptar</button></div>`;back.querySelector('button').onclick=()=>back.remove();back.onclick=e=>{if(e.target===back)back.remove();};document.body.appendChild(back);}
function renderUpdateButton(){
  const b=$('#updateBtn'),text=$('#updateBtnText');if(!b||!text)return;
  b.classList.toggle('available',Boolean(appUpdate?.available)||updateBusy);
  b.classList.toggle('busy',updateBusy);
  if(updateBusy)return;
  text.textContent=appUpdate?.available?'Update':'Update';
  b.title=appUpdate?.available?`Actualizar AxiomCode ${appUpdate.currentVersion} → ${appUpdate.latestVersion}`:'Buscar actualizaciones';
}
async function checkForAppUpdates(manual=false){
  if(updateBusy)return appUpdate;
  const b=$('#updateBtn');if(manual){setStatus('Buscando actualizaciones...');b?.classList.add('checking');}
  try{
    appUpdate=await window.axiom.checkForUpdates();renderUpdateButton();
    if(appUpdate.available){
      setStatus(`AxiomCode ${appUpdate.latestVersion} disponible`);
      if(manual)showInfo('Actualización disponible',`<p>AxiomCode <b>${escapeHtml(appUpdate.latestVersion)}</b> está disponible.</p><p>Versión instalada: ${escapeHtml(appUpdate.currentVersion)}</p><p>Usa el botón <b>Update</b> de la barra superior para instalarla.</p>`);
    }else if(manual){
      setStatus('AxiomCode está actualizado');
      showInfo('Actualizaciones',`<p>AxiomCode <b>${escapeHtml(appUpdate.currentVersion||'')}</b> es la versión más reciente instalada.</p>`);
    }
    return appUpdate;
  }catch(e){
    if(manual){setStatus('No se pudo buscar actualizaciones');showInfo('Actualizaciones','<p>'+escapeHtml(e.message)+'</p>');}
    return null;
  }finally{b?.classList.remove('checking');}
}
async function installAppUpdate(){
  if(updateBusy)return;
  if(!appUpdate?.available){await checkForAppUpdates(true);if(!appUpdate?.available)return;}
  if(!confirm(`Actualizar AxiomCode de ${appUpdate.currentVersion} a ${appUpdate.latestVersion}?\n\nSe descargará el instalador oficial desde GitHub y AxiomCode se cerrará para instalarlo.`))return;
  updateBusy=true;renderUpdateButton();$('#updateBtnText').textContent='0%';setStatus('Preparando actualización...');
  try{await window.axiom.installUpdate();}
  catch(e){updateBusy=false;renderUpdateButton();setStatus('Error al actualizar');showInfo('Error de actualización','<p>'+escapeHtml(e.message)+'</p>');}
}
window.axiom.onUpdateProgress(data=>{
  const b=$('#updateBtnText');if(!b)return;
  if(data.stage==='downloading'){b.textContent=`${data.percent||0}%`;setStatus(`Descargando AxiomCode ${appUpdate?.latestVersion||''}: ${data.percent||0}%`);}
  else if(data.stage==='verified'){b.textContent='Install';setStatus('Actualización verificada');}
  else if(data.stage==='launching'){b.textContent='Install';setStatus('Abriendo instalador. AxiomCode se cerrará...');}
});
function iconSrc(id){const p=iconManifest?.iconDefinitions?.[id]?.iconPath||'./../icons/file.svg';return '../node_modules/material-icon-theme/icons/'+p.split('/').pop();}
function fileIconId(name){if(!iconManifest)return'file';const exact=iconManifest.fileNames||{},exts=iconManifest.fileExtensions||{},lower=name.toLowerCase();if(exact[name])return exact[name];if(exact[lower])return exact[lower];const parts=lower.split('.');for(let i=1;i<parts.length;i++){const suffix=parts.slice(i).join('.');if(exts[suffix])return exts[suffix];}return iconManifest.file||'file';}
function folderIconId(name,open){if(!iconManifest)return open?'folder-open':'folder';const map=open?iconManifest.folderNamesExpanded:iconManifest.folderNames,low=name.toLowerCase();return map?.[name]||map?.[low]||(open?iconManifest.folderExpanded:iconManifest.folder)||'folder';}
const iconHtml=id=>`<img class="theme-icon" draggable="false" src="${iconSrc(id)}">`;
function showCode(on){$('#welcome').style.display=on?'none':'flex';$('#editor').style.display=on?'block':'none';}
function rebuildTabOrder(entries){
  tabs.clear();
  for(const [key,value] of entries)tabs.set(key,value);
}
function normalizePinnedTabs(){
  const entries=[...tabs.entries()];
  const pinned=entries.filter(([,t])=>t.pinned),normal=entries.filter(([,t])=>!t.pinned);
  rebuildTabOrder([...pinned,...normal]);
}
function togglePinTab(p){
  const tab=tabs.get(p);if(!tab)return;
  tab.pinned=!tab.pinned;
  normalizePinnedTabs();renderTabs();
  setStatus((tab.pinned?'Fijado: ':'Desfijado: ')+basename(p));
}
function reorderTab(source,target){
  if(!source||!target||source===target||!tabs.has(source)||!tabs.has(target))return;
  const entries=[...tabs.entries()];
  const from=entries.findIndex(([key])=>key===source),to=entries.findIndex(([key])=>key===target);
  const [item]=entries.splice(from,1);
  entries.splice(to,0,item);
  rebuildTabOrder(entries);renderTabs();
}
function closeOtherTabs(p=activePath){
  if(!p)return;
  for(const key of [...tabs.keys()])if(key!==p&&!tabs.get(key)?.pinned)closeTab(key);
}
function closeTabsRight(p=activePath){
  if(!p)return;
  const keys=[...tabs.keys()],index=keys.indexOf(p);
  if(index<0)return;
  for(const key of keys.slice(index+1))if(!tabs.get(key)?.pinned)closeTab(key);
}
function closeUnpinnedTabs(){
  for(const key of [...tabs.keys()])if(!tabs.get(key)?.pinned)closeTab(key);
}
function showTabContextMenu(x,y,p){
  document.querySelector('.context-menu')?.remove();
  const keys=[...tabs.keys()],index=keys.indexOf(p);
  const m=document.createElement('div');m.className='context-menu';
  const tab=tabs.get(p);
  m.innerHTML='<button data-a="pin">'+(tab?.pinned?'Desfijar editor':'Fijar editor')+'</button><button data-a="close">Cerrar</button><button data-a="others">Cerrar otros</button><button data-a="right">Cerrar a la derecha</button><button data-a="all">Cerrar todos los no fijados</button><div></div><button data-a="copy">Copiar ruta</button><button data-a="copyrel">Copiar ruta relativa</button><button data-a="reveal">Mostrar en Explorador</button>';
  m.style.left=x+'px';m.style.top=y+'px';
  m.onclick=async e=>{
    const a=e.target.dataset.a;if(!a)return;
    if(a==='pin')togglePinTab(p);
    if(a==='close')closeTab(p);
    if(a==='others')closeOtherTabs(p);
    if(a==='right')closeTabsRight(p);
    if(a==='all')closeUnpinnedTabs();
    if(a==='copy')await window.axiom.clipboardWrite(p);
    if(a==='copyrel')await window.axiom.clipboardWrite(relativeToWorkspace(p));
    if(a==='reveal')window.axiom.reveal(p);
    m.remove();
  };
  document.body.appendChild(m);setTimeout(()=>document.addEventListener('click',()=>m.remove(),{once:true}),0);
}
function renderTabs(){
  const host=$('#tabs');host.innerHTML='';
  if(!tabs.size){host.innerHTML='<div class="welcome-tab">Inicio</div>';return;}
  tabs.forEach((t,p)=>{
    const el=document.createElement('div');
    el.className='tab'+(p===activePath?' active':'')+(t.pinned?' pinned':'');
    el.title=p+(t.pinned?' · fijado':'');
    el.draggable=true;
    el.innerHTML=`${t.pinned?'<span class="codicon codicon-pinned tab-pin"></span>':iconHtml(fileIconId(basename(p)))}<span class="tab-name">${escapeHtml(basename(p))}</span>${t.dirty?'<span class="dirty">●</span>':''}<button class="tab-close" aria-label="Cerrar">×</button>`;
    el.onclick=e=>{if(!e.target.closest('.tab-close'))activate(p);};
    el.onauxclick=e=>{if(e.button===1)closeTab(p);};
    el.oncontextmenu=e=>{e.preventDefault();showTabContextMenu(e.clientX,e.clientY,p);};
    el.ondragstart=e=>{e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/axiom-tab',p);el.classList.add('dragging');};
    el.ondragend=()=>el.classList.remove('dragging');
    el.ondragover=e=>{e.preventDefault();e.dataTransfer.dropEffect='move';el.classList.add('drag-over');};
    el.ondragleave=()=>el.classList.remove('drag-over');
    el.ondrop=e=>{e.preventDefault();el.classList.remove('drag-over');reorderTab(e.dataTransfer.getData('text/axiom-tab'),p);};
    el.querySelector('.tab-close').onclick=e=>{e.stopPropagation();closeTab(p);};
    host.appendChild(el);
  });
}
async function openFile(p,line,column=1){if(/\.(axiomscratch|sb3|sb2|sb)$/i.test(p))return openScratchMode(p);try{if(!tabs.has(p)){const r=await window.axiom.readFile(p);tabs.set(p,{model:monaco.editor.createModel(r.content,fileLang(p),monaco.Uri.file(p)),dirty:false,pinned:false});}activate(p);if(line){const model=editor.getModel(),safeLine=Math.max(1,Math.min(model.getLineCount(),Number(line)||1)),safeColumn=Math.max(1,Math.min(model.getLineMaxColumn(safeLine),Number(column)||1));editor.revealPositionInCenter({lineNumber:safeLine,column:safeColumn});editor.setPosition({lineNumber:safeLine,column:safeColumn});}}catch(e){setStatus('No se pudo abrir: '+e.message);logOutput(e.message);}}
async function openFiles(){const paths=await window.axiom.openFiles(workspace?.root);for(const p of paths||[])await openFile(p);}
function activate(p){window.AxiomScratch?.hide();const t=tabs.get(p);if(!t)return;activePath=p;editor.setModel(t.model);showCode(true);renderTabs();$('#language').textContent=fileLang(p);renderBreadcrumbs();editor.focus();setStatus(p);if(sideMode==='explorer')renderSideView();}
function closeTab(p){const t=tabs.get(p);if(!t)return;if(t.dirty&&!confirm(`Hay cambios sin guardar en ${basename(p)}. ¿Cerrar?`))return;t.model.dispose();tabs.delete(p);if(activePath===p){activePath=[...tabs.keys()].pop()||null;if(activePath)activate(activePath);else{showCode(false);renderBreadcrumbs();}}renderTabs();}
async function saveActive(){if(window.AxiomScratch?.visible)return window.AxiomScratch.save();if(!activePath)return;const t=tabs.get(activePath);await window.axiom.writeFile(activePath,t.model.getValue());t.dirty=false;renderTabs();setStatus('Guardado '+basename(activePath));logOutput('Guardado '+activePath);if(activePath===window.AxiomPreferences?.state?.settingsPath)await window.AxiomPreferences.reloadFromDisk();}
async function saveAll(){if(window.AxiomScratch?.visible)await window.AxiomScratch.save();for(const [p,t] of tabs){if(t.dirty){await window.axiom.writeFile(p,t.model.getValue());t.dirty=false;}}renderTabs();setStatus('Todos los archivos guardados');}
function useWorkspace(w,restored=false){if(!w)return;workspace=w;$('#workspaceName').textContent=basename(w.root).toUpperCase();renderBreadcrumbs();sideMode='explorer';renderSideView();setStatus((restored?'Proyecto restaurado: ':'Proyecto: ')+w.root);logOutput((restored?'Carpeta restaurada: ':'Carpeta abierta: ')+w.root);updateGit();window.AxiomPreferences?.onWorkspaceChanged();}
async function openWorkspace(){const w=await window.axiom.openWorkspace();if(w)useWorkspace(w,false);}
async function refreshWorkspace(){if(!workspace)return;workspace=await window.axiom.refreshWorkspace(workspace.root);renderSideView();setStatus('Explorador actualizado');}
async function createNewFile(){if(!workspace)return setStatus('Primero abre una carpeta');const name=await askInput('Nombre del nuevo archivo:');if(!name)return;try{const p=join(workspace.root,name);await window.axiom.createFile(p,false);await refreshWorkspace();openFile(p);}catch(e){showInfo('Error',escapeHtml(e.message));}}
async function createNewFolder(){if(!workspace)return setStatus('Primero abre una carpeta');const name=await askInput('Nombre de la nueva carpeta:');if(!name)return;try{await window.axiom.createFile(join(workspace.root,name),true);await refreshWorkspace();}catch(e){showInfo('Error',escapeHtml(e.message));}}
function workspaceNode(target,nodes=workspace?.tree||[]){
  for(const node of nodes){
    if(node.path===target)return node;
    if(node.children){const found=workspaceNode(target,node.children);if(found)return found;}
  }
  return null;
}
function remapOpenTabs(from,to){
  const normFrom=normalizeSlash(from),updates=[];
  for(const [p,t] of tabs){
    const norm=normalizeSlash(p);
    if(norm===normFrom||norm.startsWith(normFrom+'/')){
      const suffix=norm.slice(normFrom.length).replace(/^\//,'');
      const next=suffix?join(to,suffix.replace(/\//g,to.includes('\\')?'\\':'/')):to;
      const content=t.model.getValue(),language=t.model.getLanguageId?.()||fileLang(next);
      const replacement=monaco.editor.createModel(content,language,monaco.Uri.file(next));
      updates.push({old:p,next,tab:{...t,model:replacement}});
    }
  }
  let nextActive=activePath;
  for(const item of updates){
    const wasActive=activePath===item.old;
    try{item.tab===tabs.get(item.old)||tabs.get(item.old)?.model.dispose();}catch{}
    tabs.delete(item.old);tabs.set(item.next,item.tab);
    if(wasActive)nextActive=item.next;
  }
  activePath=nextActive;
  normalizePinnedTabs();
  if(activePath&&tabs.has(activePath))activate(activePath);else renderTabs();
}
function removeTabsUnder(root){
  const normRoot=normalizeSlash(root),remove=[];
  for(const [p,t] of tabs){const norm=normalizeSlash(p);if(norm===normRoot||norm.startsWith(normRoot+'/'))remove.push([p,t]);}
  let activeRemoved=false;
  for(const [p,t] of remove){if(activePath===p)activeRemoved=true;try{t.model.dispose();}catch{}tabs.delete(p);}
  if(activeRemoved){activePath=[...tabs.keys()].pop()||null;if(activePath)activate(activePath);else{showCode(false);renderBreadcrumbs();}}
  renderTabs();
}
function copyDuplicateName(name){
  const dot=name.lastIndexOf('.');
  if(dot>0)return name.slice(0,dot)+' - copia'+name.slice(dot);
  return name+' - copia';
}
function setExplorerClipboard(mode,p){
  explorerClipboard={mode,path:p};
  explorerSelection=p;
  setStatus((mode==='cut'?'Cortar: ':'Copiar: ')+relativeToWorkspace(p));
}
async function pasteExplorerPath(targetPath,targetIsDir){
  if(!explorerClipboard||!workspace)return false;
  const source=explorerClipboard.path;
  const node=workspaceNode(targetPath);
  const isDir=targetIsDir??node?.type==='dir';
  const targetDir=isDir?targetPath:dirname(targetPath);
  let destination=join(targetDir,basename(source));
  if(normalizeSlash(destination).toLowerCase()===normalizeSlash(source).toLowerCase()){
    if(explorerClipboard.mode==='cut'){setStatus('El elemento ya está en esta carpeta');return false;}
    destination=join(targetDir,copyDuplicateName(basename(source)));
  }
  try{
    if(explorerClipboard.mode==='cut'){
      await window.axiom.renameFile(source,destination);
      remapOpenTabs(source,destination);
      explorerClipboard=null;
    }else await window.axiom.copyFile(source,destination);
    explorerSelection=destination;
    await refreshWorkspace();
    setStatus((explorerClipboard?.mode==='copy'?'Copiado':'Movido')+' a '+relativeToWorkspace(destination));
    return true;
  }catch(error){
    showInfo('Explorador','<p>'+escapeHtml(error.message)+'</p>');
    return false;
  }
}
async function duplicatePath(p){
  const suggestion=copyDuplicateName(basename(p));
  const name=await askInput('Nombre de la copia:',suggestion);
  if(!name)return false;
  try{
    const destination=join(dirname(p),name);
    await window.axiom.copyFile(p,destination);
    explorerSelection=destination;
    await refreshWorkspace();
    setStatus('Duplicado: '+relativeToWorkspace(destination));
    return true;
  }catch(error){showInfo('Explorador','<p>'+escapeHtml(error.message)+'</p>');return false;}
}
async function renamePath(p){
  const name=await askInput('Nuevo nombre:',basename(p));if(!name||name===basename(p))return;
  const to=join(dirname(p),name);
  try{await window.axiom.renameFile(p,to);remapOpenTabs(p,to);explorerSelection=to;await refreshWorkspace();renderTabs();}
  catch(error){showInfo('Explorador','<p>'+escapeHtml(error.message)+'</p>');}
}
async function deletePath(p){
  if(!confirm(`¿Eliminar ${basename(p)}?`))return;
  try{await window.axiom.deleteFile(p);removeTabsUnder(p);if(explorerSelection===p)explorerSelection=null;await refreshWorkspace();}
  catch(error){showInfo('Explorador','<p>'+escapeHtml(error.message)+'</p>');}
}
function showContextMenu(x,y,p,isDir=false){
  explorerSelection=p;
  document.querySelector('.context-menu')?.remove();
  const m=document.createElement('div');m.className='context-menu';
  m.innerHTML='<button data-a="open">Abrir</button><button data-a="copyitem">Copiar</button><button data-a="cutitem">Cortar</button><button data-a="pasteitem" '+(explorerClipboard?'':'disabled')+'>Pegar</button><button data-a="duplicate">Duplicar</button><div></div><button data-a="rename">Cambiar nombre</button><button data-a="copypath">Copiar ruta</button><button data-a="copyrel">Copiar ruta relativa</button><button data-a="reveal">Mostrar en Explorador</button><div></div><button data-a="delete" class="danger">Eliminar</button>';
  m.style.left=x+'px';m.style.top=y+'px';
  m.onclick=async e=>{
    const a=e.target.dataset.a;if(!a)return;
    if(a==='open'){if(isDir){const n=workspaceNode(p);if(n){n._open=n._open===false;renderSideView();}}else await openFile(p);}
    if(a==='copyitem')setExplorerClipboard('copy',p);
    if(a==='cutitem')setExplorerClipboard('cut',p);
    if(a==='pasteitem'&&explorerClipboard)await pasteExplorerPath(p,isDir);
    if(a==='duplicate')await duplicatePath(p);
    if(a==='rename')await renamePath(p);
    if(a==='copypath')await window.axiom.clipboardWrite(p);
    if(a==='copyrel')await window.axiom.clipboardWrite(relativeToWorkspace(p));
    if(a==='reveal')window.axiom.reveal(p);
    if(a==='delete')await deletePath(p);
    m.remove();
  };
  document.body.appendChild(m);setTimeout(()=>document.addEventListener('click',()=>m.remove(),{once:true}),0);
}
function renderExplorer(host){
  if(!workspace){host.innerHTML='<div class="empty-state">Todavía no has abierto una carpeta.<button id="welcomeOpenSide">Abrir carpeta</button></div>';$('#welcomeOpenSide').onclick=openWorkspace;return;}
  const draw=(nodes,depth)=>nodes.forEach(n=>{
    const open=n.type==='dir'&&n._open!==false,id=n.type==='dir'?folderIconId(n.name,open):fileIconId(n.name),row=document.createElement('div');
    row.className='tree-row'+((n.path===explorerSelection||(!explorerSelection&&n.path===activePath))?' selected':'');
    row.tabIndex=0;row.dataset.path=n.path;row.style.paddingLeft=(5+depth*13)+'px';
    row.innerHTML=`<span class="chev">${n.type==='dir'?`<span class="codicon codicon-chevron-${open?'down':'right'}"></span>`:''}</span><span class="icon-wrap">${iconHtml(id)}</span><span>${escapeHtml(n.name)}</span>`;
    row.onclick=()=>{explorerSelection=n.path;if(n.type==='dir'){n._open=n._open===false;renderSideView();}else openFile(n.path);};
    row.onfocus=()=>{explorerSelection=n.path;};
    row.oncontextmenu=e=>{e.preventDefault();showContextMenu(e.clientX,e.clientY,n.path,n.type==='dir');};
    row.onkeydown=async e=>{
      const ctrl=e.ctrlKey||e.metaKey;
      if(e.key==='Enter'){e.preventDefault();e.stopPropagation();row.click();}
      else if(e.key==='F2'){e.preventDefault();e.stopPropagation();await renamePath(n.path);}
      else if(e.key==='Delete'){e.preventDefault();e.stopPropagation();await deletePath(n.path);}
      else if(ctrl&&e.key.toLowerCase()==='c'){e.preventDefault();e.stopPropagation();setExplorerClipboard('copy',n.path);}
      else if(ctrl&&e.key.toLowerCase()==='x'){e.preventDefault();e.stopPropagation();setExplorerClipboard('cut',n.path);}
      else if(ctrl&&e.key.toLowerCase()==='v'){e.preventDefault();e.stopPropagation();await pasteExplorerPath(n.path,n.type==='dir');}
    };
    host.appendChild(row);if(open)draw(n.children||[],depth+1);
  });
  draw(workspace.tree,0);
}
function renderSearch(host){
  host.innerHTML='<div class="side-search"><div class="side-input"><span class="codicon codicon-search"></span><input id="sideSearchInput" placeholder="Buscar"><button id="searchCaseBtn" class="search-option" title="Coincidir mayúsculas/minúsculas">Aa</button><button id="searchWordBtn" class="search-option" title="Solo palabra completa">Ab</button><button id="searchRegexBtn" class="search-option" title="Usar expresión regular">.*</button></div><div class="side-input replace-input"><span class="codicon codicon-replace"></span><input id="sideReplaceInput" placeholder="Reemplazar"><button id="replaceAllBtn" title="Reemplazar todo"><span class="codicon codicon-replace-all"></span></button></div><div id="sideSearchMeta" class="search-meta"></div><div id="sideSearchResults" class="side-results"></div></div>';
  const input=$('#sideSearchInput'),replace=$('#sideReplaceInput'),results=$('#sideSearchResults'),meta=$('#sideSearchMeta'),caseBtn=$('#searchCaseBtn'),wordBtn=$('#searchWordBtn'),regexBtn=$('#searchRegexBtn');
  let timer,matchCase=false,wholeWord=false,regex=false,lastRows=[];
  const drawRows=rows=>{
    lastRows=rows;results.innerHTML='';meta.textContent=rows.length?rows.length+' resultado(s)':'';
    if(!rows.length&&input.value.trim())results.innerHTML='<div class="view-note">Sin resultados</div>';
    for(const r of rows){
      const d=document.createElement('button');d.className='search-result';
      d.innerHTML=`<b>${escapeHtml(relativeToWorkspace(r.path))}:${r.line}:${r.column||1}</b><span>${escapeHtml(r.text)}</span>`;
      d.onclick=()=>openFile(r.path,r.line);
      results.appendChild(d);
    }
  };
  const run=()=>{clearTimeout(timer);timer=setTimeout(async()=>{
    const q=input.value;if(!q||!workspace){drawRows([]);return;}
    results.innerHTML='<div class="view-note">Buscando...</div>';meta.textContent='';
    try{drawRows(await window.axiom.searchWorkspace(workspace.root,q,{matchCase,wholeWord,regex}));}
    catch(e){meta.textContent='';results.innerHTML='<div class="view-note">'+escapeHtml(e.message)+'</div>';}
  },180);};
  input.oninput=run;
  caseBtn.onclick=()=>{matchCase=!matchCase;caseBtn.classList.toggle('active',matchCase);run();};
  wordBtn.onclick=()=>{wholeWord=!wholeWord;wordBtn.classList.toggle('active',wholeWord);run();};
  regexBtn.onclick=()=>{regex=!regex;regexBtn.classList.toggle('active',regex);run();};
  $('#replaceAllBtn').onclick=async()=>{
    const q=input.value;if(!workspace||!q)return;
    const value=replace.value;
    const count=lastRows.length;
    if(!count)return setStatus('No hay coincidencias para reemplazar');
    if(!confirm(`¿Reemplazar todas las coincidencias de "${q}" en el proyecto?`))return;
    try{
      const result=await window.axiom.replaceWorkspace(workspace.root,q,value,{matchCase,wholeWord,regex});
      setStatus(`Reemplazadas ${result.replacements} coincidencias en ${result.filesChanged} archivo(s)`);
      logOutput(`Buscar/Reemplazar: ${result.replacements} reemplazos en ${result.filesChanged} archivos`);
      for(const [p,t] of tabs){
        if(t.dirty)continue;
        try{const fresh=await window.axiom.readFile(p);if(fresh.content!==t.model.getValue())t.model.setValue(fresh.content);}catch{}
      }
      await refreshWorkspace();run();
    }catch(e){showInfo('Reemplazar en archivos','<p>'+escapeHtml(e.message)+'</p>');}
  };
  input.focus();
}
async function openGitDiff(change){
  if(!workspace||!change?.path)return;
  const filePath=join(workspace.root,change.path.replace(/\//g,'\\'));
  let modified='';
  try{
    const tab=tabs.get(filePath);
    modified=tab?tab.model.getValue():(await window.axiom.readFile(filePath)).content;
  }catch(e){return showInfo('Git Diff','<p>'+escapeHtml(e.message)+'</p>');}
  let original='';
  if(!change.untracked){
    try{
      const head=await window.axiom.gitShowHead(workspace.root,change.path);
      if(head.ok)original=head.stdout||'';
    }catch{}
  }
  document.querySelector('.diff-overlay')?.remove();
  const back=document.createElement('div');back.className='diff-overlay';
  back.innerHTML='<div class="diff-shell"><div class="diff-head"><div><span class="codicon codicon-diff"></span><b>'+escapeHtml(change.path)+'</b><small>HEAD ↔ cambios actuales</small></div><div><button class="diff-open"><span class="codicon codicon-go-to-file"></span> Abrir archivo</button><button class="diff-close" title="Cerrar"><span class="codicon codicon-close"></span></button></div></div><div class="diff-host"></div></div>';
  document.body.appendChild(back);
  const host=back.querySelector('.diff-host');
  const langId=fileLang(filePath);
  const originalModel=monaco.editor.createModel(original,langId);
  const modifiedModel=monaco.editor.createModel(modified,langId);
  const diff=monaco.editor.createDiffEditor(host,{
    theme:'axiom-vscode-dark',automaticLayout:true,readOnly:true,originalEditable:false,
    renderSideBySide:true,minimap:{enabled:false},scrollBeyondLastLine:false,
    fontFamily:'Cascadia Code, Consolas, monospace',fontSize:13,lineHeight:20
  });
  diff.setModel({original:originalModel,modified:modifiedModel});
  const close=()=>{try{diff.dispose();originalModel.dispose();modifiedModel.dispose();}catch{}back.remove();};
  back.querySelector('.diff-close').onclick=close;
  back.querySelector('.diff-open').onclick=async()=>{close();await openFile(filePath);};
  back.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
  back.tabIndex=-1;back.focus();
}
function parseChanges(text){
  return String(text||'').split(/\r?\n/).filter(Boolean).map(line=>{
    const x=line[0]||' ',y=line[1]||' ',raw=line.slice(3);
    const filePath=raw.includes(' -> ')?raw.split(' -> ').pop():raw;
    return {x,y,code:(x+y).trim()||'M',path:filePath,raw,staged:x!==' '&&x!=='?',unstaged:y!==' ',untracked:x==='?'&&y==='?'};
  });
}
async function renderSCM(host){
  if(!workspace){host.innerHTML='<div class="view-note">Abre una carpeta para usar Git.</div>';return;}
  host.innerHTML='<div class="view-note">Cargando cambios...</div>';
  const [changesResult,branchesResult,statusResult]=await Promise.all([
    window.axiom.gitChanges(workspace.root),
    window.axiom.gitBranches(workspace.root),
    window.axiom.gitStatus(workspace.root)
  ]);
  if(!changesResult.ok){host.innerHTML='<div class="view-note">Esta carpeta no es un repositorio Git.</div>';return;}
  const changes=parseChanges(changesResult.stdout);
  const branches=branchesResult.ok?String(branchesResult.stdout||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean):[];
  const first=String(statusResult.stdout||'').split(/\r?\n/)[0];
  const currentBranch=statusResult.ok?(first.replace(/^##\s*/,'').split('...')[0].trim()||''):'';
  host.innerHTML='<div class="scm-toolbar"><button id="scmRefreshBtn" title="Actualizar"><span class="codicon codicon-refresh"></span></button><button id="stageAllBtn" title="Preparar todos"><span class="codicon codicon-add"></span></button><select id="scmBranchSelect" title="Cambiar rama"></select></div><div class="commit-box"><input id="commitInput" placeholder="Mensaje de commit"><button id="commitBtn">Commit</button></div><div class="scm-section-title">CAMBIOS <span id="scmChangeCount"></span></div><div id="scmFiles"></div>';
  const branchSelect=$('#scmBranchSelect');
  for(const branch of branches){const o=document.createElement('option');o.value=branch;o.textContent=branch;o.selected=branch===currentBranch;branchSelect.appendChild(o);}
  if(!branches.length){const o=document.createElement('option');o.textContent=currentBranch||'Git';branchSelect.appendChild(o);branchSelect.disabled=true;}
  branchSelect.onchange=async()=>{const branch=branchSelect.value;if(!branch||branch===currentBranch)return;const res=await window.axiom.gitCheckout(workspace.root,branch);logOutput(res.stdout||res.stderr||('Git checkout '+branch));if(!res.ok)showInfo('Git','<pre>'+escapeHtml(res.stderr||'No se pudo cambiar de rama')+'</pre>');await refreshWorkspace();await updateGit();renderSCM(host);};
  $('#scmChangeCount').textContent=changes.length?String(changes.length):'';
  const list=$('#scmFiles');
  if(!changes.length)list.innerHTML='<div class="view-note">No hay cambios.</div>';
  for(const change of changes){
    const row=document.createElement('div');row.className='scm-file-row';
    const open=document.createElement('button');open.className='scm-file';
    open.innerHTML=`<span>${escapeHtml(change.path)}</span><b>${escapeHtml(change.code)}</b>`;
    open.onclick=()=>openFile(join(workspace.root,change.path.replace(/\//g,'\\')));
    const actions=document.createElement('div');actions.className='scm-file-actions';
    const diffBtn=document.createElement('button');diffBtn.title='Abrir cambios';diffBtn.innerHTML='<span class="codicon codicon-diff"></span>';
    diffBtn.onclick=()=>openGitDiff(change);actions.appendChild(diffBtn);
    if(change.staged){
      const unstage=document.createElement('button');unstage.title='Quitar de preparados';unstage.innerHTML='<span class="codicon codicon-remove"></span>';
      unstage.onclick=async()=>{const res=await window.axiom.gitUnstageFile(workspace.root,change.path);if(!res.ok)showInfo('Git','<pre>'+escapeHtml(res.stderr||'No se pudo quitar de preparados')+'</pre>');renderSCM(host);};actions.appendChild(unstage);
    }else{
      const stage=document.createElement('button');stage.title='Preparar cambios';stage.innerHTML='<span class="codicon codicon-add"></span>';
      stage.onclick=async()=>{const res=await window.axiom.gitStageFile(workspace.root,change.path);if(!res.ok)showInfo('Git','<pre>'+escapeHtml(res.stderr||'No se pudo preparar')+'</pre>');renderSCM(host);};actions.appendChild(stage);
    }
    const discard=document.createElement('button');discard.title=change.untracked?'Eliminar archivo sin seguimiento':'Descartar cambios';discard.innerHTML='<span class="codicon codicon-discard"></span>';
    discard.onclick=async()=>{
      if(!confirm((change.untracked?'¿Eliminar ':'¿Descartar los cambios de ')+change.path+'?'))return;
      let res={ok:true};
      if(change.untracked){try{await window.axiom.deleteFile(join(workspace.root,change.path.replace(/\//g,'\\')));}catch(e){res={ok:false,stderr:e.message};}}
      else res=await window.axiom.gitDiscardFile(workspace.root,change.path);
      if(!res.ok)showInfo('Git','<pre>'+escapeHtml(res.stderr||'No se pudieron descartar los cambios')+'</pre>');
      await refreshWorkspace();renderSCM(host);
    };
    actions.appendChild(discard);row.append(open,actions);list.appendChild(row);
  }
  $('#scmRefreshBtn').onclick=()=>renderSCM(host);
  $('#stageAllBtn').onclick=async()=>{const res=await window.axiom.gitAddAll(workspace.root);logOutput(res.stdout||res.stderr||'Git: todos los cambios preparados');renderSCM(host);};
  $('#commitBtn').onclick=async()=>{const msg=$('#commitInput').value.trim();if(!msg)return;const res=await window.axiom.gitCommit(workspace.root,msg);logOutput(res.stdout||res.stderr||'Git commit');if(!res.ok)showInfo('Git','<pre>'+escapeHtml(res.stderr||'No se pudo crear el commit')+'</pre>');await updateGit();renderSCM(host);};
}
function renderRunView(host){
  if(!runnerInstalled){
    host.innerHTML=`<div class="run-view"><div class="run-icon"><span class="codicon codicon-debug-alt"></span></div><h3>Ejecutar y depurar</h3><p>Instala <b>Runner</b> para activar ejecución universal, detección de runtimes y compilación automática.</p><button id="runnerInstallView"><span class="codicon codicon-extensions"></span> Ver Runner en Extensiones</button></div>`;
    const install=$('#runnerInstallView');if(install)install.onclick=()=>setSideMode('extensions');
    return;
  }
  host.innerHTML=`<div class="run-view"><div class="run-icon"><span class="codicon codicon-play-circle"></span></div><h3>Runner</h3><p>${activePath?'Archivo activo: '+escapeHtml(basename(activePath)):'Abre un archivo ejecutable.'}</p><div id="runnerRuntime" class="view-note">Detectando ejecutor…</div><button id="runActiveSide" ${activePath?'':'disabled'}><span class="codicon codicon-play"></span> Ejecutar archivo activo</button><button id="stopRunnerSide"><span class="codicon codicon-debug-stop"></span> Detener</button><p class="view-note">JS/TS · Python · PowerShell · BAT · PHP · Ruby · Perl · Lua · Go · Rust · C/C++ · Java · C# · Dart · Bash · HTML</p></div>`;
  const b=$('#runActiveSide');if(b)b.onclick=runActiveFile;
  const stop=$('#stopRunnerSide');if(stop)stop.onclick=stopRunner;
  if(activePath)window.axiom.describeRunner(activePath).then(info=>{const node=$('#runnerRuntime');if(!node)return;node.textContent=info.supported?`${info.name} · ${(info.candidates||[]).join(' / ')||'sistema'}`:(info.reason||'Tipo de archivo no compatible con Runner');}).catch(()=>{});
  else {const node=$('#runnerRuntime');if(node)node.textContent='Sin archivo activo';}
}
async function renderExtensions(host){
 host.innerHTML='<div class="side-search"><div class="side-input"><span class="codicon codicon-search"></span><input id="extSearch" placeholder="Buscar en Axiom Marketplace"></div><div class="market-toolbar"><button id="refreshMarketplace"><span class="codicon codicon-refresh"></span> Actualizar</button><span id="marketStatus">Conectando…</span></div><button id="openExtFolder" class="ext-folder-btn"><span class="codicon codicon-folder-opened"></span> Extensiones locales</button><div id="extList"><div class="view-note">Cargando marketplace...</div></div></div>';
 let locals=await refreshExtensionState();
 let market={extensions:[],source:'local',error:null};
 const marketPromise=window.axiom.getMarketplace(false).catch(e=>({extensions:[],source:'offline',error:e.message}));
 const status=$('#marketStatus');
 const setMarketStatus=()=>{status.textContent=market.error?'Offline · catálogo local':((market.source==='online'?'Online':market.source||'local')+' · '+(market.extensions?.length||0)+' extensiones');};
 const rows=()=>{
   const map=new Map();
   for(const x of locals)map.set(x.id,{...x,installedVersion:x.installed?x.version:null,online:false});
   for(const x of market.extensions||[]){
     const local=map.get(x.id);
     map.set(x.id,{...(local||{}),...x,installed:Boolean(local?.installed||x.installed),installedVersion:local?.installed?local.version:(x.installedVersion||null),security:local?.security||x.install?.security||null,online:true});
   }
   return [...map.values()];
 };
 const draw=q=>{const el=$('#extList');el.innerHTML='';const low=q.toLowerCase();const list=rows().filter(x=>(x.name+' '+x.description+' '+x.id+' '+(x.publisher||'')+' '+(x.tags||[]).join(' ')).toLowerCase().includes(low));
   if(!list.length){el.innerHTML='<div class="view-note">No hay extensiones que coincidan.</div>';return;}
   for(const x of list){
     const card=document.createElement('div');card.className='extension-card';
     const badge=x.verified?' · verificada':x.online?' · comunidad':'';
     const version=x.installed&&x.installedVersion?('v'+x.installedVersion+(x.updateAvailable?' → v'+x.version:'')):('v'+x.version);
     card.innerHTML=`<div class="extension-mark">${escapeHtml((x.name||'A')[0])}</div><div><b>${escapeHtml(x.name||x.id)}</b><span>${escapeHtml(x.description||x.id)}</span><small>${escapeHtml(version)} · ${escapeHtml(x.publisher||'AxiomCode')}${badge}</small><div class="extension-actions"></div></div>`;
     const actions=card.querySelector('.extension-actions');
     if(!x.installed){
       if(x.install?.kind==='external'){
         const b=document.createElement('button');b.textContent='Ver original';b.className='extension-install';b.onclick=async()=>{try{await window.axiom.openExternal(x.install.url||x.homepage);}catch(e){showInfo('No se pudo abrir','<p>'+escapeHtml(e.message)+'</p>');}};actions.appendChild(b);
       }else{
         const b=document.createElement('button');b.textContent='Instalar';b.className='extension-install';b.onclick=async()=>{b.disabled=true;b.textContent='Instalando…';try{await window.axiom.installExtension(x.id);locals=await refreshExtensionState();market=await window.axiom.getMarketplace(true);setMarketStatus();draw($('#extSearch').value);setStatus('Extensión instalada: '+x.name);}catch(e){showInfo('Error al instalar','<p>'+escapeHtml(e.message)+'</p>');draw($('#extSearch').value);}};actions.appendChild(b);
       }
     }else{
       if(x.updateAvailable){
         const u=document.createElement('button');u.textContent='Actualizar';u.className='extension-update';u.onclick=async()=>{u.disabled=true;u.textContent='Actualizando…';try{const result=await window.axiom.updateExtension(x.id);if(result?.requiresAppUpdate){await checkForAppUpdates(false);if(appUpdate?.available)await installAppUpdate();else showInfo('Actualización de AxiomCode',`<p>La nueva versión de <b>${escapeHtml(x.name)}</b> viene incluida con una actualización de AxiomCode.</p>`);return;}locals=await refreshExtensionState();market=await window.axiom.getMarketplace(true);setMarketStatus();draw($('#extSearch').value);setStatus('Extensión actualizada: '+x.name);}catch(e){showInfo('Error al actualizar','<p>'+escapeHtml(e.message)+'</p>');draw($('#extSearch').value);}};actions.appendChild(u);
       }
       if(x.id==='axiom.scratch-mode'){
         const o=document.createElement('button');o.textContent='Abrir';o.className='scratch-extension-open';o.onclick=()=>openScratchMode();actions.appendChild(o);
       }
       if(x.id==='axiom.runner'){
         const o=document.createElement('button');o.textContent='Abrir';o.className='runner-extension-open';o.onclick=()=>openRunnerMode();actions.appendChild(o);
       }
       const u=document.createElement('button');u.textContent='Desinstalar';u.className='extension-uninstall';u.onclick=async()=>{if(!confirm('¿Desinstalar '+x.name+'?'))return;if(x.id==='axiom.scratch-mode')window.AxiomScratch?.hide();try{await window.axiom.uninstallExtension(x.id);locals=await refreshExtensionState();market=await window.axiom.getMarketplace(true);setMarketStatus();draw($('#extSearch').value);setStatus('Extensión desinstalada: '+x.name);}catch(e){showInfo('Error al desinstalar','<p>'+escapeHtml(e.message)+'</p>');}};actions.appendChild(u);
     }
     el.appendChild(card);
   }
 };
 status.textContent='Local · '+locals.length+' extensiones';draw('');
 $('#extSearch').oninput=e=>draw(e.target.value);
 $('#refreshMarketplace').onclick=async()=>{status.textContent='Actualizando…';try{market=await window.axiom.getMarketplace(true);locals=await refreshExtensionState();setMarketStatus();draw($('#extSearch').value);}catch(e){status.textContent='Sin conexión';}};
 $('#openExtFolder').onclick=()=>window.axiom.openExtensionsFolder();
 market=await marketPromise;
 if(!status.isConnected||sideMode!=='extensions')return;
 setMarketStatus();draw($('#extSearch').value);
}
async function renderOutline(host){
  if(!editor?.getModel()){host.innerHTML='<div class="view-note">Abre un archivo para mostrar su esquema.</div>';return;}
  const model=editor.getModel(),language=model.getLanguageId();
  host.innerHTML='<div class="view-note">Analizando símbolos...</div>';
  let symbols=[];
  try{
    if(language==='javascript'||language==='typescript'){
      const factory=language==='typescript'?monaco.languages.typescript.getTypeScriptWorker:monaco.languages.typescript.getJavaScriptWorker;
      const getWorker=await factory(),worker=await getWorker(model.uri),tree=await worker.getNavigationTree(model.uri.toString());
      const walk=(items,depth=0)=>{for(const item of items||[]){if(item.text&&item.text!=='<global>'){const span=item.nameSpan||item.spans?.[0];if(span)symbols.push({name:item.text,kind:item.kind||'symbol',depth,start:span.start||0});}walk(item.childItems,depth+1);}};
      walk(tree?.childItems||[]);
    }else{
      const lines=model.getLinesContent();
      const patterns=[
        {kind:'class',re:/^\s*(?:class|interface|struct|enum|trait)\s+([A-Za-z_$][\w$]*)/},
        {kind:'function',re:/^\s*(?:async\s+)?(?:function|def|fn|func)\s+([A-Za-z_$][\w$]*)/},
        {kind:'method',re:/^\s*(?:public|private|protected|static|async|export|final|virtual|override|synchronized|abstract|\s)*[A-Za-z_$][\w$<>,\[\] ?.:]*\s+([A-Za-z_$][\w$]*)\s*\([^;]*\)\s*(?:\{|:)?\s*$/}
      ];
      lines.forEach((line,index)=>{for(const p of patterns){const m=p.re.exec(line);if(m){symbols.push({name:m[1],kind:p.kind,depth:0,line:index+1});break;}}});
    }
  }catch(e){host.innerHTML='<div class="view-note">'+escapeHtml(e.message)+'</div>';return;}
  host.innerHTML='';
  if(!symbols.length){host.innerHTML='<div class="view-note">No se encontraron símbolos.</div>';return;}
  for(const s of symbols){
    const b=document.createElement('button');b.className='outline-row';b.style.paddingLeft=(8+s.depth*14)+'px';
    const icon=s.kind==='class'||s.kind==='interface'?'symbol-class':s.kind==='function'||s.kind==='method'?'symbol-method':'symbol-variable';
    b.innerHTML='<span class="codicon codicon-'+icon+'"></span><span>'+escapeHtml(s.name)+'</span><small>'+escapeHtml(s.kind)+'</small>';
    b.onclick=()=>{let pos=s.line?{lineNumber:s.line,column:1}:model.getPositionAt(s.start||0);editor.revealPositionInCenter(pos);editor.setPosition(pos);editor.focus();};
    host.appendChild(b);
  }
}
function renderSideView(){const host=$('#tree'),title=$('.side-head>span');host.innerHTML='';const titles={explorer:'EXPLORADOR',search:'BUSCAR',scm:'CONTROL DE CÓDIGO FUENTE',run:'EJECUTAR Y DEPURAR',outline:'ESQUEMA',extensions:'EXTENSIONES'};title.textContent=titles[sideMode]||'EXPLORADOR';$$('.activity button').forEach(b=>b.classList.remove('active'));const map={explorer:'#explorerBtn',search:'#searchBtn',scm:'#gitBtn',run:'#runBtn',outline:'#outlineBtn',extensions:'#extensionsBtn'};$(map[sideMode])?.classList.add('active');$('.side-actions').style.display=sideMode==='explorer'?'flex':'none';if(sideMode==='explorer')renderExplorer(host);if(sideMode==='search')renderSearch(host);if(sideMode==='scm')renderSCM(host);if(sideMode==='run')renderRunView(host);if(sideMode==='outline')renderOutline(host);if(sideMode==='extensions')renderExtensions(host);}
function setSideMode(mode){sideMode=mode;if(!sidebarVisible)toggleSidebar(true);renderSideView();}
function toggleSidebar(force){sidebarVisible=force??!sidebarVisible;document.body.classList.toggle('no-sidebar',!sidebarVisible);setTimeout(()=>editor?.layout(),40);}
async function updateGit(){if(!workspace)return;const r=await window.axiom.gitStatus(workspace.root),first=(r.stdout||'').split(/\r?\n/)[0],branch=r.ok?(first.replace(/^##\s*/,'').split('...')[0]||'git'):'sin git';$('#gitStatus').innerHTML=`<span class="codicon codicon-source-control"></span>${escapeHtml(branch)}`;if(sideMode==='scm')renderSideView();}
function fitActiveTerminal(){const t=terminalState.sessions.get(terminalState.active);if(!t?.fit||panelMode!=='terminal')return;requestAnimationFrame(()=>{try{t.fit.fit();window.axiom.resizeTerminal(t.id,t.term.cols,t.term.rows);}catch{}});}
function togglePanel(force){const p=$('#panel'),open=force??!p.classList.contains('open');p.classList.toggle('open',open);if(open&&panelMode==='terminal')renderActiveTerminal();setTimeout(()=>{editor?.layout();fitActiveTerminal();},40);}
function setPanelMode(mode){panelMode=mode;togglePanel(true);$$('.panel-title-strip>button').forEach(b=>b.classList.remove('active'));const ids={problems:'#problemsTab',output:'#outputTab',debug:'#debugTab',terminal:'#terminalTab'};$(ids[mode])?.classList.add('active');renderPanelContent();}
const AXIOM_DIAGNOSTIC_OWNER='axiom-problems';
const diagnosticTimers=new Map();
function flattenTsDiagnosticMessage(message){
  if(typeof message==='string')return message;
  const parts=[];let node=message;
  while(node){
    if(node.messageText)parts.push(String(node.messageText));
    node=Array.isArray(node.next)?node.next[0]:null;
  }
  return parts.join(' ')||'Problema de TypeScript';
}
function tsDiagnosticMarker(model,diag){
  const startOffset=Math.max(0,Number(diag.start)||0);
  const length=Math.max(1,Number(diag.length)||1);
  const start=model.getPositionAt(startOffset);
  const end=model.getPositionAt(Math.min(model.getValueLength(),startOffset+length));
  const category=Number(diag.category);
  const severity=category===1?monaco.MarkerSeverity.Error:category===0?monaco.MarkerSeverity.Warning:category===2?monaco.MarkerSeverity.Hint:monaco.MarkerSeverity.Info;
  return {
    severity,
    message:flattenTsDiagnosticMessage(diag.messageText),
    source:model.getLanguageId()==='typescript'?'TypeScript':'JavaScript',
    code:diag.code!==undefined?String(diag.code):undefined,
    startLineNumber:start.lineNumber,startColumn:start.column,
    endLineNumber:end.lineNumber,endColumn:Math.max(end.column,start.column+1)
  };
}
function lspDiagnosticMarker(diag,source='Language Service'){
  const range=diag&&diag.range||{};
  const start=range.start||{line:0,character:0},end=range.end||start;
  const sev=Number(diag&&diag.severity);
  const severity=sev===1?monaco.MarkerSeverity.Error:sev===2?monaco.MarkerSeverity.Warning:sev===4?monaco.MarkerSeverity.Hint:monaco.MarkerSeverity.Info;
  return {
    severity,
    message:String(diag&&diag.message||'Problema detectado'),
    source:String(diag&&diag.source||source),
    code:diag&&diag.code!==undefined?String(diag.code):undefined,
    startLineNumber:Number(start.line||0)+1,startColumn:Number(start.character||0)+1,
    endLineNumber:Number(end.line||start.line||0)+1,endColumn:Number(end.character||start.character||0)+1
  };
}
function structuralDiagnostics(model){
  const language=model.getLanguageId();
  if(language==='plaintext'||language==='markdown')return [];
  const text=model.getValue(),markers=[],stack=[];
  const openToClose={'(':')','[':']','{':'}'};
  const closeToOpen={')':'(',']':'[','}':'{'};
  let line=1,column=1,quote=null,escape=false,lineComment=false,blockComment=false;
  const cStyle=new Set(['javascript','typescript','java','c','cpp','csharp','go','rust','php','css','scss']);
  const hashStyle=new Set(['python','shell','powershell','yaml']);
  const pushMarker=(message,l,col)=>markers.push({
    severity:monaco.MarkerSeverity.Error,message,source:'Axiom Syntax',
    startLineNumber:l,startColumn:col,endLineNumber:l,endColumn:col+1
  });
  for(let i=0;i<text.length;i++){
    const ch=text[i],next=text[i+1]||'';
    if(ch==='\n'){line++;column=1;lineComment=false;if(!(quote&&quote.charCodeAt(0)===96))quote=null;escape=false;continue;}
    if(lineComment){column++;continue;}
    if(blockComment){
      if(ch==='*'&&next==='/'){blockComment=false;i++;column+=2;continue;}
      column++;continue;
    }
    if(quote){
      if(escape){escape=false;column++;continue;}
      if(ch==='\\'){escape=true;column++;continue;}
      if(ch===quote)quote=null;
      column++;continue;
    }
    if(cStyle.has(language)&&ch==='/'&&next==='/'){lineComment=true;i++;column+=2;continue;}
    if(cStyle.has(language)&&ch==='/'&&next==='*'){blockComment=true;i++;column+=2;continue;}
    if(hashStyle.has(language)&&ch==='#'){lineComment=true;column++;continue;}
    if(ch==='"'||ch==="'"||(ch.charCodeAt(0)===96&&(language==='javascript'||language==='typescript'))){quote=ch;column++;continue;}
    if(openToClose[ch])stack.push({ch,line,column});
    else if(closeToOpen[ch]){
      const top=stack[stack.length-1];
      if(!top||top.ch!==closeToOpen[ch])pushMarker('Cierre '+ch+' sin apertura correspondiente.',line,column);
      else stack.pop();
    }
    column++;
  }
  for(const item of stack.slice(-80))pushMarker('Falta cerrar '+openToClose[item.ch]+'.',item.line,item.column);
  return markers;
}
function htmlStructureDiagnostics(model){
  if(model.getLanguageId()!=='html')return [];
  const text=model.getValue(),markers=[],stack=[];
  const voidTags=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  const re=/<\s*(\/)?\s*([A-Za-z][A-Za-z0-9:-]*)([^>]*)>/g;
  let match;
  while((match=re.exec(text))){
    const closing=Boolean(match[1]),tag=match[2].toLowerCase(),tail=match[3]||'';
    if(voidTags.has(tag)||/\/\s*$/.test(tail))continue;
    const pos=model.getPositionAt(match.index);
    if(!closing){stack.push({tag,pos});continue;}
    const top=stack[stack.length-1];
    if(!top||top.tag!==tag){
      markers.push({severity:monaco.MarkerSeverity.Error,message:'Etiqueta de cierre </'+tag+'> no coincide con la apertura.',source:'Axiom HTML',startLineNumber:pos.lineNumber,startColumn:pos.column,endLineNumber:pos.lineNumber,endColumn:pos.column+match[0].length});
    }else stack.pop();
  }
  for(const item of stack.slice(-80))markers.push({severity:monaco.MarkerSeverity.Warning,message:'Falta cerrar <'+item.tag+'>.',source:'Axiom HTML',startLineNumber:item.pos.lineNumber,startColumn:item.pos.column,endLineNumber:item.pos.lineNumber,endColumn:item.pos.column+1});
  return markers;
}
function dedupeDiagnosticMarkers(markers){
  const map=new Map();
  for(const marker of markers||[]){
    if(!marker||!marker.message)continue;
    const key=[marker.startLineNumber,marker.startColumn,marker.endLineNumber,marker.endColumn,marker.message].join('|');
    const previous=map.get(key);
    if(!previous||marker.severity>previous.severity)map.set(key,marker);
  }
  return [...map.values()].slice(0,300);
}
async function languageWorkerDiagnostics(model){
  const language=model.getLanguageId();
  if(language==='javascript'||language==='typescript'){
    const workerFactory=language==='typescript'?monaco.languages.typescript.getTypeScriptWorker:monaco.languages.typescript.getJavaScriptWorker;
    const getWorker=await workerFactory();
    const worker=await getWorker(model.uri);
    const uri=model.uri.toString();
    const groups=await Promise.all([
      worker.getSyntacticDiagnostics(uri).catch(()=>[]),
      worker.getSemanticDiagnostics(uri).catch(()=>[]),
      worker.getSuggestionDiagnostics(uri).catch(()=>[])
    ]);
    return groups.flat().map(diag=>tsDiagnosticMarker(model,diag));
  }
  if(language==='json'&&monaco.languages.json&&monaco.languages.json.getWorker){
    const getWorker=await monaco.languages.json.getWorker();
    const worker=await getWorker(model.uri);
    const rows=await worker.doValidation(model.uri.toString());
    return (rows||[]).map(diag=>lspDiagnosticMarker(diag,'JSON'));
  }
  return [];
}
async function refreshModelDiagnostics(model){
  if(!model||model.isDisposed&&model.isDisposed())return;
  const uri=model.uri.toString();
  try{
    const workerMarkers=await languageWorkerDiagnostics(model);
    if(model.isDisposed&&model.isDisposed())return;
    const markers=dedupeDiagnosticMarkers(workerMarkers.concat(structuralDiagnostics(model),htmlStructureDiagnostics(model)));
    monaco.editor.setModelMarkers(model,AXIOM_DIAGNOSTIC_OWNER,markers);
  }catch(error){
    if(!(model.isDisposed&&model.isDisposed())){
      const fallback=dedupeDiagnosticMarkers(structuralDiagnostics(model).concat(htmlStructureDiagnostics(model)));
      monaco.editor.setModelMarkers(model,AXIOM_DIAGNOSTIC_OWNER,fallback);
      logOutput('Diagnóstico '+basename(model.uri&&model.uri.fsPath||model.uri&&model.uri.path||'archivo')+': '+String(error&&error.message||error));
    }
  }finally{
    diagnosticTimers.delete(uri);
  }
}
function scheduleModelDiagnostics(model,delay=280){
  if(!model||model.isDisposed&&model.isDisposed())return;
  const key=model.uri.toString();
  clearTimeout(diagnosticTimers.get(key));
  diagnosticTimers.set(key,setTimeout(()=>refreshModelDiagnostics(model),delay));
}
function wireModelDiagnostics(model){
  if(!model||model.__axiomDiagnosticsWired)return;
  model.__axiomDiagnosticsWired=true;
  model.onDidChangeContent(()=>scheduleModelDiagnostics(model));
  if(model.onWillDispose)model.onWillDispose(()=>{const key=model.uri.toString();clearTimeout(diagnosticTimers.get(key));diagnosticTimers.delete(key);});
  scheduleModelDiagnostics(model,30);
}
function currentProblemMarkers(){
  if(typeof monaco==='undefined')return [];
  const unique=new Map();
  for(const m of monaco.editor.getModelMarkers({})||[]){
    if(!m||!m.resource||!m.message)continue;
    const key=[m.resource.toString(),m.startLineNumber,m.startColumn,m.endLineNumber,m.endColumn,m.message].join('|');
    const previous=unique.get(key);
    if(!previous||m.severity>previous.severity)unique.set(key,m);
  }
  return [...unique.values()].sort((a,b)=>(b.severity-a.severity)||String(a.resource&&a.resource.fsPath||a.resource&&a.resource.path||'').localeCompare(String(b.resource&&b.resource.fsPath||b.resource&&b.resource.path||''))||(a.startLineNumber-b.startLineNumber)||(a.startColumn-b.startColumn));
}
function updateProblemBadge(markers=currentProblemMarkers()){
  const tab=$('#problemsTab');if(!tab)return;
  const errors=markers.filter(m=>m.severity>=monaco.MarkerSeverity.Error).length;
  const warnings=markers.filter(m=>m.severity===monaco.MarkerSeverity.Warning).length;
  tab.textContent=markers.length?`PROBLEMAS (${markers.length})`:'PROBLEMAS';
  tab.title=markers.length?`${errors} error(es), ${warnings} advertencia(s)`:'Sin problemas detectados';
  tab.classList.toggle('has-errors',errors>0);
  tab.classList.toggle('has-warnings',errors===0&&warnings>0);
}
function markerLocation(marker){
  const resource=marker?.resource;
  const filePath=resource?.fsPath||resource?.path||'';
  return {filePath,label:basename(filePath||resource?.toString?.()||'archivo')};
}
function renderPanelContent(){
  const out=$('#terminalOutput'),host=$('#terminalHost'),row=$('.terminal-input-row'),actions=$('.terminal-actions');
  out.innerHTML='';host.style.display=panelMode==='terminal'?'block':'none';out.style.display=panelMode==='terminal'?'none':'block';row.style.display='none';actions.style.visibility=panelMode==='terminal'?'visible':'hidden';
  if(panelMode==='terminal'){renderActiveTerminal();return;}
  if(panelMode==='output'){out.textContent=outputLog.join('\n')||'AxiomCode Output';return;}
  if(panelMode==='debug'){out.textContent=debugLog.join('\n')||'Consola de depuración lista.';return;}
  const markers=currentProblemMarkers();updateProblemBadge(markers);
  if(!markers.length){out.innerHTML='<div class="empty-panel">No se detectaron problemas en los archivos abiertos.</div>';return;}
  for(const m of markers){
    const {filePath,label}=markerLocation(m);
    const icon=m.severity>=monaco.MarkerSeverity.Error?'error':m.severity===monaco.MarkerSeverity.Warning?'warning':'info';
    const kind=m.severity>=monaco.MarkerSeverity.Error?'Error':m.severity===monaco.MarkerSeverity.Warning?'Advertencia':'Información';
    const d=document.createElement('button');d.className='problem-row';
    d.innerHTML=`<span class="codicon codicon-${icon}"></span><span><b>${escapeHtml(kind)}:</b> ${escapeHtml(m.message)}</span><small>${escapeHtml(label)}:${m.startLineNumber}:${m.startColumn}</small>`;
    d.onclick=()=>filePath&&openFile(filePath,m.startLineNumber);
    out.appendChild(d);
  }
}
async function newTerminal(shell=$('#terminalShell')?.value||window.AxiomPreferences?.getSetting('terminal.defaultProfile')||'powershell'){const info=await window.axiom.createTerminal(shell,workspace?.root),session={...info,buffer:'',history:[],historyPos:0,term:null,fit:null,node:null};if(info.pty&&globalThis.Terminal&&globalThis.FitAddon?.FitAddon){const node=document.createElement('div');node.className='xterm-session';node.dataset.id=info.id;$('#terminalHost').appendChild(node);const term=new Terminal({cursorBlink:true,fontFamily:'Cascadia Code, Consolas, monospace',fontSize:Number(window.AxiomPreferences?.getSetting('terminal.fontSize'))||13,lineHeight:1.2,scrollback:Number(window.AxiomPreferences?.getSetting('terminal.scrollback'))||5000,theme:{background:'#181818',foreground:'#CCCCCC',cursor:'#AEAFAD',selectionBackground:'#264F78'}}),fit=new FitAddon.FitAddon();term.loadAddon(fit);term.open(node);term.onData(data=>window.axiom.writeTerminal(info.id,data));session.term=term;session.fit=fit;session.node=node;}terminalState.sessions.set(info.id,session);terminalState.active=info.id;renderTerminalTabs();setPanelMode('terminal');fitActiveTerminal();}
function renderTerminalTabs(){const host=$('#terminalTabs');host.innerHTML='';terminalState.sessions.forEach((t,id)=>{const b=document.createElement('button');b.className='terminal-tab'+(id===terminalState.active?' active':'');b.textContent=(t.shell==='cmd'?'CMD':'PowerShell')+' '+id.split('-').pop();b.onclick=()=>{terminalState.active=id;renderTerminalTabs();renderActiveTerminal();};host.appendChild(b);});}
function renderActiveTerminal(){if(panelMode!=='terminal')return;const out=$('#terminalOutput'),host=$('#terminalHost'),row=$('.terminal-input-row'),t=terminalState.sessions.get(terminalState.active);host.style.display='block';for(const n of host.querySelectorAll('.xterm-session'))n.style.display=n.dataset.id===terminalState.active?'block':'none';if(t?.term){out.style.display='none';row.style.display='none';fitActiveTerminal();t.term.focus();}else{host.style.display=t?'none':'block';out.style.display='block';row.style.display=t?'flex':'none';out.textContent=t?.buffer||'No hay terminal activa. Pulsa + para crear una.';out.scrollTop=out.scrollHeight;if(t)$('#terminalPrompt').textContent=t.shell==='cmd'?'CMD>':'PS>';}}
async function closeActiveTerminal(){const id=terminalState.active;if(!id)return;const t=terminalState.sessions.get(id);await window.axiom.killTerminal(id);try{t?.term?.dispose();t?.node?.remove();}catch{}terminalState.sessions.delete(id);terminalState.active=[...terminalState.sessions.keys()].pop()||null;renderTerminalTabs();renderActiveTerminal();}
async function execPersistentTerminal(command){let t=terminalState.sessions.get(terminalState.active);if(!t){await newTerminal();t=terminalState.sessions.get(terminalState.active);}if(!t||!command.trim())return;t.history.push(command);t.historyPos=t.history.length;$('#terminalInput').value='';await window.axiom.writeTerminal(t.id,command+(t.pty?'\r':'\r\n'));}
window.axiom.onTerminalData(({id,data})=>{const t=terminalState.sessions.get(id);if(!t)return;if(t.term)t.term.write(String(data));else{t.buffer+=String(data).replace(/\x1B\[[0-?]*[ -\/]*[@-~]/g,'');if(t.buffer.length>500000)t.buffer=t.buffer.slice(-500000);if(id===terminalState.active)renderActiveTerminal();}});
window.axiom.onTerminalExit(({id,code})=>{const t=terminalState.sessions.get(id);if(!t)return;if(t.term)t.term.writeln('\r\n[proceso terminado: '+(code??'')+']');else{t.buffer+='\r\n[proceso terminado: '+(code??'')+']';if(id===terminalState.active)renderActiveTerminal();}});
function shellQuote(p){return '"'+String(p).replace(/"/g,'""')+'"';}
async function stopRunner(){
  const id=terminalState.active;
  if(!id){setStatus('Runner: no hay ejecución activa');return false;}
  await window.axiom.writeTerminal(id,'\x03');
  setStatus('Runner: señal de detención enviada');
  debugLog.push('Runner: detener '+id);
  return true;
}
async function runActiveFile(){
  if(window.AxiomScratch?.visible)return window.AxiomScratch.run();
  if(!activePath)return setStatus('No hay archivo activo');
  await saveActive();
  if(runnerInstalled){
    let plan;
    try{plan=await window.axiom.prepareRunner(activePath);}
    catch(e){showInfo('Runner','<p>'+escapeHtml(e.message)+'</p>');return;}
    if(!plan.supported){showInfo('Runner','<p>'+escapeHtml(plan.reason||'Tipo de archivo no compatible.')+'</p>');return;}
    if(!plan.available){showInfo('Runner',`<p>No se encontró un runtime para <b>${escapeHtml(plan.name||plan.extension)}</b>.</p><p>Buscado: ${escapeHtml((plan.candidates||[]).join(', ')||'runtime compatible')}.</p>`);return;}
    await newTerminal('powershell');
    debugLog.push('Runner: '+plan.name+' · '+activePath+' · '+plan.tool);
    await execPersistentTerminal(plan.command);
    setStatus('Runner: ejecutando '+basename(activePath)+' con '+plan.name);
    return;
  }
  const ext=(activePath.split('.').pop()||'').toLowerCase();let cmd='';
  if(['js','mjs','cjs'].includes(ext))cmd=`node ${shellQuote(activePath)}`;
  else if(ext==='py')cmd=`python ${shellQuote(activePath)}`;
  else if(ext==='ps1')cmd=`powershell -ExecutionPolicy Bypass -File ${shellQuote(activePath)}`;
  else if(['bat','cmd'].includes(ext))cmd=`cmd /c ${shellQuote(activePath)}`;
  else if(ext==='php')cmd=`php ${shellQuote(activePath)}`;
  else return showInfo('Ejecutar','No hay ejecutor configurado para <b>'+escapeHtml(ext||'este tipo de archivo')+'</b>. Instala Runner para más lenguajes.');
  await newTerminal('powershell');debugLog.push('Ejecutando '+activePath);await execPersistentTerminal(cmd);setStatus('Ejecutando '+basename(activePath));
}
const commands=[
{name:'Archivo: Nuevo archivo',hint:'',run:createNewFile},{name:'Archivo: Abrir archivo...',hint:'Ctrl+O',run:openFiles},{name:'Archivo: Abrir carpeta...',hint:'Ctrl+K Ctrl+O',run:openWorkspace},{name:'Archivo: Guardar',hint:'Ctrl+S',run:saveActive},{name:'Archivo: Guardar todo',hint:'Ctrl+Shift+S',run:saveAll},{name:'Archivo: Cerrar editor',hint:'Ctrl+W',run:()=>activePath&&closeTab(activePath)},
{name:'Editor: Fijar/desfijar pestaña',hint:'',run:()=>activePath&&togglePinTab(activePath)},{name:'Editor: Cerrar otros editores',hint:'',run:()=>closeOtherTabs()},{name:'Editor: Cerrar editores a la derecha',hint:'',run:()=>closeTabsRight()},{name:'Editor: Cerrar editores no fijados',hint:'',run:closeUnpinnedTabs},
{name:'Scratch: Abrir editor de bloques',hint:'',run:()=>openScratchMode()},{name:'Ver: Explorador',hint:'Ctrl+Shift+E',run:()=>setSideMode('explorer')},{name:'Ver: Buscar',hint:'Ctrl+Shift+F',run:()=>setSideMode('search')},{name:'Ver: Control de código fuente',hint:'Ctrl+Shift+G',run:()=>setSideMode('scm')},{name:'Ver: Esquema (Outline)',hint:'',run:()=>setSideMode('outline')},{name:'Ver: Extensiones',hint:'Ctrl+Shift+X',run:()=>setSideMode('extensions')},{name:'Ver: Alternar barra lateral',hint:'Ctrl+B',run:()=>toggleSidebar()},{name:'Ver: Alternar panel',hint:'Ctrl+J',run:()=>togglePanel()},
{name:'Ejecutar: Archivo activo',hint:'F5',run:runActiveFile},{name:'Runner: Abrir',hint:'',run:openRunnerMode},{name:'Runner: Detener ejecución',hint:'',run:stopRunner},{name:'Terminal: Nueva PowerShell',hint:'',run:()=>newTerminal('powershell')},{name:'Terminal: Nueva CMD',hint:'',run:()=>newTerminal('cmd')},{name:'Terminal: Cerrar activa',hint:'',run:closeActiveTerminal},{name:'Git: Actualizar estado',hint:'',run:updateGit},{name:'Archivo: Revelar en Explorador',hint:'',run:()=>activePath&&window.axiom.reveal(activePath)},
{name:'Proyecto: Ir a símbolo en el espacio de trabajo',hint:'Ctrl+T',run:()=>showPalette('symbols')},{name:'Editor: Formatear documento',hint:'Shift+Alt+F',run:()=>runEditorAction('editor.action.formatDocument')},{name:'Editor: Formatear selección',hint:'',run:()=>runEditorAction('editor.action.formatSelection')},{name:'Editor: Ir a línea',hint:'Ctrl+G',run:()=>runEditorAction('editor.action.gotoLine')},{name:'Editor: Ir a definición',hint:'F12',run:goToDefinition},{name:'Editor: Ver definición',hint:'Alt+F12',run:peekDefinition},{name:'Editor: Ir a referencias',hint:'Shift+F12',run:showReferences},{name:'Editor: Cambiar nombre de símbolo',hint:'F2',run:()=>runEditorAction('editor.action.rename')},{name:'Editor: Acción rápida',hint:'Ctrl+.',run:()=>runEditorAction('editor.action.quickFix')},{name:'Editor: Mostrar sugerencias',hint:'Ctrl+Espacio',run:()=>runEditorAction('editor.action.triggerSuggest')},{name:'Editor: Ir a símbolo...',hint:'Ctrl+Shift+O',run:()=>runEditorAction('editor.action.quickOutline')},{name:'Editor: Siguiente problema',hint:'F8',run:()=>runEditorAction('editor.action.marker.next')},{name:'Editor: Problema anterior',hint:'Shift+F8',run:()=>runEditorAction('editor.action.marker.prev')},{name:'Editor: Buscar',hint:'Ctrl+F',run:()=>runEditorAction('actions.find')},{name:'Editor: Reemplazar',hint:'Ctrl+H',run:()=>runEditorAction('editor.action.startFindReplaceAction')},{name:'Proyecto: Buscar y reemplazar',hint:'Ctrl+Shift+H',run:()=>{setSideMode('search');setTimeout(()=>$('#sideReplaceInput')?.focus(),30);}},{name:'Archivo: Abrir reciente...',hint:'Ctrl+R',run:showRecentWorkspaces},{name:'Preferencias: Settings',hint:'Ctrl+,',run:()=>window.AxiomPreferences?.open('settings')},{name:'Preferencias: Keyboard Shortcuts',hint:'Ctrl+K Ctrl+S',run:()=>window.AxiomPreferences?.open('keybindings')},{name:'Preferencias: Profiles',hint:'',run:()=>window.AxiomPreferences?.open('profiles')},{name:'Preferencias: Backup and Sync Settings',hint:'',run:()=>window.AxiomPreferences?.open('backup')},{name:'Ayuda: Buscar actualizaciones',hint:'',run:()=>checkForAppUpdates(true)}
];
function fuzzyScore(text,query){
  const source=String(text||'').toLowerCase(),needle=String(query||'').toLowerCase();
  if(!needle)return 1;
  const exact=source.indexOf(needle);
  if(exact>=0)return 1000-exact*2-Math.max(0,source.length-needle.length);
  let score=0,pos=-1,streak=0;
  for(const ch of needle){
    const next=source.indexOf(ch,pos+1);if(next<0)return 0;
    streak=next===pos+1?streak+1:0;
    score+=10+streak*4-Math.min(8,next-pos-1);
    pos=next;
  }
  return Math.max(1,score);
}
function parseQuickFileQuery(q){
  const raw=String(q||'').trim();
  const match=/^(.*?)(?::(\d+))?(?::(\d+))?$/.exec(raw);
  return {query:(match?.[1]||raw).trim(),line:match?.[2]?Number(match[2]):null,column:match?.[3]?Number(match[3]):1};
}
function renderPaletteItems(box){
  box.innerHTML='';
  if(!paletteItems.length){box.innerHTML='<div class="palette-empty">Sin resultados</div>';return;}
  paletteItems.forEach((it,idx)=>{
    const d=document.createElement('div');d.className='palette-item'+(idx===0?' active':'');
    d.innerHTML=`<span>${escapeHtml(it.name)}</span><span class="palette-hint">${escapeHtml(it.hint||'')}</span>`;
    d.onclick=()=>{hidePalette();it.run();};box.appendChild(d);
  });
}
function showPalette(mode='commands'){
  paletteMode=mode;$('#overlay').classList.remove('hidden');
  const input=$('#paletteInput');input.value='';
  input.placeholder=mode==='files'?'Buscar archivo (:línea:columna)...':mode==='symbols'?'Buscar símbolo en el proyecto...':'Escribe un comando...';
  buildPalette('');input.focus();
}
function hidePalette(){paletteBuildVersion++;$('#overlay').classList.add('hidden');}
async function buildPalette(q){
  const box=$('#paletteResults'),version=++paletteBuildVersion;
  if(paletteMode==='files'){
    const parsed=parseQuickFileQuery(q);
    const files=workspace?filesOf(workspace.tree):[];
    paletteItems=files.map(f=>({f,score:fuzzyScore(f.name+' '+relativeToWorkspace(f.path),parsed.query)}))
      .filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.f.name.localeCompare(b.f.name)).slice(0,100)
      .map(({f})=>({name:f.name,hint:relativeToWorkspace(f.path)+(parsed.line?':'+parsed.line+(parsed.column?':'+parsed.column:''):''),run:()=>openFile(f.path,parsed.line,parsed.column)}));
    renderPaletteItems(box);return;
  }
  if(paletteMode==='symbols'){
    if(!workspace){paletteItems=[];renderPaletteItems(box);return;}
    box.innerHTML='<div class="palette-empty">Buscando símbolos...</div>';
    try{
      const rows=await window.axiom.workspaceSymbols(workspace.root,q);
      if(version!==paletteBuildVersion||paletteMode!=='symbols')return;
      paletteItems=(rows||[]).map(s=>({name:s.name,hint:s.kind+' · '+relativeToWorkspace(s.path)+':'+s.line,run:()=>openFile(s.path,s.line,s.column)}));
      renderPaletteItems(box);
    }catch(error){
      if(version!==paletteBuildVersion)return;
      paletteItems=[];box.innerHTML='<div class="palette-empty">'+escapeHtml(error.message)+'</div>';
    }
    return;
  }
  const low=String(q||'').toLowerCase();
  paletteItems=[...commands,...extensionCommands.values()]
    .map(item=>({item,score:fuzzyScore(item.name+' '+(item.hint||''),low)}))
    .filter(x=>x.score>0).sort((a,b)=>b.score-a.score).map(x=>x.item);
  renderPaletteItems(box);
}
const menuModel={
file:[['Nuevo archivo',createNewFile],['Abrir archivo...',openFiles],['Abrir carpeta...',openWorkspace],['Abrir reciente...',showRecentWorkspaces],['Guardar',saveActive],['Guardar todo',saveAll],['Cerrar editor',()=>activePath&&closeTab(activePath)]],
edit:[['Deshacer',()=>editor?.trigger('menu','undo')],['Rehacer',()=>editor?.trigger('menu','redo')],['Buscar',()=>runEditorAction('actions.find')],['Reemplazar',()=>runEditorAction('editor.action.startFindReplaceAction')],['Buscar y reemplazar en archivos',()=>{setSideMode('search');setTimeout(()=>$('#sideReplaceInput')?.focus(),30);}],['Acción rápida',()=>runEditorAction('editor.action.quickFix')],['Cambiar nombre de símbolo',()=>runEditorAction('editor.action.rename')],['Formatear documento',()=>runEditorAction('editor.action.formatDocument')]],
selection:[['Seleccionar todo',()=>editor?.trigger('menu','selectAll')]],
view:[['Modo Scratch (bloques)',()=>openScratchMode()],['Explorador',()=>setSideMode('explorer')],['Buscar',()=>setSideMode('search')],['Control de código fuente',()=>setSideMode('scm')],['Ejecutar y depurar',()=>setSideMode('run')],['Esquema (Outline)',()=>setSideMode('outline')],['Extensiones',()=>setSideMode('extensions')],['Alternar barra lateral',()=>toggleSidebar()],['Alternar panel',()=>togglePanel()],['Paleta de comandos',()=>showPalette('commands')]],
go:[['Ir al archivo...',()=>showPalette('files')],['Ir a símbolo del proyecto...',()=>showPalette('symbols')],['Ir a línea...',()=>runEditorAction('editor.action.gotoLine')],['Ir a símbolo...',()=>runEditorAction('editor.action.quickOutline')],['Ir a definición',goToDefinition],['Ver definición',peekDefinition],['Ir a referencias',showReferences],['Siguiente problema',()=>runEditorAction('editor.action.marker.next')],['Problema anterior',()=>runEditorAction('editor.action.marker.prev')]],
run:[['Ejecutar archivo activo',runActiveFile],['Abrir Runner',openRunnerMode],['Detener ejecución',stopRunner],['Abrir vista Ejecutar y depurar',()=>setSideMode('run')]],
terminal:[['Nueva PowerShell',()=>newTerminal('powershell')],['Nuevo Command Prompt',()=>newTerminal('cmd')],['Cerrar terminal activa',closeActiveTerminal],['Mostrar/ocultar panel',()=>togglePanel()]],
help:[['Buscar actualizaciones...',()=>checkForAppUpdates(true)],['Acerca de AxiomCode',async()=>{const i=await window.axiom.appInfo();showInfo('AxiomCode',`<p>Versión ${escapeHtml(i.version)}</p><p>Electron ${escapeHtml(i.electron)} · Node ${escapeHtml(i.node)}</p><p>Editor inspirado en la arquitectura visual de VS Code.</p>`);}]]};
function closeMenus(){document.querySelector('.app-menu')?.remove();$$('.menubar button').forEach(b=>b.classList.remove('menu-open'));}
function showMenu(button,key){closeMenus();const m=document.createElement('div');m.className='app-menu';for(const [label,action] of menuModel[key]||[]){const b=document.createElement('button');b.textContent=label;b.onclick=()=>{closeMenus();action();};m.appendChild(b);}const r=button.getBoundingClientRect();m.style.left=r.left+'px';m.style.top=r.bottom+'px';document.body.appendChild(m);button.classList.add('menu-open');setTimeout(()=>document.addEventListener('pointerdown',e=>{if(!m.contains(e.target)&&e.target!==button)closeMenus();},{once:true}),0);}
function wireMenus(){$$('.menubar [data-menu]').forEach(b=>b.onclick=e=>{e.stopPropagation();if(b.classList.contains('menu-open'))closeMenus();else showMenu(b,b.dataset.menu);});}
function wireUI(){$('#updateBtn').onclick=()=>appUpdate?.available?installAppUpdate():checkForAppUpdates(true);$("#scratchBtn").onclick=()=>openScratchMode();$('#openBtn').onclick=openWorkspace;$('#saveBtn').onclick=saveActive;$('#refreshBtn').onclick=refreshWorkspace;$('#newFileBtn').onclick=createNewFile;$('#newFolderBtn').onclick=createNewFolder;$('#commandBtn').onclick=$('#welcomeCommand').onclick=()=>showPalette('commands');$('#explorerBtn').onclick=()=>setSideMode('explorer');$('#searchBtn').onclick=()=>setSideMode('search');$('#gitBtn').onclick=()=>setSideMode('scm');$('#runBtn').onclick=()=>setSideMode('run');$('#outlineBtn').onclick=()=>setSideMode('outline');$('#extensionsBtn').onclick=()=>setSideMode('extensions');$('#accountsBtn').onclick=()=>showInfo('Cuentas','<p>AxiomCode funciona actualmente en modo local. La sincronización de cuentas se añadirá como módulo.</p>');$('#terminalBtn').onclick=()=>{setPanelMode('terminal');if(!terminalState.sessions.size)newTerminal();};$('#closePanel').onclick=()=>togglePanel(false);$('#newTerminal').onclick=()=>newTerminal();$('#killTerminal').onclick=closeActiveTerminal;$('#problemsTab').onclick=()=>setPanelMode('problems');$('#outputTab').onclick=()=>setPanelMode('output');$('#debugTab').onclick=()=>setPanelMode('debug');$('#terminalTab').onclick=()=>setPanelMode('terminal');wireMenus();
$('#terminalInput').addEventListener('keydown',e=>{const t=terminalState.sessions.get(terminalState.active);if(e.key==='Enter')execPersistentTerminal(e.target.value);else if(e.key==='ArrowUp'&&t){e.preventDefault();if(t.historyPos>0)e.target.value=t.history[--t.historyPos]||'';}else if(e.key==='ArrowDown'&&t){e.preventDefault();if(t.historyPos<t.history.length-1)e.target.value=t.history[++t.historyPos]||'';else{t.historyPos=t.history.length;e.target.value='';}}});
$('#paletteInput').oninput=e=>buildPalette(e.target.value);$('#overlay').onclick=e=>{if(e.target===$('#overlay'))hidePalette();};$('#paletteInput').onkeydown=e=>{if(e.key==='Escape')hidePalette();if(e.key==='Enter'&&paletteItems[0]){hidePalette();paletteItems[0].run();}};}
function runPreferenceCommand(id){
  const actions={
    'workbench.action.openSettings':()=>window.AxiomPreferences?.open('settings'),
    'workbench.action.openKeyboardShortcuts':()=>window.AxiomPreferences?.open('keybindings'),
    'workbench.action.showCommands':()=>showPalette('commands'),
    'workbench.action.quickOpen':()=>showPalette('files'),
    'workbench.action.showAllSymbols':()=>showPalette('symbols'),
    'workbench.action.openRecent':showRecentWorkspaces,
    'workbench.action.files.openFile':openFiles,
    'workbench.action.files.save':saveActive,
    'workbench.view.explorer':()=>setSideMode('explorer'),
    'workbench.view.search':()=>setSideMode('search'),
    'workbench.view.scm':()=>setSideMode('scm'),
    'workbench.view.outline':()=>setSideMode('outline'),
    'workbench.view.extensions':()=>setSideMode('extensions'),
    'workbench.action.toggleSidebarVisibility':()=>toggleSidebar(),
    'workbench.action.togglePanel':()=>togglePanel(),
    'workbench.action.terminal.toggleTerminal':()=>{setPanelMode('terminal');if(!terminalState.sessions.size)newTerminal();},
    'workbench.action.debug.run':runActiveFile
  };
  actions[id]?.();
}
function setupShortcuts(){window.addEventListener('keydown',e=>{if(window.AxiomPreferences?.handleKeydown(e))return;const ctrl=e.ctrlKey||e.metaKey,k=e.key.toLowerCase();if(ctrl&&k==='s'&&!e.shiftKey){e.preventDefault();saveActive();}else if(ctrl&&e.shiftKey&&k==='s'){e.preventDefault();saveAll();}else if(ctrl&&k==='o'){e.preventDefault();openFiles();}else if(ctrl&&k==='w'){e.preventDefault();if(activePath)closeTab(activePath);}else if(ctrl&&!e.shiftKey&&k==='p'){e.preventDefault();showPalette('files');}else if(ctrl&&!e.shiftKey&&k==='t'){e.preventDefault();showPalette('symbols');}else if(ctrl&&e.shiftKey&&k==='p'){e.preventDefault();showPalette('commands');}else if(ctrl&&e.shiftKey&&k==='e'){e.preventDefault();setSideMode('explorer');}else if(ctrl&&e.shiftKey&&k==='f'){e.preventDefault();setSideMode('search');}else if(ctrl&&e.shiftKey&&k==='h'){e.preventDefault();setSideMode('search');setTimeout(()=>$('#sideReplaceInput')?.focus(),30);}else if(ctrl&&!e.shiftKey&&k==='r'){e.preventDefault();showRecentWorkspaces();}else if(ctrl&&e.shiftKey&&k==='o'){e.preventDefault();runEditorAction('editor.action.quickOutline');}else if(ctrl&&e.shiftKey&&k==='g'){e.preventDefault();setSideMode('scm');}else if(ctrl&&e.shiftKey&&k==='x'){e.preventDefault();setSideMode('extensions');}else if(ctrl&&k==='b'){e.preventDefault();toggleSidebar();}else if(ctrl&&k==='j'){e.preventDefault();togglePanel();}else if(ctrl&&e.key==='`'){e.preventDefault();setPanelMode('terminal');if(!terminalState.sessions.size)newTerminal();}else if(e.key==='F2'){e.preventDefault();runEditorAction('editor.action.rename');}else if(e.key==='F8'&&!e.shiftKey){e.preventDefault();runEditorAction('editor.action.marker.next');}else if(e.key==='F8'&&e.shiftKey){e.preventDefault();runEditorAction('editor.action.marker.prev');}else if(e.key==='F12'&&!e.shiftKey&&!e.altKey){e.preventDefault();goToDefinition();}else if(e.key==='F12'&&e.shiftKey){e.preventDefault();showReferences();}else if(e.key==='F12'&&e.altKey){e.preventDefault();peekDefinition();}else if(e.key==='F5'){e.preventDefault();runActiveFile();}else if(e.key==='Escape'){hidePalette();closeMenus();}});}
async function setupSettings(){
  return window.AxiomPreferences?.init({
    getEditor:()=>editor,
    getWorkspace:()=>workspace,
    openFile,
    setSideMode,
    showPalette,
    checkUpdates:checkForAppUpdates,
    runCommand:runPreferenceCommand,
    askInput,
    info:showInfo,
    status:setStatus,
    terminalSessions:()=>terminalState.sessions,
    layout:()=>{editor?.layout();fitActiveTerminal();},
    about:async()=>{const i=await window.axiom.appInfo();showInfo('AxiomCode',`<p>Versión ${escapeHtml(i.version)}</p><p>Electron ${escapeHtml(i.electron)} · Node ${escapeHtml(i.node)}</p><p>Editor inspirado en la arquitectura visual de VS Code.</p>`);}
  });
}
let externalChangeTimer;
window.axiom.onWorkspaceFileChanged(change=>{if(!workspace||change.root!==workspace.root)return;clearTimeout(externalChangeTimer);externalChangeTimer=setTimeout(async()=>{try{workspace=await window.axiom.refreshWorkspace(workspace.root);if(sideMode==='explorer')renderSideView();const tab=tabs.get(change.path);if(tab&&!tab.dirty){const r=await window.axiom.readFile(change.path);if(r.content!==tab.model.getValue()){tab.model.setValue(r.content);tab.dirty=false;renderTabs();logOutput('Recargado por cambio externo: '+change.path);}}}catch{}},180);});
const iconsReady=window.axiom.getIconManifest().then(m=>{iconManifest=m;}).catch(()=>setStatus('Tema de iconos no disponible'));
const monacoVsUrl=new URL('../node_modules/monaco-editor/min/vs',location.href).href.replace(/\/$/,'');
require.config({paths:{vs:monacoVsUrl}});
require(['vs/editor/editor.main'],async()=>{
await iconsReady;
monaco.editor.defineTheme('axiom-vscode-dark',{base:'vs-dark',inherit:true,rules:[{token:'comment',foreground:'6A9955'},{token:'keyword',foreground:'C586C0'},{token:'string',foreground:'CE9178'},{token:'number',foreground:'B5CEA8'},{token:'type',foreground:'4EC9B0'}],colors:{'editor.background':'#1F1F1F','editor.foreground':'#CCCCCC','editorLineNumber.foreground':'#6E7681','editorLineNumber.activeForeground':'#CCCCCC','editorCursor.foreground':'#AEAFAD','editor.selectionBackground':'#264F78','editor.inactiveSelectionBackground':'#3A3D41','editorIndentGuide.background1':'#404040','editorIndentGuide.activeBackground1':'#707070','editorWidget.background':'#202020','editorWidget.border':'#454545','editorSuggestWidget.background':'#202020','editorSuggestWidget.border':'#454545','editorSuggestWidget.selectedBackground':'#04395E'}});
editor=monaco.editor.create($('#editor'),{theme:'axiom-vscode-dark',automaticLayout:true,fontFamily:'Cascadia Code, Consolas, monospace',fontLigatures:true,fontSize:14,lineHeight:21,minimap:{enabled:true,scale:1},smoothScrolling:true,cursorSmoothCaretAnimation:'on',bracketPairColorization:{enabled:true},guides:{bracketPairs:true,indentation:true},wordWrap:'off',renderWhitespace:'selection',padding:{top:5,bottom:5},scrollBeyondLastLine:false,stickyScroll:{enabled:true},formatOnPaste:false,formatOnType:false});
editor.onDidChangeModelContent(()=>{if(!activePath)return;const t=tabs.get(activePath);if(t&&!t.dirty){t.dirty=true;renderTabs();}clearTimeout(autoSaveTimer);if(window.AxiomPreferences?.getSetting('files.autoSave')==='afterDelay'){const delay=Math.max(100,Number(window.AxiomPreferences.getSetting('files.autoSaveDelay'))||1000);autoSaveTimer=setTimeout(()=>{if(activePath&&tabs.get(activePath)?.dirty)saveActive();},delay);}});
editor.onDidChangeCursorPosition(e=>{$('#cursorPos').textContent=`Ln ${e.position.lineNumber}, Col ${e.position.column}`;});
try{
  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({noSyntaxValidation:false,noSemanticValidation:false,noSuggestionDiagnostics:false});
  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({noSyntaxValidation:false,noSemanticValidation:false,noSuggestionDiagnostics:false});
}catch(e){logOutput('Diagnósticos JS/TS: '+e.message);}
monaco.editor.onDidCreateModel(model=>wireModelDiagnostics(model));
if(monaco.editor.onDidChangeModelLanguage)monaco.editor.onDidChangeModelLanguage(e=>{wireModelDiagnostics(e.model);scheduleModelDiagnostics(e.model,30);});
for(const model of monaco.editor.getModels())wireModelDiagnostics(model);
monaco.editor.onDidChangeMarkers(()=>{updateProblemBadge();if(panelMode==='problems')renderPanelContent();});
editor.onDidChangeModel(()=>{const model=editor.getModel();if(model)scheduleModelDiagnostics(model,30);updateProblemBadge();if(panelMode==='problems')renderPanelContent();if(sideMode==='outline')renderSideView();});
editor.addAction({id:'axiom.save',label:'Guardar archivo',keybindings:[monaco.KeyMod.CtrlCmd|monaco.KeyCode.KeyS],run:saveActive});
editor.addAction({id:'axiom.problems',label:'Mostrar problemas',keybindings:[monaco.KeyMod.CtrlCmd|monaco.KeyMod.Shift|monaco.KeyCode.KeyM],run:()=>setPanelMode('problems')});
wireUI();setupShortcuts();await setupSettings();await refreshExtensionState();renderSideView();renderTabs();showCode(false);const restored=await window.axiom.restoreWorkspace();if(restored)useWorkspace(restored,true);else setStatus('AxiomCode listo');logOutput('Workbench iniciado');renderUpdateButton();if(window.AxiomPreferences?.getSetting('update.autoCheck')!==false){setTimeout(()=>checkForAppUpdates(false),1500);setInterval(()=>checkForAppUpdates(false),4*60*60*1000);}
window.axiom.rendererReady({monaco:true,materialIcons:Object.keys(iconManifest?.iconDefinitions||{}).length,ui:'vscode-dark-modern',views:['explorer','search','scm','run','extensions'],menus:true});
if(new URLSearchParams(location.search).has('scratch'))openScratchMode();
});