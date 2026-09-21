(function () {
  'use strict';
  const core = window.AxiomScratchCore;
  let host, program = [], dirty = false, projectPath = null, running = false, cancel = false, wake = null;
  let state = core.initialState(), drag = null, nodes = new Map(), traces = [], revision = 0;
  const $ = s => host.querySelector(s);
  function changed() { dirty = true; revision++; title(); }
  function title() { $('#scratchName').textContent = (projectPath?.split(/[\\/]/).pop() || 'Mi proyecto') + (dirty ? ' •' : ''); }
  function message(text) { $('#scratchStatus').textContent = text; }
  function stop() { cancel = true; wake?.(); }
  function renderStage(from, moved) {
    if (from && moved && state.pen) { traces.push([from.x, from.y, state.x, state.y]); if (traces.length > 250000) traces.splice(0, traces.length - 250000); }
    const canvas = $('#scratchCanvas'), ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 480, 360); ctx.fillStyle = '#f9fafc'; ctx.fillRect(0, 0, 480, 360);
    ctx.strokeStyle = '#e5e9f1'; ctx.lineWidth = 1;
    for (let x = 0; x < 480; x += 30) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 360); ctx.stroke(); }
    for (let y = 0; y < 360; y += 30) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(480, y); ctx.stroke(); }
    ctx.strokeStyle = '#13a891'; ctx.lineWidth = 3;
    for (const [x, y, nx, ny] of traces) { ctx.beginPath(); ctx.moveTo(240 + x, 180 - y); ctx.lineTo(240 + nx, 180 - ny); ctx.stroke(); }
    ctx.save(); ctx.translate(240 + state.x, 180 - state.y); ctx.rotate(-state.direction * Math.PI / 180);
    ctx.fillStyle = '#ff9c36'; ctx.strokeStyle = '#bd6314'; ctx.lineWidth = 2; ctx.beginPath();
    ctx.moveTo(19, 0); ctx.lineTo(-13, -14); ctx.lineTo(-7, 0); ctx.lineTo(-13, 14); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    $('#scratchSpeech').textContent = state.text;
    $('#scratchPosition').textContent = `x: ${Math.round(state.x)}    y: ${Math.round(state.y)}    giro: ${Math.round(state.direction)}°`;
  }
  function button(text, label, action) { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.title = label; b.setAttribute('aria-label', label); b.onclick = action; return b; }
  function renderProgram() {
    nodes = new Map(); const root = $('#scratchProgram'); root.replaceChildren();
    root.appendChild(Object.assign(document.createElement('div'), { className: 'scratch-hat', textContent: '⚑ Al pulsar ejecutar' }));
    function listView(list, depth) {
      const area = document.createElement('div'); area.className = 'scratch-stack';
      area.ondragover = e => { if (!running) { e.preventDefault(); e.stopPropagation(); area.classList.add('drop-ready'); } };
      area.ondragleave = () => area.classList.remove('drop-ready');
      area.ondrop = e => {
        e.preventDefault(); e.stopPropagation(); area.classList.remove('drop-ready');
        if (running || !drag || depth > core.LIMITS.maxDepth) return;
        if (drag.block) {
          const contains = (b, target) => b.children === target || (b.children || []).some(c => contains(c, target));
          if (contains(drag.block, list)) return;
          drag.source.splice(drag.source.indexOf(drag.block), 1); list.push(drag.block);
        } else list.push(core.block(drag.type));
        drag = null; changed(); renderProgram();
      };
      list.forEach((b, i) => {
        const def = core.definitions[b.type], item = document.createElement('div'); item.className = 'scratch-block ' + def.color;
        item.draggable = !running; nodes.set(b, item);
        item.ondragstart = e => { e.stopPropagation(); if (running) return e.preventDefault(); drag = { block: b, source: list }; e.dataTransfer.setData('text/plain', b.type); };
        item.ondragend = () => { drag = null; host.querySelectorAll('.drop-ready').forEach(n => n.classList.remove('drop-ready')); };
        const row = document.createElement('div'); row.className = 'scratch-block-row';
        row.appendChild(Object.assign(document.createElement('span'), { textContent: def.label }));
        if (def.value !== undefined) {
          const input = document.createElement('input'); input.type = b.type === 'say' ? 'text' : 'number'; input.value = b.value; input.disabled = running;
          input.setAttribute('aria-label', def.label); input.maxLength = core.LIMITS.maxTextLength;
          if (input.type === 'number') { input.step = b.type === 'repeat' ? '1' : 'any'; input.min = ['wait', 'repeat'].includes(b.type) ? '0' : String(-core.LIMITS.maxNumber); input.max = b.type === 'wait' ? String(core.LIMITS.maxWaitSeconds) : b.type === 'repeat' ? String(core.LIMITS.maxRepeat) : String(core.LIMITS.maxNumber); }
          input.oninput = () => { b.value = input.type === 'number' ? (input.value === '' ? NaN : Number(input.value)) : input.value; changed(); };
          input.ondragstart = e => e.preventDefault(); row.appendChild(input);
        }
        if (def.unit) row.appendChild(Object.assign(document.createElement('span'), { textContent: def.unit }));
        const actions = document.createElement('span'); actions.className = 'scratch-block-actions';
        for (const [label, delta] of [['↑', -1], ['↓', 1]]) { const control = button(label, delta < 0 ? 'Subir bloque' : 'Bajar bloque', () => { const j = i + delta; [list[i], list[j]] = [list[j], list[i]]; changed(); renderProgram(); }); control.disabled = running || i + delta < 0 || i + delta >= list.length; actions.appendChild(control); }
        const remove = button('×', 'Eliminar bloque', () => { list.splice(i, 1); changed(); renderProgram(); }); remove.disabled = running; actions.appendChild(remove);
        row.appendChild(actions); item.appendChild(row);
        if (b.children) item.appendChild(listView(b.children, depth + 1)); area.appendChild(item);
      });
      const hint = document.createElement('div'); hint.className = 'scratch-drop-hint'; hint.textContent = list.length ? 'Soltar aquí para añadir al final' : 'Arrastra bloques aquí'; area.appendChild(hint);
      return area;
    }
    root.appendChild(listView(program, 0));
    host.querySelectorAll('[data-edit]').forEach(b => { b.disabled = running; });
  }
  function snapshot() { return core.validate({ format: 'axiom-scratch', version: 1, blocks: program }); }
  async function run() {
    if (running) return;
    try { snapshot(); } catch (e) { message(e.message); return; }
    running = true; cancel = false; state = core.initialState(); traces = []; renderStage(); renderProgram(); message('Ejecutando…');
    try {
      await core.execute(program, state, {
        cancelled: () => cancel,
        highlight: b => { host.querySelectorAll('.executing').forEach(n => n.classList.remove('executing')); nodes.get(b)?.classList.add('executing'); },
        clear: () => { traces = []; }, draw: (_, from, moved) => renderStage(from, moved),
        pause: ms => new Promise(resolve => { const timer = setTimeout(done, ms); function done() { clearTimeout(timer); wake = null; resolve(); } wake = done; if (cancel) done(); })
      });
      message(cancel ? 'Detenido' : 'Programa terminado');
    } catch (e) { message(e.message); }
    finally { running = false; wake = null; renderProgram(); }
  }
  async function save() {
    const savedRevision = revision;
    try {
      const content = JSON.stringify(snapshot(), null, 2);
      const result = await window.axiom.saveScratch({ path: projectPath, content });
      if (result) { projectPath = result; if (revision === savedRevision) dirty = false; title(); message('Proyecto guardado'); }
      return Boolean(result);
    } catch (e) { message('No se pudo guardar: ' + e.message); return false; }
  }
  async function open(path) {
    if (running) { message('Detén la ejecución antes de abrir otro proyecto'); return; }
    if (dirty && !confirm('Hay cambios sin guardar. ¿Descartarlos y abrir otro proyecto?')) return;
    try {
      const result = path ? await window.axiom.readFile(path) : await window.axiom.openScratch();
      if (!result) return;
      const parsed = core.validate(JSON.parse(result.content));
      program = parsed.blocks; projectPath = result.path; dirty = false; revision++; state = core.initialState(); traces = []; title(); renderProgram(); renderStage(); message('Proyecto abierto');
    } catch (e) { message('No se pudo abrir: ' + e.message); }
  }
  function mount() {
    host = document.createElement('section'); host.id = 'scratchMode'; host.hidden = true;
    host.innerHTML = `<header class="scratch-toolbar"><div><strong>Modo Scratch</strong><span id="scratchName"></span></div><nav><button data-edit id="scratchNew">Nuevo</button><button data-edit id="scratchOpen">Abrir</button><button id="scratchSave">Guardar</button><button id="scratchRun" class="scratch-run">⚑ Ejecutar</button><button id="scratchStop">■ Detener</button><button id="scratchClose">Volver al código</button></nav></header><div class="scratch-layout"><aside class="scratch-palette"><h3>Bloques</h3><p>Arrastra o pulsa para añadir.</p><div id="scratchTools"></div></aside><section class="scratch-code"><h3>Programa</h3><div id="scratchProgram"></div></section><aside class="scratch-preview"><h3>Escenario</h3><canvas id="scratchCanvas" width="480" height="360" aria-label="Escenario del personaje"></canvas><div id="scratchSpeech" aria-live="polite"></div><p id="scratchPosition"></p><p class="scratch-note">Modo legacy ampliado: hasta 50.000 bloques y 1.000.000 de pasos.<br>Para proyectos Scratch completos usa el editor .sb3 oficial integrado.</p></aside></div><footer id="scratchStatus" role="status">Listo para crear con bloques</footer>`;
    document.querySelector('.editor-stage').appendChild(host);
    for (const [type, def] of Object.entries(core.definitions)) {
      const b = button(`${def.label} ${def.value ?? ''} ${def.unit || ''}`, 'Añadir: ' + def.label, () => { if (running) return; program.push(core.block(type)); changed(); renderProgram(); });
      b.className = 'scratch-tool ' + def.color; b.draggable = true; b.dataset.edit = '';
      b.ondragstart = e => { if (running) return e.preventDefault(); drag = { type }; e.dataTransfer.setData('text/plain', type); }; b.ondragend = () => { drag = null; };
      $('#scratchTools').appendChild(b);
    }
    $('#scratchRun').onclick = run; $('#scratchStop').onclick = stop; $('#scratchSave').onclick = save; $('#scratchOpen').onclick = () => open();
    $('#scratchClose').onclick = hide;
    $('#scratchNew').onclick = () => { if (dirty && !confirm('¿Descartar los cambios y crear un proyecto?')) return; program = []; projectPath = null; dirty = false; revision++; state = core.initialState(); traces = []; title(); renderProgram(); renderStage(); message('Proyecto nuevo'); };
    host.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); e.stopPropagation(); save(); } else if (e.key === 'F5') { e.preventDefault(); e.stopPropagation(); run(); } });
    window.addEventListener('beforeunload', e => { if (dirty && !confirm('El proyecto de bloques tiene cambios sin guardar. ¿Cerrar AxiomCode?')) { e.preventDefault(); e.returnValue = ''; } });
    program = [core.block('penDown'), { type: 'repeat', value: 4, children: [{ type: 'move', value: 100 }, { type: 'turn', value: 90 }] }, core.block('say')];
    title(); renderProgram(); renderStage();
  }
  function show() { if (!host) mount(); host.hidden = false; document.getElementById('scratchBtn')?.classList.add('scratch-active'); }
  function hide() { if (!host) return; stop(); host.hidden = true; document.getElementById('scratchBtn')?.classList.remove('scratch-active'); }
  window.AxiomScratchLegacy = { show, hide, save, run, open: async path => { show(); await open(path); }, get visible() { return host && !host.hidden; } };
})();
