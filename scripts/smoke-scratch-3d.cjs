const {app,BrowserWindow}=require('electron');
const fs=require('fs'),path=require('path'),os=require('os');
const logFile=path.join(__dirname,'scratch-3d-result.log');
fs.writeFileSync(logFile,'Starting Axiom 3D Scratch test\n');
const log=(...a)=>fs.appendFileSync(logFile,a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ')+'\n');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'axiom-3d-test-'));
app.setPath('userData',temp);
fs.writeFileSync(path.join(temp,'extension-state.json'),JSON.stringify({installed:{'axiom.scratch-mode':true}}));
require('../main');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,label)=>{for(let i=0;i<300;i++){try{const v=await fn();if(v)return v;}catch{}await wait(100)}throw Error('Timeout: '+label)};
const timer=setTimeout(()=>{log('TIMEOUT');app.exit(1)},60000);
app.whenReady().then(async()=>{try{
 const win=await until(()=>BrowserWindow.getAllWindows()[0],'window');
 await until(()=>win.webContents.executeJavaScript("Boolean(window.AxiomScratch&&document.querySelector('#scratchBtn')?.onclick&&getComputedStyle(document.querySelector('#scratchBtn')).display!=='none')"),'workbench');
 win.show(); await wait(200);
 await win.webContents.executeJavaScript('document.querySelector("#scratchBtn").click()');
 const frame=await until(()=>win.webContents.mainFrame.frames.find(f=>f.url.includes('editor.html')),'Scratch frame');
 await until(()=>frame.executeJavaScript('Boolean(window.scratchEditor?.ready&&window.Axiom3D)'),'Axiom 3D');
 await until(()=>frame.executeJavaScript("document.body.innerText.includes('Axiom 3D')"),'Axiom 3D UI');
 const info=await frame.executeJavaScript(`({
   loaded:scratchEditor.vm.extensionManager.isExtensionLoaded('axiom3d'),
   blockInfo:scratchEditor.vm.runtime._blockInfo.some(x=>x.id==='axiom3d'),
   primitives:Object.keys(scratchEditor.vm.runtime._primitives||{}).filter(k=>k.startsWith('axiom3d_')).length,
   webgl:Axiom3D.engine.supported,
   canvas:Boolean(document.querySelector('canvas.axiom3d-stage')),
   ui:document.body.innerText.includes('Axiom 3D')
 })`);
 log('REGISTERED',info);
 if(!info.loaded||!info.blockInfo||info.primitives<10||!info.canvas||!info.ui)throw Error('Axiom 3D was not fully registered');
 const scene=await frame.executeJavaScript(`(async()=>{
   Axiom3D.reset();
   Axiom3D.addCube({ID:'cubo-test',SIZE:2,COLOR:'#ff3344'});
   Axiom3D.setPosition({ID:'cubo-test',X:1,Y:2,Z:-1});
   Axiom3D.setRotation({ID:'cubo-test',X:15,Y:35,Z:5});
   Axiom3D.duplicateObject({SOURCE:'cubo-test',TARGET:'copia-test'});
   Axiom3D.setPosition({ID:'copia-test',X:1,Y:2.5,Z:-1});
   Axiom3D.setVelocity({ID:'cubo-test',X:2,Y:4,Z:0});
   Axiom3D.stepPhysics({DT:0.1,GRAVITY:10,FLOOR:-10,BOUNCE:0});
   Axiom3D.cameraFollow({ID:'cubo-test',X:0,Y:2,Z:6});
   Axiom3D.engine.syncCanvas();
   Axiom3D.engine.render();
   const o=Axiom3D.engine.get('cubo-test');
   const out={count:Axiom3D.objectCount(),pos:o.position.slice(),rot:o.rotation.slice(),vel:o.velocity.slice(),touching:Axiom3D.touchingObjects({A:'cubo-test',B:'copia-test',DIST:1}),camera:Axiom3D.engine.camera.position.slice(),canvas:[Axiom3D.engine.canvas.width,Axiom3D.engine.canvas.height],pixelAlpha:null};
   if(Axiom3D.engine.gl){
     const gl=Axiom3D.engine.gl,p=new Uint8Array(4),x=Math.floor(gl.drawingBufferWidth/2),y=Math.floor(gl.drawingBufferHeight/2);
     gl.readPixels(x,y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);out.pixelAlpha=p[3];
   }
   return out;
 })()`);
 log('SCENE',scene);
 if(scene.count!==2||Math.abs(scene.pos[0]-1.2)>0.0001||Math.abs(scene.vel[1]-3)>0.0001||scene.touching!==1||scene.camera[2]<4||scene.canvas[0]<100)throw Error('3D scene state/render/physics failed');
 const roundtrip=await frame.executeJavaScript(`(async()=>{
   const vm=scratchEditor.vm;
   const project=JSON.parse(vm.toJSON());
   const sprite=project.targets.find(t=>!t.isStage);
   sprite.blocks={
     flag:{opcode:'event_whenflagclicked',next:'reset3d',parent:null,inputs:{},fields:{},shadow:false,topLevel:true,x:80,y:80},
     reset3d:{opcode:'axiom3d_reset',next:null,parent:'flag',inputs:{},fields:{},shadow:false,topLevel:false}
   };
   project.extensions=[...new Set([...(project.extensions||[]),'axiom3d'])];
   await vm.loadProject(JSON.stringify(project));
   Axiom3D.addCube({ID:'before-run',SIZE:1,COLOR:'#00ff88'});
   vm.greenFlag(); await new Promise(r=>setTimeout(r,250)); vm.stopAll();
   if(Axiom3D.objectCount()!==0)throw Error('Scratch custom 3D block did not execute');
   const blob=await vm.saveProjectSb3();
   const bytes=await blob.arrayBuffer();
   await vm.loadProject(bytes);
   Axiom3D.addSphere({ID:'before-reopen-run',RADIUS:1,COLOR:'#3399ff'});
   vm.greenFlag(); await new Promise(r=>setTimeout(r,250)); vm.stopAll();
   if(Axiom3D.objectCount()!==0)throw Error('3D block did not survive SB3 reopen');
   return {bytes:blob.size,loaded:vm.extensionManager.isExtensionLoaded('axiom3d')};
 })()`);
 log('ROUNDTRIP',roundtrip);
 if(roundtrip.bytes<1000||!roundtrip.loaded)throw Error('Axiom 3D SB3 roundtrip failed');
 fs.writeFileSync(path.join(__dirname,'scratch-3d.png'),(await win.webContents.capturePage()).toPNG());
 log('PASS Axiom 3D WebGL, blocks, VM execution and SB3 roundtrip');
 clearTimeout(timer);app.exit(0);
}catch(e){log(e.stack||e);clearTimeout(timer);app.exit(1)}});