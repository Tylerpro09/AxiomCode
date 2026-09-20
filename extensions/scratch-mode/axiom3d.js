(() => {
  'use strict';

  const DEG = Math.PI / 180;
  const MAX_OBJECTS = 4096;
  const MAX_COORD = 1000000;
  const MAX_SCALE = 1000000;
  const finite = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const coord = value => clamp(finite(value), -MAX_COORD, MAX_COORD);
  const objectId = value => String(value ?? '').trim().slice(0, 80) || 'objeto';
  const color4 = (value, alpha = 1) => {
    let s = String(value || '#ffffff').trim();
    if (!/^#[0-9a-f]{6}$/i.test(s)) s = '#ffffff';
    return [
      parseInt(s.slice(1, 3), 16) / 255,
      parseInt(s.slice(3, 5), 16) / 255,
      parseInt(s.slice(5, 7), 16) / 255,
      clamp(alpha, 0, 1)
    ];
  };

  const identity = () => new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
  const multiply = (a, b) => {
    const out = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
        out[c * 4 + r] = sum;
      }
    }
    return out;
  };
  const translation = (x, y, z) => {
    const m = identity(); m[12] = x; m[13] = y; m[14] = z; return m;
  };
  const scaling = (x, y, z) => {
    const m = identity(); m[0] = x; m[5] = y; m[10] = z; return m;
  };
  const rotationX = a => {
    const c = Math.cos(a), s = Math.sin(a);
    return new Float32Array([1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]);
  };
  const rotationY = a => {
    const c = Math.cos(a), s = Math.sin(a);
    return new Float32Array([c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]);
  };
  const rotationZ = a => {
    const c = Math.cos(a), s = Math.sin(a);
    return new Float32Array([c,s,0,0, -s,c,0,0, 0,0,1,0, 0,0,0,1]);
  };
  const perspective = (fov, aspect, near = 0.05, far = 100000) => {
    const f = 1 / Math.tan(fov / 2);
    const nf = 1 / (near - far);
    return new Float32Array([
      f / aspect,0,0,0,
      0,f,0,0,
      0,0,(far + near) * nf,-1,
      0,0,(2 * far * near) * nf,0
    ]);
  };
  const normalize = v => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const lookAt = (eye, center) => {
    const z = normalize([eye[0]-center[0], eye[1]-center[1], eye[2]-center[2]]);
    let x = normalize(cross([0,1,0], z));
    if (Math.hypot(...x) < 0.001) x = [1,0,0];
    const y = cross(z, x);
    return new Float32Array([
      x[0],y[0],z[0],0,
      x[1],y[1],z[1],0,
      x[2],y[2],z[2],0,
      -dot(x,eye),-dot(y,eye),-dot(z,eye),1
    ]);
  };

  function cubeGeometry() {
    const positions = [], normals = [];
    const face = (a,b,c,d,n) => {
      for (const v of [a,b,c,a,c,d]) { positions.push(...v); normals.push(...n); }
    };
    face([-.5,-.5,.5],[.5,-.5,.5],[.5,.5,.5],[-.5,.5,.5],[0,0,1]);
    face([.5,-.5,-.5],[-.5,-.5,-.5],[-.5,.5,-.5],[.5,.5,-.5],[0,0,-1]);
    face([.5,-.5,.5],[.5,-.5,-.5],[.5,.5,-.5],[.5,.5,.5],[1,0,0]);
    face([-.5,-.5,-.5],[-.5,-.5,.5],[-.5,.5,.5],[-.5,.5,-.5],[-1,0,0]);
    face([-.5,.5,.5],[.5,.5,.5],[.5,.5,-.5],[-.5,.5,-.5],[0,1,0]);
    face([-.5,-.5,-.5],[.5,-.5,-.5],[.5,-.5,.5],[-.5,-.5,.5],[0,-1,0]);
    return {positions, normals};
  }

  function sphereGeometry(lat = 16, lon = 24) {
    const positions = [], normals = [];
    const point = (theta, phi) => [
      Math.sin(theta) * Math.cos(phi),
      Math.cos(theta),
      Math.sin(theta) * Math.sin(phi)
    ];
    for (let y = 0; y < lat; y++) {
      const t0 = y * Math.PI / lat, t1 = (y + 1) * Math.PI / lat;
      for (let x = 0; x < lon; x++) {
        const p0 = x * Math.PI * 2 / lon, p1 = (x + 1) * Math.PI * 2 / lon;
        const a = point(t0,p0), b = point(t1,p0), c = point(t1,p1), d = point(t0,p1);
        for (const v of [a,b,c,a,c,d]) { positions.push(...v); normals.push(...v); }
      }
    }
    return {positions, normals};
  }

  class Axiom3DEngine {
    constructor(vm) {
      this.vm = vm;
      this.base = vm.renderer && vm.renderer.canvas;
      this.objects = new Map();
      this.camera = {position:[0,0,8], target:[0,0,0], fov:55};
      this.background = [0,0,0,0];
      this.won = false;
      this.enabled = true;
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'axiom3d-stage';
      this.canvas.setAttribute('aria-label', 'Capa 3D de AxiomCode');
      Object.assign(this.canvas.style, {
        position:'absolute',
        left:'0',
        top:'0',
        pointerEvents:'none',
        zIndex:'2',
        display:'block'
      });
      const parent = this.base && this.base.parentElement;
      if (parent) {
        if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
        parent.appendChild(this.canvas);
      }
      this.gl = this.canvas.getContext('webgl', {
        alpha:true,
        antialias:true,
        depth:true,
        premultipliedAlpha:false,
        preserveDrawingBuffer:false
      }) || this.canvas.getContext('experimental-webgl');
      this.supported = Boolean(this.gl);
      if (this.supported) this.initGL();
      this._loop = () => {
        this.syncCanvas();
        if (this.enabled && this.supported) this.render();
        else if (this.gl) {
          this.gl.viewport(0,0,this.canvas.width,this.canvas.height);
          this.gl.clearColor(0,0,0,0);
          this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
        }
        this.animation = requestAnimationFrame(this._loop);
      };
      this.animation = requestAnimationFrame(this._loop);
    }

    compile(type, source) {
      const gl = this.gl, shader = gl.createShader(type);
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const error = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error('Axiom 3D shader: ' + error);
      }
      return shader;
    }

    initGL() {
      const gl = this.gl;
      const vertex = this.compile(gl.VERTEX_SHADER, `
        attribute vec3 aPosition;
        attribute vec3 aNormal;
        uniform mat4 uModel;
        uniform mat4 uView;
        uniform mat4 uProj;
        varying vec3 vNormal;
        void main() {
          vec4 world = uModel * vec4(aPosition, 1.0);
          vNormal = normalize(mat3(uModel) * aNormal);
          gl_Position = uProj * uView * world;
        }
      `);
      const fragment = this.compile(gl.FRAGMENT_SHADER, `
        precision mediump float;
        uniform vec4 uColor;
        varying vec3 vNormal;
        void main() {
          vec3 lightDir = normalize(vec3(0.45, 0.85, 0.65));
          float diffuse = max(dot(normalize(vNormal), lightDir), 0.0);
          float light = 0.28 + diffuse * 0.72;
          gl_FragColor = vec4(uColor.rgb * light, uColor.a);
        }
      `);
      this.program = gl.createProgram();
      gl.attachShader(this.program, vertex);
      gl.attachShader(this.program, fragment);
      gl.linkProgram(this.program);
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
        throw new Error('Axiom 3D program: ' + gl.getProgramInfoLog(this.program));
      }
      this.loc = {
        position:gl.getAttribLocation(this.program,'aPosition'),
        normal:gl.getAttribLocation(this.program,'aNormal'),
        model:gl.getUniformLocation(this.program,'uModel'),
        view:gl.getUniformLocation(this.program,'uView'),
        proj:gl.getUniformLocation(this.program,'uProj'),
        color:gl.getUniformLocation(this.program,'uColor')
      };
      this.geometry = {
        cube:this.uploadGeometry(cubeGeometry()),
        sphere:this.uploadGeometry(sphereGeometry())
      };
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }

    uploadGeometry(data) {
      const gl = this.gl;
      const position = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, position);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data.positions), gl.STATIC_DRAW);
      const normal = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, normal);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data.normals), gl.STATIC_DRAW);
      return {position, normal, count:data.positions.length / 3};
    }

    syncCanvas() {
      if (!this.base || !this.base.isConnected || !this.canvas.parentElement) {
        this.canvas.style.display = 'none';
        return;
      }
      const w = Math.max(1, this.base.clientWidth || this.base.width || 1);
      const h = Math.max(1, this.base.clientHeight || this.base.height || 1);
      if (w < 4 || h < 4) {
        this.canvas.style.display = 'none';
        return;
      }
      this.canvas.style.display = this.enabled ? 'block' : 'none';
      this.canvas.style.left = this.base.offsetLeft + 'px';
      this.canvas.style.top = this.base.offsetTop + 'px';
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const rw = Math.max(1, Math.round(w * ratio));
      const rh = Math.max(1, Math.round(h * ratio));
      if (this.canvas.width !== rw || this.canvas.height !== rh) {
        this.canvas.width = rw;
        this.canvas.height = rh;
      }
    }

    modelMatrix(obj) {
      let m = translation(obj.position[0], obj.position[1], obj.position[2]);
      m = multiply(m, rotationZ(obj.rotation[2] * DEG));
      m = multiply(m, rotationY(obj.rotation[1] * DEG));
      m = multiply(m, rotationX(obj.rotation[0] * DEG));
      return multiply(m, scaling(obj.scale[0], obj.scale[1], obj.scale[2]));
    }

    render() {
      const gl = this.gl;
      if (!gl || this.canvas.width < 2 || this.canvas.height < 2) return;
      gl.viewport(0,0,this.canvas.width,this.canvas.height);
      gl.clearColor(...this.background);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(this.program);
      const aspect = this.canvas.width / this.canvas.height;
      gl.uniformMatrix4fv(this.loc.view, false, lookAt(this.camera.position, this.camera.target));
      gl.uniformMatrix4fv(this.loc.proj, false, perspective(this.camera.fov * DEG, aspect));
      for (const obj of this.objects.values()) {
        if (obj.visible === false) continue;
        const geo = this.geometry[obj.type];
        if (!geo) continue;
        gl.bindBuffer(gl.ARRAY_BUFFER, geo.position);
        gl.enableVertexAttribArray(this.loc.position);
        gl.vertexAttribPointer(this.loc.position, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, geo.normal);
        gl.enableVertexAttribArray(this.loc.normal);
        gl.vertexAttribPointer(this.loc.normal, 3, gl.FLOAT, false, 0, 0);
        gl.uniformMatrix4fv(this.loc.model, false, this.modelMatrix(obj));
        gl.uniform4fv(this.loc.color, obj.color);
        gl.drawArrays(gl.TRIANGLES, 0, geo.count);
      }
    }

    reset() {
      this.objects.clear();
      this.camera.position = [0,0,8];
      this.camera.target = [0,0,0];
      this.camera.fov = 55;
      this.background = [0,0,0,0];
      this.enabled = true;
      this.won = false;
    }

    add(type, id, size, color) {
      id = objectId(id);
      if (!this.objects.has(id) && this.objects.size >= MAX_OBJECTS) return;
      const s = clamp(Math.abs(finite(size,1)), 0.001, MAX_SCALE);
      this.objects.set(id, {
        type,
        position:[0,0,0],
        rotation:[0,0,0],
        scale:[s,s,s],
        color:color4(color),
        visible:true,
        velocity:[0,0,0],
        gravityScale:1
      });
    }

    get(id) { return this.objects.get(objectId(id)); }
    destroy() {
      cancelAnimationFrame(this.animation);
      this.canvas.remove();
    }
  }

  class Axiom3DExtension {
    constructor(vm) {
      this.vm = vm;
      this.engine = new Axiom3DEngine(vm);
    }

    getInfo() {
      return {
        id:'axiom3d',
        name:'Axiom 3D',
        color1:'#5B67F1',
        color2:'#4955D6',
        color3:'#3741B4',
        blocks:[
          {opcode:'reset', blockType:'command', text:'reiniciar escena 3D'},
          {opcode:'show3D', blockType:'command', text:'3D [STATE]', arguments:{
            STATE:{type:'string', menu:'ONOFF', defaultValue:'encendido'}
          }},
          {opcode:'addCube', blockType:'command', text:'crear cubo [ID] tamaño [SIZE] color [COLOR]', arguments:{
            ID:{type:'string', defaultValue:'cubo1'},
            SIZE:{type:'number', defaultValue:1},
            COLOR:{type:'color', defaultValue:'#ff8844'}
          }},
          {opcode:'addSphere', blockType:'command', text:'crear esfera [ID] radio [RADIUS] color [COLOR]', arguments:{
            ID:{type:'string', defaultValue:'esfera1'},
            RADIUS:{type:'number', defaultValue:1},
            COLOR:{type:'color', defaultValue:'#4cc9f0'}
          }},
          {opcode:'setPosition', blockType:'command', text:'poner [ID] en x [X] y [Y] z [Z]', arguments:{
            ID:{type:'string', defaultValue:'cubo1'},
            X:{type:'number', defaultValue:0},
            Y:{type:'number', defaultValue:0},
            Z:{type:'number', defaultValue:0}
          }},
          {opcode:'changePosition', blockType:'command', text:'mover [ID] por x [X] y [Y] z [Z]', arguments:{
            ID:{type:'string', defaultValue:'cubo1'},
            X:{type:'number', defaultValue:1},
            Y:{type:'number', defaultValue:0},
            Z:{type:'number', defaultValue:0}
          }},
          {opcode:'moveToward', blockType:'command', text:'mover [ID] hacia [TARGET] velocidad [SPEED]', arguments:{
            ID:{type:'string', defaultValue:'jugador'},
            TARGET:{type:'string', defaultValue:'meta'},
            SPEED:{type:'number', defaultValue:0.2}
          }},
          {opcode:'setVelocity', blockType:'command', text:'velocidad de [ID] x [X] y [Y] z [Z]', arguments:{
            ID:{type:'string', defaultValue:'cubo1'},
            X:{type:'number', defaultValue:0},
            Y:{type:'number', defaultValue:0},
            Z:{type:'number', defaultValue:0}
          }},
          {opcode:'changeVelocity', blockType:'command', text:'cambiar velocidad de [ID] por x [X] y [Y] z [Z]', arguments:{
            ID:{type:'string', defaultValue:'cubo1'},
            X:{type:'number', defaultValue:0},
            Y:{type:'number', defaultValue:1},
            Z:{type:'number', defaultValue:0}
          }},
          {opcode:'setGravityScale', blockType:'command', text:'gravedad de [ID] multiplicador [SCALE]', arguments:{
            ID:{type:'string', defaultValue:'cubo1'},
            SCALE:{type:'number', defaultValue:1}
          }},
          {opcode:'stepPhysics', blockType:'command', text:'simular física dt [DT] gravedad [GRAVITY] suelo y [FLOOR] rebote [BOUNCE]', arguments:{
            DT:{type:'number', defaultValue:0.033},
            GRAVITY:{type:'number', defaultValue:9.8},
            FLOOR:{type:'number', defaultValue:-3},
            BOUNCE:{type:'number', defaultValue:0.3}
          }},
          {opcode:'setRotation', blockType:'command', text:'girar [ID] a x [X] y [Y] z [Z] grados', arguments:{
            ID:{type:'string', defaultValue:'cubo1'},
            X:{type:'number', defaultValue:0},
            Y:{type:'number', defaultValue:45},
            Z:{type:'number', defaultValue:0}
          }},
          {opcode:'changeRotation', blockType:'command', text:'rotar [ID] por x [X] y [Y] z [Z] grados', arguments:{
            ID:{type:'string', defaultValue:'cubo1'},
            X:{type:'number', defaultValue:0},
            Y:{type:'number', defaultValue:15},
            Z:{type:'number', defaultValue:0}
          }},
          {opcode:'setScale', blockType:'command', text:'escala [ID] x [X] y [Y] z [Z]', arguments:{
            ID:{type:'string', defaultValue:'cubo1'},
            X:{type:'number', defaultValue:1},
            Y:{type:'number', defaultValue:1},
            Z:{type:'number', defaultValue:1}
          }},
          {opcode:'setColor', blockType:'command', text:'color de [ID] [COLOR]', arguments:{
            ID:{type:'string', defaultValue:'cubo1'},
            COLOR:{type:'color', defaultValue:'#ff8844'}
          }},
          {opcode:'deleteObject', blockType:'command', text:'eliminar objeto 3D [ID]', arguments:{
            ID:{type:'string', defaultValue:'cubo1'}
          }},
          {opcode:'duplicateObject', blockType:'command', text:'duplicar [SOURCE] como [TARGET]', arguments:{
            SOURCE:{type:'string', defaultValue:'cubo1'},
            TARGET:{type:'string', defaultValue:'cubo2'}
          }},
          {opcode:'setVisible', blockType:'command', text:'objeto [ID] visible [STATE]', arguments:{
            ID:{type:'string', defaultValue:'cubo1'},
            STATE:{type:'string', menu:'ONOFF', defaultValue:'encendido'}
          }},
          {opcode:'setOpacity', blockType:'command', text:'opacidad de [ID] [ALPHA] %', arguments:{
            ID:{type:'string', defaultValue:'cubo1'},
            ALPHA:{type:'number', defaultValue:100}
          }},
          {opcode:'deletePrefix', blockType:'command', text:'eliminar objetos con prefijo [PREFIX]', arguments:{
            PREFIX:{type:'string', defaultValue:'muro'}
          }},
          '---',
          {opcode:'setCamera', blockType:'command', text:'cámara en x [X] y [Y] z [Z]', arguments:{
            X:{type:'number', defaultValue:0},
            Y:{type:'number', defaultValue:0},
            Z:{type:'number', defaultValue:8}
          }},
          {opcode:'lookAt', blockType:'command', text:'cámara mira a x [X] y [Y] z [Z]', arguments:{
            X:{type:'number', defaultValue:0},
            Y:{type:'number', defaultValue:0},
            Z:{type:'number', defaultValue:0}
          }},
          {opcode:'orbitCamera', blockType:'command', text:'orbitar cámara radio [RADIUS] yaw [YAW] pitch [PITCH]', arguments:{
            RADIUS:{type:'number', defaultValue:8},
            YAW:{type:'number', defaultValue:45},
            PITCH:{type:'number', defaultValue:20}
          }},
          {opcode:'setFov', blockType:'command', text:'campo de visión [FOV] grados', arguments:{
            FOV:{type:'number', defaultValue:55}
          }},
          {opcode:'setBackground', blockType:'command', text:'fondo 3D [COLOR] opacidad [ALPHA] %', arguments:{
            COLOR:{type:'color', defaultValue:'#000000'},
            ALPHA:{type:'number', defaultValue:0}
          }},
          '---',
          {opcode:'axisOf', blockType:'reporter', text:'[AXIS] de [ID]', arguments:{
            AXIS:{type:'string', menu:'AXIS', defaultValue:'x'},
            ID:{type:'string', defaultValue:'cubo1'}
          }},
          {opcode:'rotationOf', blockType:'reporter', text:'rotación [AXIS] de [ID]', arguments:{
            AXIS:{type:'string', menu:'AXIS', defaultValue:'y'},
            ID:{type:'string', defaultValue:'cubo1'}
          }},
          {opcode:'scaleOf', blockType:'reporter', text:'escala [AXIS] de [ID]', arguments:{
            AXIS:{type:'string', menu:'AXIS', defaultValue:'x'},
            ID:{type:'string', defaultValue:'cubo1'}
          }},
          {opcode:'objectExists', blockType:'reporter', text:'existe objeto [ID] (1/0)', arguments:{
            ID:{type:'string', defaultValue:'cubo1'}
          }},
          {opcode:'distanceBetween', blockType:'reporter', text:'distancia entre [A] y [B]', arguments:{
            A:{type:'string', defaultValue:'jugador'},
            B:{type:'string', defaultValue:'meta'}
          }},
          {opcode:'velocityOf', blockType:'reporter', text:'velocidad [AXIS] de [ID]', arguments:{
            AXIS:{type:'string', menu:'AXIS', defaultValue:'y'},
            ID:{type:'string', defaultValue:'cubo1'}
          }},
          {opcode:'touchingObjects', blockType:'reporter', text:'[A] toca [B] radio [DIST] (1/0)', arguments:{
            A:{type:'string', defaultValue:'jugador'},
            B:{type:'string', defaultValue:'meta'},
            DIST:{type:'number', defaultValue:1}
          }},
          {opcode:'cameraFollow', blockType:'command', text:'cámara sigue [ID] offset x [X] y [Y] z [Z]', arguments:{
            ID:{type:'string', defaultValue:'jugador'},
            X:{type:'number', defaultValue:0},
            Y:{type:'number', defaultValue:2},
            Z:{type:'number', defaultValue:6}
          }},
          {opcode:'moveCollide', blockType:'command', text:'mover [ID] x [X] y [Y] z [Z] evitando [PREFIX] radio [DIST]', arguments:{
            ID:{type:'string', defaultValue:'jugador'},
            X:{type:'number', defaultValue:0.2},
            Y:{type:'number', defaultValue:0},
            Z:{type:'number', defaultValue:0},
            PREFIX:{type:'string', defaultValue:'muro'},
            DIST:{type:'number', defaultValue:1.05}
          }},
          {opcode:'checkGoal', blockType:'command', text:'comprobar meta [PLAYER] con [GOAL] radio [DIST]', arguments:{
            PLAYER:{type:'string', defaultValue:'jugador'},
            GOAL:{type:'string', defaultValue:'meta'},
            DIST:{type:'number', defaultValue:1.15}
          }},
          {opcode:'goalReached', blockType:'reporter', text:'meta alcanzada (1/0)'},
          {opcode:'objectCount', blockType:'reporter', text:'cantidad de objetos 3D'},
          {opcode:'webglAvailable', blockType:'reporter', text:'WebGL 3D disponible (1/0)'}
        ],
        menus:{
          ONOFF:{acceptReporters:true, items:['encendido','apagado']},
          AXIS:{acceptReporters:true, items:['x','y','z']}
        }
      };
    }

    reset() { this.engine.reset(); }
    show3D(args) { this.engine.enabled = String(args.STATE).toLowerCase() !== 'apagado'; }

    addCube(args) {
      this.engine.add('cube', args.ID, args.SIZE, args.COLOR);
    }

    addSphere(args) {
      this.engine.add('sphere', args.ID, args.RADIUS, args.COLOR);
    }

    setPosition(args) {
      const obj = this.engine.get(args.ID); if (!obj) return;
      obj.position = [coord(args.X), coord(args.Y), coord(args.Z)];
    }

    changePosition(args) {
      const obj = this.engine.get(args.ID); if (!obj) return;
      obj.position[0] = coord(obj.position[0] + finite(args.X));
      obj.position[1] = coord(obj.position[1] + finite(args.Y));
      obj.position[2] = coord(obj.position[2] + finite(args.Z));
    }

    moveToward(args) {
      const obj=this.engine.get(args.ID), target=this.engine.get(args.TARGET);
      if(!obj||!target) return;
      const dx=target.position[0]-obj.position[0],dy=target.position[1]-obj.position[1],dz=target.position[2]-obj.position[2];
      const len=Math.hypot(dx,dy,dz); if(len<1e-9) return;
      const speed=finite(args.SPEED,0.2);
      obj.position[0]=coord(obj.position[0]+dx/len*speed);
      obj.position[1]=coord(obj.position[1]+dy/len*speed);
      obj.position[2]=coord(obj.position[2]+dz/len*speed);
    }

    setVelocity(args) {
      const obj=this.engine.get(args.ID); if(!obj) return;
      obj.velocity=[finite(args.X),finite(args.Y),finite(args.Z)];
    }

    changeVelocity(args) {
      const obj=this.engine.get(args.ID); if(!obj) return;
      obj.velocity=obj.velocity||[0,0,0];
      obj.velocity[0]+=finite(args.X); obj.velocity[1]+=finite(args.Y); obj.velocity[2]+=finite(args.Z);
    }

    setGravityScale(args) {
      const obj=this.engine.get(args.ID); if(!obj) return;
      obj.gravityScale=clamp(finite(args.SCALE,1),-1000,1000);
    }

    stepPhysics(args) {
      const dt=clamp(Math.abs(finite(args.DT,0.033)),0,5);
      const gravity=clamp(finite(args.GRAVITY,9.8),-100000,100000);
      const floor=coord(args.FLOOR);
      const bounce=clamp(finite(args.BOUNCE,0.3),0,1);
      for(const obj of this.engine.objects.values()){
        obj.velocity=obj.velocity||[0,0,0];
        const gs=Number.isFinite(obj.gravityScale)?obj.gravityScale:1;
        obj.velocity[1]-=gravity*gs*dt;
        obj.position[0]=coord(obj.position[0]+obj.velocity[0]*dt);
        obj.position[1]=coord(obj.position[1]+obj.velocity[1]*dt);
        obj.position[2]=coord(obj.position[2]+obj.velocity[2]*dt);
        if(obj.position[1]<floor){
          obj.position[1]=floor;
          if(obj.velocity[1]<0)obj.velocity[1]=-obj.velocity[1]*bounce;
        }
      }
    }

    setRotation(args) {
      const obj = this.engine.get(args.ID); if (!obj) return;
      obj.rotation = [finite(args.X), finite(args.Y), finite(args.Z)];
    }

    changeRotation(args) {
      const obj = this.engine.get(args.ID); if (!obj) return;
      obj.rotation[0] += finite(args.X);
      obj.rotation[1] += finite(args.Y);
      obj.rotation[2] += finite(args.Z);
    }

    setScale(args) {
      const obj = this.engine.get(args.ID); if (!obj) return;
      obj.scale = [
        clamp(Math.abs(finite(args.X,1)),0.001,MAX_SCALE),
        clamp(Math.abs(finite(args.Y,1)),0.001,MAX_SCALE),
        clamp(Math.abs(finite(args.Z,1)),0.001,MAX_SCALE)
      ];
    }

    setColor(args) {
      const obj = this.engine.get(args.ID); if (!obj) return;
      obj.color = color4(args.COLOR);
    }

    deleteObject(args) {
      this.engine.objects.delete(objectId(args.ID));
    }

    duplicateObject(args) {
      const source=this.engine.get(args.SOURCE); if(!source) return;
      const target=objectId(args.TARGET);
      if(!this.engine.objects.has(target) && this.engine.objects.size>=MAX_OBJECTS) return;
      this.engine.objects.set(target,{
        type:source.type,
        position:source.position.slice(),
        rotation:source.rotation.slice(),
        scale:source.scale.slice(),
        color:source.color.slice(),
        visible:source.visible!==false,
        velocity:(source.velocity||[0,0,0]).slice(),
        gravityScale:Number.isFinite(source.gravityScale)?source.gravityScale:1
      });
    }

    setVisible(args) {
      const obj=this.engine.get(args.ID); if(!obj) return;
      obj.visible=String(args.STATE).toLowerCase()!=='apagado';
    }

    setOpacity(args) {
      const obj=this.engine.get(args.ID); if(!obj) return;
      obj.color[3]=clamp(finite(args.ALPHA,100),0,100)/100;
    }

    deletePrefix(args) {
      const prefix=String(args.PREFIX||'');
      for(const id of [...this.engine.objects.keys()]) if(id.startsWith(prefix)) this.engine.objects.delete(id);
    }

    setCamera(args) {
      this.engine.camera.position = [coord(args.X), coord(args.Y), coord(args.Z||8)];
    }

    lookAt(args) {
      this.engine.camera.target = [coord(args.X), coord(args.Y), coord(args.Z)];
    }

    orbitCamera(args) {
      const radius=clamp(Math.abs(finite(args.RADIUS,8)),0.01,MAX_COORD);
      const yaw=finite(args.YAW,45)*DEG;
      const pitch=clamp(finite(args.PITCH,20),-89.9,89.9)*DEG;
      const t=this.engine.camera.target;
      const flat=radius*Math.cos(pitch);
      this.engine.camera.position=[
        t[0]+flat*Math.sin(yaw),
        t[1]+radius*Math.sin(pitch),
        t[2]+flat*Math.cos(yaw)
      ];
    }

    setFov(args) {
      this.engine.camera.fov = clamp(finite(args.FOV,55), 15, 140);
    }

    setBackground(args) {
      this.engine.background = color4(args.COLOR, clamp(finite(args.ALPHA,0),0,100) / 100);
    }

    axisOf(args) {
      const obj = this.engine.get(args.ID); if (!obj) return 0;
      const axis = String(args.AXIS).toLowerCase();
      return obj.position[axis === 'y' ? 1 : axis === 'z' ? 2 : 0];
    }

    rotationOf(args) {
      const obj=this.engine.get(args.ID); if(!obj) return 0;
      const axis=String(args.AXIS).toLowerCase();
      return obj.rotation[axis==='y'?1:axis==='z'?2:0];
    }

    scaleOf(args) {
      const obj=this.engine.get(args.ID); if(!obj) return 0;
      const axis=String(args.AXIS).toLowerCase();
      return obj.scale[axis==='y'?1:axis==='z'?2:0];
    }

    objectExists(args) { return this.engine.get(args.ID) ? 1 : 0; }

    distanceBetween(args) {
      const a=this.engine.get(args.A), b=this.engine.get(args.B);
      if(!a||!b) return 999999;
      return Math.hypot(a.position[0]-b.position[0],a.position[1]-b.position[1],a.position[2]-b.position[2]);
    }

    velocityOf(args) {
      const obj=this.engine.get(args.ID); if(!obj) return 0;
      const v=obj.velocity||[0,0,0], axis=String(args.AXIS).toLowerCase();
      return v[axis==='y'?1:axis==='z'?2:0];
    }

    touchingObjects(args) {
      const a=this.engine.get(args.A), b=this.engine.get(args.B); if(!a||!b) return 0;
      const dist=Math.max(0,finite(args.DIST,1));
      return Math.hypot(a.position[0]-b.position[0],a.position[1]-b.position[1],a.position[2]-b.position[2])<=dist?1:0;
    }

    cameraFollow(args) {
      const obj=this.engine.get(args.ID); if(!obj) return;
      this.engine.camera.target=obj.position.slice();
      this.engine.camera.position=[
        coord(obj.position[0]+finite(args.X)),
        coord(obj.position[1]+finite(args.Y)),
        coord(obj.position[2]+finite(args.Z))
      ];
    }

    moveCollide(args) {
      const obj=this.engine.get(args.ID); if(!obj) return;
      const prev=obj.position.slice();
      obj.position[0]+=finite(args.X); obj.position[1]+=finite(args.Y); obj.position[2]+=finite(args.Z);
      const prefix=String(args.PREFIX||''); const dist=Math.max(0,finite(args.DIST,1));
      for(const [id,other] of this.engine.objects){
        if(id===objectId(args.ID)||!id.startsWith(prefix)) continue;
        const d=Math.hypot(obj.position[0]-other.position[0],obj.position[1]-other.position[1],obj.position[2]-other.position[2]);
        if(d<dist){ obj.position=prev; return; }
      }
    }

    checkGoal(args) {
      const a=this.engine.get(args.PLAYER), b=this.engine.get(args.GOAL); if(!a||!b) return;
      const d=Math.hypot(a.position[0]-b.position[0],a.position[1]-b.position[1],a.position[2]-b.position[2]);
      if(d<=Math.max(0,finite(args.DIST,1.15))){
        this.engine.won=true; a.color=color4('#ffd84d'); b.color=color4('#fff16a'); this.engine.background=color4('#123b24',0.92);
      }
    }

    goalReached() { return this.engine.won ? 1 : 0; }
    objectCount() { return this.engine.objects.size; }
    webglAvailable() { return this.engine.supported; }
  }

  function install(vm) {
    if (!vm || !vm.extensionManager) throw new Error('Scratch VM no disponible para Axiom 3D');
    if (vm.extensionManager.isExtensionLoaded && vm.extensionManager.isExtensionLoaded('axiom3d')) {
      return window.Axiom3D || null;
    }
    const extension = new Axiom3DExtension(vm);
    const service = vm.extensionManager._registerInternalExtension(extension);
    vm.extensionManager._loadedExtensions.set('axiom3d', service);
    window.Axiom3D = extension;
    try { vm.refreshWorkspace && vm.refreshWorkspace(); } catch {}
    try { vm.emitWorkspaceUpdate && vm.emitWorkspaceUpdate(); } catch {}
    return extension;
  }

  window.AxiomScratch3D = {install, Axiom3DExtension, Axiom3DEngine};
})();