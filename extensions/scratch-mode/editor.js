/* Official Scratch standalone API; no Node or filesystem access in this frame. */
(() => {
  'use strict';
  const send = (type, data = {}) => parent.postMessage({source:'axiom-scratch-official', type, ...data}, '*');
  const scratchStorage = new GUI.ScratchStorage();
  const storage = {
    scratchStorage,
    getLibraryAssetUrl: (id, format) => new URL(`assets/${id}.${format}`, location.href).href,
    setTranslatorFunction: translator => GUI.buildDefaultProject(translator).forEach(asset => scratchStorage.builtinHelper._store(scratchStorage.AssetType[asset.assetType], scratchStorage.DataFormat[asset.dataFormat], asset.data, asset.id)),
    saveProject: async () => { send('save'); return {id:'0'}; }
  };
  storage.setTranslatorFunction();
  scratchStorage.addWebStore([scratchStorage.AssetType.ImageVector, scratchStorage.AssetType.ImageBitmap, scratchStorage.AssetType.Sound], asset => new URL(`assets/${asset.assetId}.${asset.dataFormat}`, location.href).href);
  const state = new GUI.EditorState({locale:'es', showTelemetryModal:false}, () => ({storage}));
  GUI.setAppElement(document.getElementById('app'));
  const root = GUI.createStandaloneRoot(state, document.getElementById('app'));
  let vm, ready = false, revision = 0, loading = false;
  const unchanged = () => state.dispatch({type:'scratch-gui/project-changed/SET_PROJECT_CHANGED', changed:false});
  const title = value => state.dispatch({type:'projectTitle/SET_PROJECT_TITLE', title:value});
  function registerLocalExtension(extension) {
    if (!vm?.extensionManager) throw new Error('Scratch VM no disponible');
    if (!extension || typeof extension.getInfo !== 'function') throw new Error('La extensión debe implementar getInfo()');
    const info = extension.getInfo();
    const id = String(info?.id || '').trim();
    if (!/^[A-Za-z][A-Za-z0-9_]{1,63}$/.test(id)) throw new Error('ID de extensión no válido');
    if (['axiom3d','axiompower'].includes(id)) throw new Error('Ese ID está reservado por AxiomCode');
    if (vm.extensionManager.isExtensionLoaded?.(id) || vm.extensionManager._loadedExtensions?.has(id)) throw new Error('La extensión '+id+' ya está cargada');
    const service = vm.extensionManager._registerInternalExtension(extension);
    vm.extensionManager._loadedExtensions.set(id, service);
    try { vm.refreshWorkspace?.(); } catch {}
    try { vm.emitWorkspaceUpdate?.(); } catch {}
    return {id,name:String(info.name || id)};
  }
  async function loadLocalExtensionCode(code, name='extension-local.js') {
    const source=String(code||'');
    if (!source.trim()) throw new Error('Archivo JavaScript vacío');
    if (source.length > 2*1024*1024) throw new Error('Código de extensión demasiado grande');
    const before=new Set([...(vm?.extensionManager?._loadedExtensions?.keys?.()||[])]);
    const module={exports:{}};
    const safeName=String(name||'extension-local.js').replace(/[^A-Za-z0-9._-]/g,'_').slice(0,100);
    const runner=new Function('AxiomScratchSDK','module','exports','vm', '"use strict";\n'+source+'\n//# sourceURL=axiom-local/'+safeName);
    const returned=await runner(window.AxiomScratchSDK,module,module.exports,vm);
    const newlyLoaded=[...(vm?.extensionManager?._loadedExtensions?.keys?.()||[])].filter(id=>!before.has(id));
    if (newlyLoaded.length) {
      const id=newlyLoaded[0];
      return {id,name:id,registered:true};
    }
    let candidate=returned;
    if (!candidate && module.exports && (typeof module.exports==='function' || Object.keys(module.exports).length)) candidate=module.exports.default || module.exports;
    if (typeof candidate === 'function') {
      try { candidate=new candidate(vm); } catch { candidate=await candidate(vm); }
    }
    if (candidate && typeof candidate.getInfo === 'function') return {...registerLocalExtension(candidate),registered:true};
    return {id:null,name:safeName,registered:false};
  }
  window.AxiomScratchSDK = {
    register: registerLocalExtension,
    loadCode: loadLocalExtensionCode,
    power: (op,args={}) => window.AxiomScratchPower?.request(op,args),
    get vm(){ return vm; }
  };
  root.render({
    canEditTitle:true, canSave:false, canCreateNew:false, canShare:false,
    backpackVisible:false, showTelemetryModal:false, platform:'DESKTOP',
    onClickLogo: () => send('about'),
    onVmInit: instance => { vm = instance; window.AxiomScratch3D?.install(vm); window.AxiomScratchPower?.install(vm); vm.on('PROJECT_CHANGED', () => { if (!loading && ready) { revision++; send('changed', {revision}); } }); },
    onProjectLoaded: () => { if (ready && !loading) send('replaced'); ready = true; send('ready'); }
  });
  state.dispatch(GUI.setProjectId('0'));
  window.addEventListener('message', async event => {
    if (event.source !== parent || event.data?.source !== 'axiom-scratch-host') return;
    const {id, command, payload} = event.data;
    try {
      if (!ready) throw new Error('El editor todavía está cargando');
      let result;
      if (command === 'run') { vm.greenFlag(); }
      else if (command === 'stop') { vm.stopAll(); }
      else if (command === 'serialize') { const bytes = await (await vm.saveProjectSb3()).arrayBuffer(); result = {bytes, revision, title:state.store.getState().scratchGui.projectTitle}; }
      else if (command === 'saved') { if (payload.revision === revision) unchanged(); }
      else if (command === 'load') {
        loading = true; vm.stopAll();
        const oldState = state.store.getState().scratchGui.projectState.loadingState;
        state.dispatch(GUI.requestProjectUpload(oldState));
        try { await vm.loadProject(payload.bytes); title(payload.title); state.dispatch(GUI.onLoadedProject('LOADING_VM_FILE_UPLOAD',false,true)); unchanged(); revision++; }
        catch (error) { state.dispatch(GUI.onLoadedProject('LOADING_VM_FILE_UPLOAD',false,false)); throw error; }
        finally { loading = false; }
      }
      else if (command === 'new') { vm.stopAll(); state.dispatch(GUI.requestNewProject(false)); title('Mi proyecto'); }
      else if (command === 'loadExtensionCode') { result = await window.AxiomScratchSDK.loadCode(payload?.code, payload?.name); }
      else throw new Error('Comando no válido');
      send('response', {id, result});
    } catch (error) { send('response', {id, error:error.message}); }
  });
  window.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); event.stopImmediatePropagation(); send('save'); }
    if (event.key === 'F5') { event.preventDefault(); vm?.greenFlag(); }
  }, true);
  // Diagnostic handles stay inside the unprivileged frame for integration tests.
  window.scratchEditor = {state, get vm() { return vm; }, get ready() { return ready; }};
})();