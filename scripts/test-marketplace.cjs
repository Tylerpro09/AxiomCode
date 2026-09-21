const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs'),path=require('path'),os=require('os');
const {AxiomExtensionService,DEFAULT_MARKETPLACE_URL}=require('../backend/services/extensionService');

function fakeApp(root){return {getPath(name){assert.equal(name,'userData');return root;}}}

test('AxiomCode uses Render marketplace API by default',()=>{
  assert.equal(DEFAULT_MARKETPLACE_URL,'https://axiomcode-marketplace.onrender.com/api/catalog?includeExternal=1');
});

test('fallback catalog exposes repository extensions',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'axiom-market-'));
  try{
    const service=new AxiomExtensionService(fakeApp(dir),path.resolve(__dirname,'..'));
    const fallback=await service.readFallbackCatalog();
    const scratch=fallback.extensions.find(x=>x.id==='axiom.scratch-mode');
    const runner=fallback.extensions.find(x=>x.id==='axiom.runner');
    const intellicode=fallback.extensions.find(x=>x.id==='visualstudioexptteam.vscodeintellicode');
    assert.ok(scratch);
    assert.ok(runner);
    assert.ok(intellicode);
    assert.equal(intellicode.version,'1.3.2');
    assert.equal(intellicode.install.kind,'external');
    assert.match(intellicode.install.url,/marketplace\.visualstudio\.com/);
    assert.equal(scratch.install.kind,'repository');
    assert.equal(runner.install.kind,'repository');
    assert.equal(scratch.install.subdir,'extensions/scratch-mode');
    assert.equal(runner.install.subdir,'extensions/runner');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('Runner is absent from runtime until installed into userData',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'axiom-market-'));
  try{
    const service=new AxiomExtensionService(fakeApp(dir),path.resolve(__dirname,'..'));
    assert.equal((await service.list()).some(x=>x.id==='axiom.runner'),false);
    const source=path.resolve(__dirname,'..','extensions','runner');
    const target=path.join(dir,'extensions','runner');
    fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.cpSync(source,target,{recursive:true});
    const state=await service.readState();
    state.installed['axiom.runner']=true;
    state.security['axiom.runner']={engine:'AxiomGuard Static 1.0',verdict:'clean',score:0,version:'1.0.0',hashes:{}};
    await service.writeState(state);
    const installed=(await service.list()).find(x=>x.id==='axiom.runner');
    assert.ok(installed);
    assert.equal(installed.installed,true);
    assert.equal(installed.enabled,true);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('official repository metadata overrides stale bundled online catalog',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'axiom-market-'));
  try{
    const service=new AxiomExtensionService(fakeApp(dir),path.resolve(__dirname,'..'));
    service.fetchText=async()=>Buffer.from(JSON.stringify({
      schemaVersion:1,
      name:'stale',
      extensions:[{
        id:'axiom.scratch-mode',
        name:'Modo Scratch',
        version:'2.2.0',
        publisher:'AxiomCode',
        install:{kind:'bundled',bundledId:'axiom.scratch-mode'}
      }]
    }));
    const catalog=await service.marketplace(true);
    const scratch=catalog.extensions.find(x=>x.id==='axiom.scratch-mode');
    const runner=catalog.extensions.find(x=>x.id==='axiom.runner');
    assert.ok(scratch);
    assert.ok(runner);
    assert.equal(scratch.version,'2.4.1');
    assert.equal(scratch.install.kind,'repository');
    assert.equal(runner.install.kind,'repository');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('package path traversal is rejected',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'axiom-market-'));
  try{
    const service=new AxiomExtensionService(fakeApp(dir),path.resolve(__dirname,'..'));
    assert.equal(service.safeRelativeFile('src/main.js'),'src/main.js');
    assert.throws(()=>service.safeRelativeFile('../evil.js'));
    assert.throws(()=>service.safeRelativeFile('C:\\evil.js'));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('semantic-like version ordering supports updates',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'axiom-market-'));
  try{
    const service=new AxiomExtensionService(fakeApp(dir),path.resolve(__dirname,'..'));
    assert.equal(service.compareVersions('2.0.0','1.9.9'),1);
    assert.equal(service.compareVersions('1.0.0-beta','1.0.0'),-1);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('AxiomGuard blocks malicious marketplace package code',()=>{
  const {scanExtensionFiles,assertExtensionSafe}=require('../backend/services/extensionSecurity');
  const malicious=scanExtensionFiles([{path:'index.js',bytes:Buffer.from("const child_process=require('node:child_process'); child_process.spawn('cmd.exe');")}]);
  assert.equal(malicious.verdict,'blocked');
  assert.throws(()=>assertExtensionSafe(malicious),/AxiomGuard bloqueó/);
});

test('AxiomGuard does not block common game function names',()=>{
  const {scanExtensionFiles}=require('../backend/services/extensionSecurity');
  const clean=scanExtensionFiles([{path:'game.js',bytes:Buffer.from("const spawn=()=>({x:0,y:0}); function execFrame(){ return spawn(); }")}]);
  assert.equal(clean.verdict,'clean');
});

test('AxiomGuard disables malicious side-loaded user extensions',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'axiom-market-'));
  try{
    const ext=path.join(dir,'extensions','evil.demo');
    fs.mkdirSync(ext,{recursive:true});
    fs.writeFileSync(path.join(ext,'extension.json'),JSON.stringify({id:'evil.demo',name:'Evil Demo',version:'1.0.0'}));
    fs.writeFileSync(path.join(ext,'main.js'),"const cp=require('child_process');cp.exec('powershell.exe -EncodedCommand AAAA');");
    const service=new AxiomExtensionService(fakeApp(dir),path.resolve(__dirname,'..'));
    const item=(await service.list()).find(x=>x.id==='evil.demo');
    assert.ok(item);
    assert.equal(item.installed,false);
    assert.equal(item.enabled,false);
    assert.equal(item.security.verdict,'blocked');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});