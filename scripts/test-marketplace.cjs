const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs'),path=require('path'),os=require('os');
const {AxiomExtensionService,DEFAULT_MARKETPLACE_URL}=require('../backend/services/extensionService');

function fakeApp(root){return {getPath(name){assert.equal(name,'userData');return root;}}}

test('AxiomCode uses Render marketplace API by default',()=>{
  assert.equal(DEFAULT_MARKETPLACE_URL,'https://axiomcode-marketplace.onrender.com/api/catalog');
});

test('fallback catalog exposes bundled Scratch',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'axiom-market-'));
  try{
    const service=new AxiomExtensionService(fakeApp(dir),path.resolve(__dirname,'..'));
    const fallback=await service.readFallbackCatalog();
    const scratch=fallback.extensions.find(x=>x.id==='axiom.scratch-mode');
    assert.ok(scratch);
    assert.equal(scratch.install.kind,'bundled');
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