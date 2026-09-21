(() => {
  'use strict';
  let host, frame, origin, ready, resolveReady, rejectReady, dirty = false, projectPath = null, revision = 0, serial = 0;
  const pending = new Map();
  const $ = selector => host.querySelector(selector);
  const status = text => { if (host) $('#officialStatus').textContent = text; };
  function updateTitle() { $('#officialName').textContent = (projectPath?.split(/[\\/]/).pop() || 'Mi proyecto.sb3') + (dirty ? ' •' : ''); }
  async function request(command, payload) {
    await ready;
    return new Promise((resolve, reject) => {
      const id = ++serial;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Scratch no respondió a tiempo')); }, 60000);
      pending.set(id, {resolve,reject,timer});
      frame.contentWindow.postMessage({source:'axiom-scratch-host', id, command, payload}, origin);
    });
  }
  async function mount() {
    host = document.createElement('section'); host.id = 'scratchOfficialMode'; host.hidden = false;
    host.innerHTML = `<header class="official-toolbar"><strong>Scratch · AxiomCode</strong><span id="officialName"></span><nav><button id="officialNew">Nuevo</button><button id="officialOpen">Abrir .sb3</button><button id="officialSave">Guardar</button><button id="officialSaveAs">Guardar como…</button><button id="officialLoadJs">Extensión JS</button><button id="officialBack">Volver al código</button></nav></header><iframe title="Editor Scratch con bloques, disfraces y sonidos" sandbox="allow-scripts allow-same-origin allow-downloads allow-modals" allow="camera *; microphone *; autoplay *; clipboard-write *"></iframe><footer id="officialStatus" role="status">Cargando Scratch…</footer>`;
    document.querySelector('.editor-stage').appendChild(host); frame = $('iframe'); updateTitle();
    ready = new Promise((resolve,reject) => { resolveReady=resolve; rejectReady=reject; }); ready.catch(() => {});
    const timeout = setTimeout(() => { rejectReady(new Error('No se pudo cargar Scratch')); status('No se pudo cargar Scratch. Reinicia AxiomCode e inténtalo de nuevo.'); }, 60000);
    window.addEventListener('message', event => {
      if (event.source !== frame.contentWindow || event.origin !== origin) return;
      const data = event.data;
      if (data?.source === 'axiom-scratch-power' && data.type === 'request') {
        Promise.resolve(window.axiom.scratchPower(data.op, data.args || {}))
          .then(result => frame.contentWindow.postMessage({source:'axiom-scratch-power-host',requestId:data.requestId,result}, origin))
          .catch(error => frame.contentWindow.postMessage({source:'axiom-scratch-power-host',requestId:data.requestId,error:error.message}, origin));
        return;
      }
      if (data?.source !== 'axiom-scratch-official') return;
      if (data.type === 'ready') { clearTimeout(timeout); resolveReady(); status('Editor Scratch listo · .sb3 · Axiom 3D · Axiom Power'); }
      if (data.type === 'changed') { revision = data.revision; dirty = true; updateTitle(); }
      if (data.type === 'replaced') { projectPath = null; dirty = true; updateTitle(); }
      if (data.type === 'save') save();
      if (data.type === 'about') status('Scratch Foundation 15.1.1 + Axiom 3D + Axiom Power integrado en AxiomCode');
      if (data.type === 'response') {
        const entry = pending.get(data.id); if (!entry) return;
        clearTimeout(entry.timer); pending.delete(data.id); data.error ? entry.reject(new Error(data.error)) : entry.resolve(data.result);
      }
    });
    $('#officialSave').onclick = () => save(); $('#officialSaveAs').onclick = () => save(true); $('#officialOpen').onclick = () => open(); $('#officialBack').onclick = hide;
    $('#officialLoadJs').onclick = async () => {
      try {
        const extension = await window.axiom.openScratchExtensionJs();
        if (!extension) return;
        const result = await request('loadExtensionCode', extension);
        status('Extensión local cargada: ' + (result?.id || extension.name));
      } catch (e) { status('No se pudo cargar la extensión: ' + e.message); }
    };
    $('#officialNew').onclick = async () => {
      if (!await discard()) return;
      try { await request('new'); projectPath = null; dirty = false; updateTitle(); } catch (e) { status(e.message); }
    };
    window.addEventListener('beforeunload', event => { if (dirty && !window.axiom.confirmScratchDiscard()) { event.preventDefault(); event.returnValue=''; } });
    try { const info = await window.axiom.scratchInfo(); origin = new URL(info.url).origin; frame.src = info.url; }
    catch (e) { clearTimeout(timeout); rejectReady(e); status(e.message); }
  }
  async function discard() { return !dirty || window.axiom.confirmScratchDiscard(); }
  async function show() {
    window.AxiomScratchLegacy?.hide();
    if (!host) await mount();
    host.hidden = false; document.getElementById('scratchBtn')?.classList.add('scratch-active');
  }
  function hide() { window.AxiomScratchLegacy?.hide(); if (!host) return; request('stop').catch(() => {}); host.hidden = true; document.getElementById('scratchBtn')?.classList.remove('scratch-active'); }
  async function save(saveAs = false) {
    if (window.AxiomScratchLegacy?.visible) return window.AxiomScratchLegacy.save();
    try {
      const data = await request('serialize');
      const saved = await window.axiom.saveScratchSb3({path:saveAs ? null : projectPath, bytes:new Uint8Array(data.bytes), title:data.title});
      if (!saved) return false;
      projectPath = saved; if (data.revision === revision) dirty = false;
      await request('saved', {revision:data.revision}); updateTitle(); status('Guardado: ' + projectPath); return true;
    } catch (e) { status('No se pudo guardar: ' + e.message); return false; }
  }
  async function open(path) {
    if (path?.toLowerCase().endsWith('.axiomscratch')) { hide(); return window.AxiomScratchLegacy.open(path); }
    await show();
    if (!await discard()) return;
    try {
      const file = await window.axiom.openScratchSb3(path);
      if (!file) return;
      await request('load', {bytes:new Uint8Array(file.bytes).buffer, title:file.path.split(/[\\/]/).pop().replace(/\.(sb3|sb2|sb)$/i,'')});
      projectPath = /\.sb3$/i.test(file.path) ? file.path : null; dirty = false; updateTitle(); status('Proyecto abierto');
    } catch (e) { status('No se pudo abrir: ' + e.message); }
  }
  window.AxiomScratch = {show, hide, open, save, run: () => window.AxiomScratchLegacy?.visible ? window.AxiomScratchLegacy.run() : request('run').catch(e => status(e.message)), get visible() { return (host && !host.hidden) || window.AxiomScratchLegacy?.visible; }};
})();
