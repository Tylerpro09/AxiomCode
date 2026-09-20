(() => {
  'use strict';

  let serial = 0;
  const pending = new Map();
  let lastHttpStatus = 0;
  let lastHttpUrl = '';

  window.addEventListener('message', event => {
    if (event.source !== parent || event.data?.source !== 'axiom-scratch-power-host') return;
    const entry = pending.get(event.data.requestId);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(event.data.requestId);
    if (event.data.error) entry.reject(new Error(event.data.error));
    else entry.resolve(event.data.result);
  });

  function request(op, args = {}) {
    return new Promise((resolve, reject) => {
      const requestId = ++serial;
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error('Axiom Power no respondió a tiempo'));
      }, 300000);
      pending.set(requestId, {resolve, reject, timer});
      parent.postMessage({source:'axiom-scratch-power', type:'request', requestId, op, args}, '*');
    });
  }

  function parseJson(value) {
    try { return JSON.parse(String(value ?? '')); }
    catch { throw new Error('JSON no válido'); }
  }

  function pathParts(path) {
    const p = String(path ?? '').trim();
    if (!p) return [];
    return p.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  }

  function valueAt(root, path) {
    let current = root;
    for (const key of pathParts(path)) {
      if (current == null) return '';
      current = current[key];
    }
    return current;
  }

  function scratchValue(value) {
    if (value == null) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  function parseLoose(value) {
    const text = String(value ?? '');
    try { return JSON.parse(text); } catch { return text; }
  }

  function setJsonPath(source, path, value) {
    const root = parseJson(source);
    const parts = pathParts(path);
    if (!parts.length) return JSON.stringify(parseLoose(value));
    let current = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      const next = parts[i + 1];
      if (current[key] == null || typeof current[key] !== 'object') current[key] = /^\d+$/.test(next) ? [] : {};
      current = current[key];
    }
    current[parts.at(-1)] = parseLoose(value);
    return JSON.stringify(root);
  }

  async function sha256(text) {
    const bytes = new TextEncoder().encode(String(text ?? ''));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2,'0')).join('');
  }

  function utf8ToBase64(text) {
    const bytes = new TextEncoder().encode(String(text ?? ''));
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
  }

  function base64ToUtf8(text) {
    try {
      const binary = atob(String(text ?? ''));
      const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    } catch { return ''; }
  }

  class AxiomPowerExtension {
    constructor(vm) { this.vm = vm; }

    getInfo() {
      return {
        id:'axiompower',
        name:'Axiom Power',
        color1:'#8A4FFF',
        color2:'#7440D6',
        color3:'#5C2FB4',
        blocks:[
          {opcode:'webGet',blockType:'reporter',text:'web GET [URL]',arguments:{URL:{type:'string',defaultValue:'https://example.com'}}},
          {opcode:'webPost',blockType:'reporter',text:'web POST [URL] texto [BODY]',arguments:{URL:{type:'string',defaultValue:'https://httpbin.org/post'},BODY:{type:'string',defaultValue:'hola'}}},
          {opcode:'httpStatus',blockType:'reporter',text:'último estado HTTP'},
          {opcode:'httpUrl',blockType:'reporter',text:'última URL HTTP'},
          {opcode:'openUrl',blockType:'command',text:'abrir URL [URL]',arguments:{URL:{type:'string',defaultValue:'https://scratch.mit.edu'}}},
          '---',
          {opcode:'jsonGet',blockType:'reporter',text:'JSON [JSON] obtener ruta [PATH]',arguments:{JSON:{type:'string',defaultValue:'{"jugador":{"vida":100}}'},PATH:{type:'string',defaultValue:'jugador.vida'}}},
          {opcode:'jsonSet',blockType:'reporter',text:'JSON [JSON] poner ruta [PATH] valor [VALUE]',arguments:{JSON:{type:'string',defaultValue:'{"vida":100}'},PATH:{type:'string',defaultValue:'vida'},VALUE:{type:'string',defaultValue:'80'}}},
          {opcode:'jsonValid',blockType:'reporter',text:'JSON válido [JSON] (1/0)',arguments:{JSON:{type:'string',defaultValue:'{"ok":true}'}}},
          {opcode:'urlEncode',blockType:'reporter',text:'codificar URL [TEXT]',arguments:{TEXT:{type:'string',defaultValue:'hola mundo'}}},
          {opcode:'urlDecode',blockType:'reporter',text:'decodificar URL [TEXT]',arguments:{TEXT:{type:'string',defaultValue:'hola%20mundo'}}},
          {opcode:'base64Encode',blockType:'reporter',text:'Base64 codificar [TEXT]',arguments:{TEXT:{type:'string',defaultValue:'AxiomCode'}}},
          {opcode:'base64Decode',blockType:'reporter',text:'Base64 decodificar [TEXT]',arguments:{TEXT:{type:'string',defaultValue:'QXhpb21Db2Rl'}}},
          {opcode:'hashSha256',blockType:'reporter',text:'SHA-256 de [TEXT]',arguments:{TEXT:{type:'string',defaultValue:'hola'}}},
          '---',
          {opcode:'storageSet',blockType:'command',text:'guardar [VALUE] con clave [KEY]',arguments:{VALUE:{type:'string',defaultValue:'100'},KEY:{type:'string',defaultValue:'puntuacion'}}},
          {opcode:'storageGet',blockType:'reporter',text:'leer clave [KEY]',arguments:{KEY:{type:'string',defaultValue:'puntuacion'}}},
          {opcode:'storageDelete',blockType:'command',text:'borrar clave [KEY]',arguments:{KEY:{type:'string',defaultValue:'puntuacion'}}},
          {opcode:'storageKeys',blockType:'reporter',text:'claves guardadas JSON'},
          '---',
          {opcode:'openTextFile',blockType:'reporter',text:'elegir y leer archivo de texto'},
          {opcode:'saveTextFile',blockType:'command',text:'guardar texto [TEXT] como [NAME]',arguments:{TEXT:{type:'string',defaultValue:'hola'},NAME:{type:'string',defaultValue:'scratch.txt'}}},
          {opcode:'clipboardWrite',blockType:'command',text:'copiar al portapapeles [TEXT]',arguments:{TEXT:{type:'string',defaultValue:'hola'}}},
          {opcode:'clipboardRead',blockType:'reporter',text:'leer portapapeles'},
          {opcode:'notify',blockType:'command',text:'notificación título [TITLE] mensaje [BODY]',arguments:{TITLE:{type:'string',defaultValue:'Scratch'},BODY:{type:'string',defaultValue:'¡Listo!'}}},
          {opcode:'speak',blockType:'command',text:'decir con voz [TEXT] velocidad [RATE] tono [PITCH]',arguments:{TEXT:{type:'string',defaultValue:'Hola desde AxiomCode'},RATE:{type:'number',defaultValue:1},PITCH:{type:'number',defaultValue:1}}},
          {opcode:'stopSpeech',blockType:'command',text:'detener voz'},
          {opcode:'saveStagePng',blockType:'command',text:'guardar captura del escenario como [NAME]',arguments:{NAME:{type:'string',defaultValue:'escenario.png'}}},
          '---',
          {opcode:'gamepadAxis',blockType:'reporter',text:'gamepad [PAD] eje [AXIS]',arguments:{PAD:{type:'number',defaultValue:0},AXIS:{type:'number',defaultValue:0}}},
          {opcode:'gamepadButton',blockType:'reporter',text:'gamepad [PAD] botón [BUTTON] (1/0)',arguments:{PAD:{type:'number',defaultValue:0},BUTTON:{type:'number',defaultValue:0}}},
          {opcode:'online',blockType:'reporter',text:'conectado a internet (1/0)'},
          {opcode:'viewportValue',blockType:'reporter',text:'pantalla [VIEW]',arguments:{VIEW:{type:'string',menu:'VIEWPORT',defaultValue:'ancho'}}},
          '---',
          {opcode:'systemValue',blockType:'reporter',text:'información del sistema [ITEM]',arguments:{ITEM:{type:'string',menu:'SYSTEM',defaultValue:'sistema'}}},
          {opcode:'nowUnix',blockType:'reporter',text:'tiempo Unix milisegundos'},
          {opcode:'nowIso',blockType:'reporter',text:'fecha y hora ISO'},
          {opcode:'uuid',blockType:'reporter',text:'crear UUID'}
        ],
        menus:{
          SYSTEM:{acceptReporters:true,items:['sistema','arquitectura','versión del sistema','CPUs','memoria MB','idioma','versión AxiomCode']},
          VIEWPORT:{acceptReporters:true,items:['ancho','alto','pixel ratio']}
        }
      };
    }

    async webGet(args){
      const result=await request('httpGet',{url:String(args.URL||'')});
      lastHttpStatus=result.status||0; lastHttpUrl=result.url||'';
      return result.text||'';
    }
    async webPost(args){
      const result=await request('httpPost',{url:String(args.URL||''),body:String(args.BODY??'')});
      lastHttpStatus=result.status||0; lastHttpUrl=result.url||'';
      return result.text||'';
    }
    httpStatus(){ return lastHttpStatus; }
    httpUrl(){ return lastHttpUrl; }
    async openUrl(args){ await request('openUrl',{url:String(args.URL||'')}); }

    jsonGet(args){ return scratchValue(valueAt(parseJson(args.JSON),args.PATH)); }
    jsonSet(args){ return setJsonPath(args.JSON,args.PATH,args.VALUE); }
    jsonValid(args){ try{JSON.parse(String(args.JSON??''));return 1;}catch{return 0;} }
    urlEncode(args){ return encodeURIComponent(String(args.TEXT??'')); }
    urlDecode(args){ try{return decodeURIComponent(String(args.TEXT??''));}catch{return String(args.TEXT??'');} }
    base64Encode(args){ return utf8ToBase64(args.TEXT); }
    base64Decode(args){ return base64ToUtf8(args.TEXT); }
    hashSha256(args){ return sha256(args.TEXT); }

    async storageSet(args){ await request('storageSet',{key:String(args.KEY??''),value:String(args.VALUE??'')}); }
    storageGet(args){ return request('storageGet',{key:String(args.KEY??'')}); }
    async storageDelete(args){ await request('storageDelete',{key:String(args.KEY??'')}); }
    storageKeys(){ return request('storageKeys'); }

    openTextFile(){ return request('openTextFile'); }
    async saveTextFile(args){ await request('saveTextFile',{text:String(args.TEXT??''),name:String(args.NAME||'scratch.txt')}); }
    async clipboardWrite(args){ await request('clipboardWrite',{text:String(args.TEXT??'')}); }
    clipboardRead(){ return request('clipboardRead'); }
    async notify(args){ await request('notify',{title:String(args.TITLE||'Scratch'),body:String(args.BODY??'')}); }

    speak(args){
      if(!('speechSynthesis' in window)) return;
      const utterance=new SpeechSynthesisUtterance(String(args.TEXT??''));
      utterance.rate=Math.max(0.1,Math.min(10,Number(args.RATE)||1));
      utterance.pitch=Math.max(0,Math.min(2,Number(args.PITCH)||1));
      speechSynthesis.speak(utterance);
    }
    stopSpeech(){ try{speechSynthesis.cancel();}catch{} }

    async saveStagePng(args){
      const base=this.vm?.renderer?.canvas;
      if(!base) throw new Error('Escenario Scratch no disponible');
      const out=document.createElement('canvas');
      out.width=base.width||480; out.height=base.height||360;
      const ctx=out.getContext('2d');
      ctx.drawImage(base,0,0,out.width,out.height);
      const overlay=document.querySelector('canvas.axiom3d-stage');
      if(overlay && overlay.width>1 && overlay.height>1 && getComputedStyle(overlay).display!=='none'){
        ctx.drawImage(overlay,0,0,out.width,out.height);
      }
      const dataUrl=out.toDataURL('image/png');
      await request('savePng',{dataUrl,name:String(args.NAME||'escenario.png')});
    }

    gamepadAxis(args){
      const pad=navigator.getGamepads?.()[Math.max(0,Number(args.PAD)|0)];
      const index=Math.max(0,Number(args.AXIS)|0);
      const value=pad?.axes?.[index];
      return Number.isFinite(value)?value:0;
    }
    gamepadButton(args){
      const pad=navigator.getGamepads?.()[Math.max(0,Number(args.PAD)|0)];
      const index=Math.max(0,Number(args.BUTTON)|0);
      return pad?.buttons?.[index]?.pressed?1:0;
    }
    online(){ return navigator.onLine?1:0; }
    viewportValue(args){
      const item=String(args.VIEW||'ancho');
      if(item==='alto')return window.innerHeight;
      if(item==='pixel ratio')return window.devicePixelRatio||1;
      return window.innerWidth;
    }

    async systemValue(args){
      const info=await request('systemInfo');
      const key=String(args.ITEM||'sistema');
      if(key==='arquitectura')return info.arch||'';
      if(key==='versión del sistema')return info.release||'';
      if(key==='CPUs')return info.cpus||0;
      if(key==='memoria MB')return info.memoryMB||0;
      if(key==='idioma')return info.language||'';
      if(key==='versión AxiomCode')return info.appVersion||'';
      return info.platform||'';
    }
    nowUnix(){ return Date.now(); }
    nowIso(){ return new Date().toISOString(); }
    uuid(){ return crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0,v=c==='x'?r:(r&3|8);return v.toString(16);}); }
  }

  function install(vm){
    if(!vm?.extensionManager) throw new Error('Scratch VM no disponible para Axiom Power');
    if(vm.extensionManager.isExtensionLoaded?.('axiompower')) return window.AxiomPower || null;
    const extension=new AxiomPowerExtension(vm);
    const service=vm.extensionManager._registerInternalExtension(extension);
    vm.extensionManager._loadedExtensions.set('axiompower',service);
    window.AxiomPower=extension;
    try{vm.refreshWorkspace?.();}catch{}
    try{vm.emitWorkspaceUpdate?.();}catch{}
    return extension;
  }

  window.AxiomScratchPower={install,AxiomPowerExtension,request};
})();