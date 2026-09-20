(() => {
  'use strict';

  const $ = s => document.querySelector(s);
  const clone = v => JSON.parse(JSON.stringify(v));
  const getPath = (obj,key) => String(key).split('.').reduce((v,k)=>v?.[k],obj);
  const setPath = (obj,key,value) => {
    const keys=String(key).split('.');
    let target=obj;
    for(const k of keys.slice(0,-1)) target=target[k]??={};
    target[keys.at(-1)]=value;
    return obj;
  };
  const merge = (a,b) => {
    const out=clone(a||{});
    for(const [k,v] of Object.entries(b||{})) {
      if(v&&typeof v==='object'&&!Array.isArray(v)) out[k]=merge(out[k]||{},v);
      else out[k]=clone(v);
    }
    return out;
  };
  const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  const SETTINGS = [
    {group:'Editor',key:'editor.fontSize',label:'Font Size',desc:'Controla el tamaño de fuente del editor.',type:'number',min:10,max:40,step:1},
    {group:'Editor',key:'editor.fontFamily',label:'Font Family',desc:'Familia tipográfica usada por Monaco.',type:'text'},
    {group:'Editor',key:'editor.lineHeight',label:'Line Height',desc:'Altura de línea del editor.',type:'number',min:14,max:60,step:1},
    {group:'Editor',key:'editor.wordWrap',label:'Word Wrap',desc:'Ajusta líneas largas al ancho del editor.',type:'select',options:[['off','Off'],['on','On'],['wordWrapColumn','Word Wrap Column'],['bounded','Bounded']]},
    {group:'Editor',key:'editor.minimap.enabled',label:'Minimap',desc:'Muestra el minimapa del archivo.',type:'boolean'},
    {group:'Editor',key:'editor.renderWhitespace',label:'Render Whitespace',desc:'Controla cuándo se muestran espacios y tabulaciones.',type:'select',options:[['none','None'],['boundary','Boundary'],['selection','Selection'],['trailing','Trailing'],['all','All']]},
    {group:'Editor',key:'editor.stickyScroll.enabled',label:'Sticky Scroll',desc:'Mantiene encabezados de código visibles al desplazarte.',type:'boolean'},
    {group:'Editor',key:'editor.smoothScrolling',label:'Smooth Scrolling',desc:'Activa desplazamiento suave.',type:'boolean'},
    {group:'Editor',key:'editor.bracketPairColorization.enabled',label:'Bracket Pair Colorization',desc:'Colorea pares de corchetes.',type:'boolean'},
    {group:'Editor',key:'editor.formatOnPaste',label:'Format On Paste',desc:'Formatea automáticamente al pegar cuando el proveedor lo soporta.',type:'boolean'},
    {group:'Editor',key:'editor.formatOnType',label:'Format On Type',desc:'Formatea mientras escribes cuando el lenguaje lo soporta.',type:'boolean'},
    {group:'Editor',key:'editor.tabSize',label:'Tab Size',desc:'Número de espacios por tabulación.',type:'number',min:1,max:16,step:1},
    {group:'Workbench',key:'workbench.colorTheme',label:'Color Theme',desc:'Tema general de AxiomCode.',type:'select',options:[['AxiomCode Dark Modern','AxiomCode Dark Modern'],['AxiomCode Light Modern','AxiomCode Light Modern'],['AxiomCode High Contrast','AxiomCode High Contrast']]},
    {group:'Workbench',key:'workbench.iconTheme',label:'File Icon Theme',desc:'Tema de iconos del explorador.',type:'select',options:[['material','Material Icon Theme'],['none','None']]},
    {group:'Workbench',key:'workbench.activityBarVisible',label:'Activity Bar: Visible',desc:'Muestra la barra de actividad lateral.',type:'boolean'},
    {group:'Workbench',key:'workbench.commandCenterVisible',label:'Command Center: Visible',desc:'Muestra el centro de comandos en la barra de título.',type:'boolean'},
    {group:'Workbench',key:'workbench.restoreLastWorkspace',label:'Restore Last Workspace',desc:'Restaura la última carpeta al iniciar.',type:'boolean'},
    {group:'Files',key:'files.autoSave',label:'Auto Save',desc:'Guarda archivos automáticamente después de un retraso.',type:'select',options:[['off','Off'],['afterDelay','After Delay']]},
    {group:'Files',key:'files.autoSaveDelay',label:'Auto Save Delay',desc:'Milisegundos antes de guardar automáticamente.',type:'number',min:100,max:60000,step:100},
    {group:'Terminal',key:'terminal.defaultProfile',label:'Default Profile: Windows',desc:'Shell predeterminado para nuevas terminales.',type:'select',options:[['powershell','PowerShell'],['cmd','Command Prompt']]},
    {group:'Terminal',key:'terminal.fontSize',label:'Terminal Font Size',desc:'Tamaño de fuente de terminales integradas.',type:'number',min:9,max:30,step:1},
    {group:'Terminal',key:'terminal.scrollback',label:'Terminal Scrollback',desc:'Número máximo de líneas conservadas.',type:'number',min:100,max:100000,step:100},
    {group:'Update',key:'update.autoCheck',label:'Update: Auto Check',desc:'Comprueba automáticamente nuevas versiones.',type:'boolean'}
  ];

  const KEYBINDINGS = [
    ['workbench.action.openSettings','Settings','Ctrl+,'],
    ['workbench.action.openKeyboardShortcuts','Keyboard Shortcuts','Ctrl+K Ctrl+S'],
    ['workbench.action.showCommands','Command Palette','Ctrl+Shift+P'],
    ['workbench.action.quickOpen','Quick Open','Ctrl+P'],
    ['workbench.action.files.openFile','Open File','Ctrl+O'],
    ['workbench.action.files.save','Save','Ctrl+S'],
    ['workbench.view.explorer','Explorer','Ctrl+Shift+E'],
    ['workbench.view.search','Search','Ctrl+Shift+F'],
    ['workbench.view.scm','Source Control','Ctrl+Shift+G'],
    ['workbench.view.extensions','Extensions','Ctrl+Shift+X'],
    ['workbench.action.toggleSidebarVisibility','Toggle Primary Side Bar','Ctrl+B'],
    ['workbench.action.togglePanel','Toggle Panel','Ctrl+J'],
    ['workbench.action.terminal.toggleTerminal','Toggle Terminal','Ctrl+\`'],
    ['workbench.action.debug.run','Run Active File','F5']
  ];

  const state={hooks:null,user:{},workspace:{},scope:'user',section:'settings',search:'',settingsPath:null,pendingChord:null,pendingChordTimer:null};

  function activeConfig(){ return merge(state.user,state.workspace); }
  function snapshot(config=state.user){
    return {
      editor:clone(config.editor||{}),
      workbench:clone(config.workbench||{}),
      files:clone(config.files||{}),
      terminal:clone(config.terminal||{}),
      update:clone(config.update||{}),
      keybindings:clone(config.keybindings||{})
    };
  }
  function sepJoin(root,...parts){
    const sep=String(root).includes('\\')?'\\':'/';
    return [String(root).replace(/[\\/]$/,''),...parts].join(sep);
  }
  async function loadWorkspaceSettings(){
    state.workspace={};
    const w=state.hooks?.getWorkspace?.();
    if(!w?.root)return state.workspace;
    const p=sepJoin(w.root,'.axiomcode','settings.json');
    try{state.workspace=JSON.parse((await window.axiom.readFile(p)).content)||{};}catch{}
    return state.workspace;
  }
  async function saveWorkspaceSettings(){
    const w=state.hooks?.getWorkspace?.();
    if(!w?.root)throw new Error('No hay un workspace abierto');
    const dir=sepJoin(w.root,'.axiomcode'), p=sepJoin(dir,'settings.json');
    try{await window.axiom.createFile(dir,true);}catch{}
    try{await window.axiom.createFile(p,false);}catch{}
    await window.axiom.writeFile(p,JSON.stringify(state.workspace,null,2));
  }
  async function refresh(){
    state.user=await window.axiom.getConfig();
    await loadWorkspaceSettings();
    apply(activeConfig());
  }

  function defineThemes(){
    const monaco=window.monaco;
    if(!monaco?.editor)return;
    try{
      monaco.editor.defineTheme('axiom-light',{base:'vs',inherit:true,rules:[],colors:{'editor.background':'#FFFFFF','editor.foreground':'#1F2328','editorLineNumber.foreground':'#6E7781','editorLineNumber.activeForeground':'#24292F','editor.selectionBackground':'#ADD6FF','editor.inactiveSelectionBackground':'#E5EBF1'}});
      monaco.editor.defineTheme('axiom-hc',{base:'hc-black',inherit:true,rules:[],colors:{'editor.background':'#000000','editor.foreground':'#FFFFFF','editorCursor.foreground':'#FFFFFF','editor.selectionBackground':'#264F78'}});
    }catch{}
  }
  function apply(cfg){
    const ed=state.hooks?.getEditor?.();
    defineThemes();
    const theme=cfg?.workbench?.colorTheme||'AxiomCode Dark Modern';
    document.body.classList.toggle('theme-light',theme==='AxiomCode Light Modern');
    document.body.classList.toggle('theme-hc',theme==='AxiomCode High Contrast');
    document.body.classList.toggle('icons-none',cfg?.workbench?.iconTheme==='none');
    document.body.classList.toggle('hide-activity',cfg?.workbench?.activityBarVisible===false);
    document.body.classList.toggle('hide-command-center',cfg?.workbench?.commandCenterVisible===false);
    try{
      if(window.monaco?.editor){
        const id=theme==='AxiomCode Light Modern'?'axiom-light':theme==='AxiomCode High Contrast'?'axiom-hc':'axiom-vscode-dark';
        window.monaco.editor.setTheme(id);
      }
      ed?.updateOptions({
        fontSize:Number(cfg?.editor?.fontSize)||14,
        fontFamily:cfg?.editor?.fontFamily||'Cascadia Code, Consolas, monospace',
        lineHeight:Number(cfg?.editor?.lineHeight)||21,
        wordWrap:cfg?.editor?.wordWrap||'off',
        minimap:{enabled:cfg?.editor?.minimap?.enabled!==false,scale:1},
        renderWhitespace:cfg?.editor?.renderWhitespace||'selection',
        stickyScroll:{enabled:cfg?.editor?.stickyScroll?.enabled!==false},
        smoothScrolling:cfg?.editor?.smoothScrolling!==false,
        bracketPairColorization:{enabled:cfg?.editor?.bracketPairColorization?.enabled!==false},
        formatOnPaste:Boolean(cfg?.editor?.formatOnPaste),
        formatOnType:Boolean(cfg?.editor?.formatOnType),
        tabSize:Number(cfg?.editor?.tabSize)||4
      });
      const shell=$('#terminalShell'); if(shell)shell.value=cfg?.terminal?.defaultProfile||'powershell';
      for(const t of state.hooks?.terminalSessions?.()?.values?.()||[]){
        if(t.term){t.term.options.fontSize=Number(cfg?.terminal?.fontSize)||13;t.term.options.scrollback=Number(cfg?.terminal?.scrollback)||5000;}
      }
    }catch{}
    state.hooks?.layout?.();
  }

  async function setSetting(key,value){
    if(state.scope==='workspace'){
      setPath(state.workspace,key,value);
      await saveWorkspaceSettings();
    }else{
      await window.axiom.setConfigValue(key,value);
      setPath(state.user,key,value);
    }
    apply(activeConfig());
  }

  function ensureOverlay(){
    if($('#preferencesOverlay'))return;
    const back=document.createElement('div');
    back.id='preferencesOverlay';
    back.className='preferences-overlay hidden';
    back.innerHTML='<div class="preferences-shell"><header class="preferences-head"><div><span class="codicon codicon-settings-gear"></span><strong>Manage</strong><span id="preferencesProfile"></span></div><button id="preferencesClose" title="Cerrar"><span class="codicon codicon-close"></span></button></header><div class="preferences-body"><nav class="preferences-nav"><button data-pref="settings"><span class="codicon codicon-settings"></span>Settings</button><button data-pref="keybindings"><span class="codicon codicon-keyboard"></span>Keyboard Shortcuts</button><button data-pref="profiles"><span class="codicon codicon-account"></span>Profiles</button><button data-pref="backup"><span class="codicon codicon-sync"></span>Backup & Sync</button></nav><main id="preferencesContent" class="preferences-content"></main></div></div>';
    document.body.appendChild(back);
    $('#preferencesClose').onclick=close;
    back.onclick=e=>{if(e.target===back)close();};
    back.querySelectorAll('[data-pref]').forEach(b=>b.onclick=()=>{state.section=b.dataset.pref;render();});
  }

  function open(section='settings'){
    ensureOverlay();state.section=section;
    $('#preferencesOverlay').classList.remove('hidden');
    render();
  }
  function close(){$('#preferencesOverlay')?.classList.add('hidden');}

  function render(){
    ensureOverlay();
    document.querySelectorAll('.preferences-nav [data-pref]').forEach(b=>b.classList.toggle('active',b.dataset.pref===state.section));
    const active=state.user?.profiles?.active||'Default';
    $('#preferencesProfile').textContent=active==='Default'?'':'· '+active;
    if(state.section==='settings')renderSettings();
    else if(state.section==='keybindings')renderKeybindings();
    else if(state.section==='profiles')renderProfiles();
    else renderBackup();
  }

  function renderSettings(){
    const host=$('#preferencesContent');
    host.innerHTML='<div class="settings-toolbar"><div class="settings-search"><span class="codicon codicon-search"></span><input id="settingsSearch" placeholder="Search settings"></div><div class="settings-scope"><button data-scope="user">User</button><button data-scope="workspace">Workspace</button></div><button id="openSettingsJson" class="secondary-button">Open Settings (JSON)</button></div><div id="settingsRows"></div>';
    const workspaceButton=host.querySelector('[data-scope="workspace"]');
    workspaceButton.disabled=!state.hooks?.getWorkspace?.();
    host.querySelectorAll('[data-scope]').forEach(b=>{b.classList.toggle('active',b.dataset.scope===state.scope);b.onclick=()=>{state.scope=b.dataset.scope;renderSettings();};});
    $('#settingsSearch').value=state.search;
    $('#settingsSearch').oninput=e=>{state.search=e.target.value;drawSettingsRows();};
    $('#openSettingsJson').onclick=async()=>{state.settingsPath=await window.axiom.getConfigPath();state.hooks?.openFile?.(state.settingsPath);close();};
    drawSettingsRows();
  }

  function drawSettingsRows(){
    const host=$('#settingsRows'); if(!host)return;
    const source=state.scope==='workspace'?state.workspace:state.user;
    const effective=activeConfig();
    const q=state.search.trim().toLowerCase();
    const filtered=SETTINGS.filter(x=>(x.group+' '+x.label+' '+x.key+' '+x.desc).toLowerCase().includes(q));
    let html='',group='';
    for(const s of filtered){
      if(group!==s.group){group=s.group;html+='<h3 class="settings-group">'+escapeHtml(group)+'</h3>';}
      const own=getPath(source,s.key), value=own===undefined?getPath(effective,s.key):own;
      let control='';
      if(s.type==='boolean')control='<label class="switch"><input type="checkbox" data-setting="'+s.key+'" '+(value?'checked':'')+'><span></span></label>';
      else if(s.type==='select')control='<select data-setting="'+s.key+'">'+s.options.map(([v,l])=>'<option value="'+escapeHtml(v)+'" '+(String(value)===String(v)?'selected':'')+'>'+escapeHtml(l)+'</option>').join('')+'</select>';
      else control='<input data-setting="'+s.key+'" type="'+(s.type==='number'?'number':'text')+'" value="'+escapeHtml(value??'')+'" '+(s.min!==undefined?'min="'+s.min+'"':'')+' '+(s.max!==undefined?'max="'+s.max+'"':'')+' '+(s.step!==undefined?'step="'+s.step+'"':'')+'>';
      html+='<div class="setting-row"><div><strong>'+escapeHtml(s.label)+'</strong><code>'+escapeHtml(s.key)+'</code><p>'+escapeHtml(s.desc)+'</p></div><div class="setting-control">'+control+(own!==undefined&&state.scope==='workspace'?'<button class="setting-reset" data-reset="'+s.key+'" title="Remove workspace override"><span class="codicon codicon-discard"></span></button>':'')+'</div></div>';
    }
    host.innerHTML=html||'<div class="preferences-empty">No settings found.</div>';
    host.querySelectorAll('[data-setting]').forEach(el=>el.onchange=async()=>{
      const def=SETTINGS.find(x=>x.key===el.dataset.setting);
      const value=def.type==='boolean'?el.checked:def.type==='number'?Number(el.value):el.value;
      await setSetting(def.key,value);
      state.hooks?.status?.(def.label+' actualizado');
    });
    host.querySelectorAll('[data-reset]').forEach(b=>b.onclick=async()=>{
      const keys=b.dataset.reset.split('.');let target=state.workspace;
      for(const k of keys.slice(0,-1))target=target?.[k];
      if(target)delete target[keys.at(-1)];
      await saveWorkspaceSettings();apply(activeConfig());renderSettings();
    });
  }

  function renderKeybindings(){
    const host=$('#preferencesContent'), configured=state.user.keybindings||{};
    host.innerHTML='<div class="settings-toolbar"><div><h2>Keyboard Shortcuts</h2><p>Personaliza atajos sin perder los predeterminados.</p></div><button id="resetKeybindings" class="secondary-button">Reset</button></div><div class="keybindings-table">'+KEYBINDINGS.map(([id,label,def])=>'<div class="keybinding-row"><div><strong>'+escapeHtml(label)+'</strong><code>'+escapeHtml(id)+'</code></div><input data-keybinding="'+escapeHtml(id)+'" value="'+escapeHtml(configured[id]||def)+'" placeholder="'+escapeHtml(def)+'"><small>'+escapeHtml(def)+'</small></div>').join('')+'</div>';
    host.querySelectorAll('[data-keybinding]').forEach(input=>input.onchange=async()=>{await window.axiom.setConfigValue('keybindings.'+input.dataset.keybinding,input.value.trim());state.user=await window.axiom.getConfig();});
    $('#resetKeybindings').onclick=async()=>{await window.axiom.setConfigValue('keybindings',{});state.user=await window.axiom.getConfig();renderKeybindings();};
  }

  async function saveActiveProfileSnapshot(){
    const profiles=state.user.profiles||{active:'Default',items:{}};
    profiles.items||={};
    profiles.items[profiles.active||'Default']=snapshot(state.user);
    await window.axiom.setConfigValue('profiles',profiles);
    state.user.profiles=profiles;
  }
  async function createProfile(){
    const name=String(await state.hooks?.askInput?.('Nombre del perfil:')||'').trim();
    if(!name)return;
    if(name.length>60)throw new Error('Nombre de perfil demasiado largo');
    await saveActiveProfileSnapshot();
    const profiles=state.user.profiles||{active:'Default',items:{}};
    if(profiles.items[name])throw new Error('Ese perfil ya existe');
    profiles.items[name]=snapshot(state.user);
    profiles.active=name;
    await window.axiom.setConfigValue('profiles',profiles);
    state.user=await window.axiom.getConfig();renderProfiles();state.hooks?.status?.('Perfil creado: '+name);
  }
  async function switchProfile(name){
    await saveActiveProfileSnapshot();
    state.user=await window.axiom.getConfig();
    const profiles=state.user.profiles||{active:'Default',items:{}};
    const target=profiles.items?.[name]||snapshot(await window.axiom.getConfigDefaults());
    profiles.active=name;
    await window.axiom.setConfigValues({
      editor:target.editor||{},workbench:target.workbench||{},files:target.files||{},terminal:target.terminal||{},update:target.update||{},keybindings:target.keybindings||{},profiles
    });
    state.user=await window.axiom.getConfig();apply(activeConfig());render();state.hooks?.status?.('Perfil activo: '+name);
  }
  async function deleteProfile(name){
    if(name==='Default')return;
    const profiles=state.user.profiles||{active:'Default',items:{}};
    delete profiles.items?.[name];
    if(profiles.active===name)profiles.active='Default';
    await window.axiom.setConfigValue('profiles',profiles);
    state.user=await window.axiom.getConfig();
    if(profiles.active==='Default')await switchProfile('Default');else renderProfiles();
  }
  function renderProfiles(){
    const host=$('#preferencesContent'),profiles=state.user.profiles||{active:'Default',items:{}}, names=['Default',...Object.keys(profiles.items||{}).filter(x=>x!=='Default')];
    host.innerHTML='<div class="settings-toolbar"><div><h2>Profiles</h2><p>Perfiles aislados de settings, atajos y apariencia.</p></div><button id="newProfile" class="primary-button">New Profile</button></div><div class="profiles-list">'+names.map(name=>'<div class="profile-card '+(profiles.active===name?'active':'')+'"><div class="profile-avatar">'+escapeHtml(name.slice(0,2).toUpperCase())+'</div><div><strong>'+escapeHtml(name)+'</strong><span>'+(profiles.active===name?'Active Profile':'Configuration profile')+'</span></div><div class="profile-actions">'+(profiles.active!==name?'<button data-switch-profile="'+escapeHtml(name)+'">Use</button>':'<span class="profile-active">Active</span>')+(name!=='Default'?'<button data-delete-profile="'+escapeHtml(name)+'" title="Delete"><span class="codicon codicon-trash"></span></button>':'')+'</div></div>').join('')+'</div>';
    $('#newProfile').onclick=()=>createProfile().catch(e=>state.hooks?.info?.('Profiles','<p>'+escapeHtml(e.message)+'</p>'));
    host.querySelectorAll('[data-switch-profile]').forEach(b=>b.onclick=()=>switchProfile(b.dataset.switchProfile));
    host.querySelectorAll('[data-delete-profile]').forEach(b=>b.onclick=()=>deleteProfile(b.dataset.deleteProfile));
  }

  function renderBackup(){
    const host=$('#preferencesContent');
    host.innerHTML='<div class="backup-page"><h2>Backup & Sync Settings</h2><p>Guarda un paquete portable con Settings, Profiles, Keyboard Shortcuts y el estado de extensiones. Puedes restaurarlo en otra instalación de AxiomCode.</p><div class="backup-actions"><button id="exportPrefs" class="primary-button"><span class="codicon codicon-export"></span> Export Preferences</button><button id="importPrefs" class="secondary-button"><span class="codicon codicon-cloud-download"></span> Import Preferences</button></div><div class="callout-local"><strong>Sincronización:</strong> esta versión usa backup/importación portable. No envía tu configuración a un servicio cloud externo.</div><hr><button id="resetPrefs" class="danger-button">Reset All Settings</button></div>';
    $('#exportPrefs').onclick=async()=>{const p=await window.axiom.exportPreferences();if(p)state.hooks?.status?.('Preferencias exportadas: '+p);};
    $('#importPrefs').onclick=async()=>{const r=await window.axiom.importPreferences();if(r){state.user=r.settings;await loadWorkspaceSettings();apply(activeConfig());render();state.hooks?.status?.('Preferencias importadas');}};
    $('#resetPrefs').onclick=async()=>{if(!confirm('¿Restablecer toda la configuración de AxiomCode?'))return;state.user=await window.axiom.resetConfig();state.workspace={};apply(activeConfig());render();};
  }

  function menuItem(label,icon,action,shortcut=''){return {label,icon,action,shortcut};}
  function openManage(anchor){
    document.querySelector('.manage-menu')?.remove();
    const menu=document.createElement('div');menu.className='manage-menu';
    const active=state.user?.profiles?.active||'Default';
    const items=[
      menuItem('Command Palette…','terminal',()=>state.hooks?.showPalette?.('commands'),'Ctrl+Shift+P'),
      null,
      menuItem('Settings','settings',()=>open('settings'),'Ctrl+,'),
      menuItem('Keyboard Shortcuts','keyboard',()=>open('keybindings'),'Ctrl+K Ctrl+S'),
      menuItem('Extensions','extensions',()=>state.hooks?.setSideMode?.('extensions'),'Ctrl+Shift+X'),
      null,
      menuItem('Profiles'+(active!=='Default'?' · '+active:''),'account',()=>open('profiles')),
      menuItem('Backup and Sync Settings…','sync',()=>open('backup')),
      null,
      menuItem('Color Theme…','symbol-color',()=>{open('settings');state.search='Color Theme';renderSettings();}),
      menuItem('File Icon Theme…','file',()=>{open('settings');state.search='File Icon Theme';renderSettings();}),
      null,
      menuItem('Open Settings (JSON)','json',async()=>{state.settingsPath=await window.axiom.getConfigPath();state.hooks?.openFile?.(state.settingsPath);}),
      menuItem('Configure User Snippets…','symbol-snippet',async()=>{const p=await window.axiom.getPreferenceResource('snippets');state.hooks?.openFile?.(p);}),
      menuItem('Open Extensions Folder','folder-opened',()=>window.axiom.openExtensionsFolder()),
      null,
      menuItem('Check for Updates…','cloud-download',()=>state.hooks?.checkUpdates?.(true)),
      menuItem('About AxiomCode','info',()=>state.hooks?.about?.())
    ];
    for(const item of items){
      if(!item){const sep=document.createElement('div');sep.className='manage-separator';menu.appendChild(sep);continue;}
      const b=document.createElement('button');
      b.innerHTML='<span class="codicon codicon-'+item.icon+'"></span><span>'+escapeHtml(item.label)+'</span><kbd>'+escapeHtml(item.shortcut)+'</kbd>';
      b.onclick=()=>{menu.remove();item.action();};menu.appendChild(b);
    }
    document.body.appendChild(menu);
    const r=anchor.getBoundingClientRect();
    menu.style.left=(r.right+8)+'px';
    menu.style.top=Math.max(8,Math.min(window.innerHeight-menu.offsetHeight-8,r.bottom-menu.offsetHeight))+'px';
    requestAnimationFrame(()=>{const rr=menu.getBoundingClientRect();if(rr.right>window.innerWidth-8)menu.style.left=Math.max(8,r.left-rr.width-8)+'px';});
    setTimeout(()=>document.addEventListener('pointerdown',e=>{if(!menu.contains(e.target)&&e.target!==anchor)menu.remove();},{once:true}),0);
  }

  function normalizeShortcut(value){
    return String(value||'').toLowerCase().replace(/\s+/g,'').replace('control','ctrl').replace('command','ctrl');
  }
  function eventShortcut(e){
    const parts=[];if(e.ctrlKey||e.metaKey)parts.push('ctrl');if(e.altKey)parts.push('alt');if(e.shiftKey)parts.push('shift');
    let key=e.key.toLowerCase();if(key===' ')key='space';if(key==='control'||key==='shift'||key==='alt'||key==='meta')return '';
    parts.push(key);return parts.join('+');
  }
  function handleKeydown(e){
    const actual=eventShortcut(e);if(!actual)return false;
    const configured=state.user?.keybindings||{};
    if(state.pendingChord){
      const combo=state.pendingChord+' '+actual;
      clearTimeout(state.pendingChordTimer);state.pendingChord=null;
      for(const [id,,def] of KEYBINDINGS){
        const parts=String(configured[id]||def).split(/\s+/).filter(Boolean).map(normalizeShortcut);
        if(parts.length===2&&parts.join(' ')===combo){e.preventDefault();state.hooks?.runCommand?.(id);return true;}
      }
    }
    for(const [id,,def] of KEYBINDINGS){
      const parts=String(configured[id]||def).split(/\s+/).filter(Boolean).map(normalizeShortcut);
      if(parts.length===1&&parts[0]===actual){e.preventDefault();state.hooks?.runCommand?.(id);return true;}
      if(parts.length===2&&parts[0]===actual){e.preventDefault();state.pendingChord=actual;clearTimeout(state.pendingChordTimer);state.pendingChordTimer=setTimeout(()=>state.pendingChord=null,1400);state.hooks?.status?.('('+actual+') was pressed. Waiting for second key of chord...');return true;}
    }
    return false;
  }

  async function init(hooks){
    state.hooks=hooks;ensureOverlay();await refresh();
    const settingsBtn=$('#settingsBtn');
    if(settingsBtn)settingsBtn.onclick=e=>{e.stopPropagation();openManage(settingsBtn);};
    return activeConfig();
  }
  async function onWorkspaceChanged(){await loadWorkspaceSettings();apply(activeConfig());if(!$('#preferencesOverlay')?.classList.contains('hidden'))render();}
  function getSetting(key){return getPath(activeConfig(),key);}
  async function reloadFromDisk(){state.user=await window.axiom.reloadConfig();apply(activeConfig());render();}

  window.AxiomPreferences={init,open,close,openManage,apply,refresh,onWorkspaceChanged,getSetting,handleKeydown,reloadFromDisk,state};
})();