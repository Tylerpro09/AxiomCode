(function (root) {
  'use strict';
  const LIMITS = Object.freeze({ maxBlocks: 50000, maxDepth: 64, maxSteps: 1000000, maxNumber: 1000000000, maxWaitSeconds: 3600, maxRepeat: 100000, maxTextLength: 20000 });
  const definitions = {
    move: { label: 'Mover', unit: 'pasos', value: 30, color: 'motion' },
    turn: { label: 'Girar', unit: 'grados', value: 15, color: 'motion' },
    x: { label: 'Ir a x', value: 0, color: 'motion' },
    y: { label: 'Ir a y', value: 0, color: 'motion' },
    say: { label: 'Decir', value: '¡Hola, AxiomCode!', color: 'looks' },
    wait: { label: 'Esperar', unit: 'segundos', value: 0.5, color: 'control' },
    repeat: { label: 'Repetir', unit: 'veces', value: 10, color: 'control' },
    home: { label: 'Volver al centro', color: 'motion' },
    clear: { label: 'Borrar trazos', color: 'pen' },
    penDown: { label: 'Bajar lápiz', color: 'pen' },
    penUp: { label: 'Subir lápiz', color: 'pen' }
  };
  function block(type) {
    if (!definitions[type]) throw new Error('Bloque desconocido');
    return { type, ...(definitions[type].value !== undefined ? { value: definitions[type].value } : {}), ...(type === 'repeat' ? { children: [] } : {}) };
  }
  function validate(data) {
    let count = 0;
    function visit(list, depth) {
      if (!Array.isArray(list) || depth > LIMITS.maxDepth) throw new Error('Estructura de bloques no válida');
      return list.map(b => {
        if (++count > LIMITS.maxBlocks || !b || !Object.hasOwn(definitions, b.type)) throw new Error('Proyecto demasiado grande o bloque desconocido');
        const result = block(b.type);
        if (b.type === 'say') {
          if (typeof b.value !== 'string' || b.value.length > LIMITS.maxTextLength) throw new Error('Texto no válido');
          result.value = b.value;
        } else if (definitions[b.type].value !== undefined) {
          if (typeof b.value !== 'number' || !Number.isFinite(b.value) || Math.abs(b.value) > LIMITS.maxNumber) throw new Error('Número no válido');
          if ((b.type === 'wait' && (b.value < 0 || b.value > LIMITS.maxWaitSeconds)) || (b.type === 'repeat' && (!Number.isInteger(b.value) || b.value < 0 || b.value > LIMITS.maxRepeat))) throw new Error('Valor fuera de rango');
          result.value = b.value;
        }
        if (b.type === 'repeat') result.children = visit(b.children, depth + 1);
        return result;
      });
    }
    if (!data || data.format !== 'axiom-scratch' || data.version !== 1) throw new Error('Este archivo no es un proyecto Axiom Scratch compatible');
    return { format: 'axiom-scratch', version: 1, blocks: visit(data.blocks, 0) };
  }
  const initialState = () => ({ x: 0, y: 0, direction: 0, text: '', pen: false });
  async function execute(blocks, state, hooks = {}) {
    let steps = 0;
    const limitError = () => new Error('Se alcanzó el límite de '+LIMITS.maxSteps.toLocaleString('es')+' pasos');
    async function tick(amount = 1) {
      steps += amount;
      if (steps > LIMITS.maxSteps) throw limitError();
      if (!hooks.pause && steps % 5000 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    const stack = [{list:blocks,index:0,remaining:1}];
    while (stack.length) {
      if (hooks.cancelled?.()) break;
      const frame = stack[stack.length - 1];
      if (frame.index >= frame.list.length) {
        if (frame.remaining > 1) {
          frame.remaining--;
          frame.index = 0;
          await tick();
        } else {
          stack.pop();
        }
        continue;
      }
      const b = frame.list[frame.index++];
      await tick();
      hooks.highlight?.(b);
      if (b.type === 'repeat') {
        if (b.value > 0 && b.children.length) {
          stack.push({list:b.children,index:0,remaining:b.value});
        } else if (b.value > 0) {
          await tick(b.value);
        }
        continue;
      }
      const from = { x: state.x, y: state.y };
      switch (b.type) {
        case 'move': state.x += Math.cos(state.direction * Math.PI / 180) * b.value; state.y += Math.sin(state.direction * Math.PI / 180) * b.value; break;
        case 'turn': state.direction = (state.direction + b.value) % 360; break;
        case 'x': state.x = b.value; break;
        case 'y': state.y = b.value; break;
        case 'say': state.text = b.value; break;
        case 'home': state.x = state.y = state.direction = 0; state.text = ''; break;
        case 'penDown': state.pen = true; break;
        case 'penUp': state.pen = false; break;
        case 'clear': hooks.clear?.(); break;
      }
      state.x = Math.max(-LIMITS.maxNumber, Math.min(LIMITS.maxNumber, state.x));
      state.y = Math.max(-LIMITS.maxNumber, Math.min(LIMITS.maxNumber, state.y));
      hooks.draw?.(state, from, ['move', 'x', 'y', 'home'].includes(b.type));
      if (hooks.pause) await hooks.pause(b.type === 'wait' ? b.value * 1000 : 70);
    }
    return state;
  }
  const api = { LIMITS, definitions, block, validate, initialState, execute };
  if (typeof module !== 'undefined') module.exports = api; else root.AxiomScratchCore = api;
})(globalThis);
