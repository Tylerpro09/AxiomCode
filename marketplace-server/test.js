const test=require('node:test');
const assert=require('node:assert/strict');
const {parseRepoUrl,validateManifest,compareVersions,supabaseConfig}=require('./server');

test('parse GitHub repository URL',()=>{
  assert.deepEqual(parseRepoUrl('https://github.com/user/repo.git'),{owner:'user',repo:'repo',url:'https://github.com/user/repo'});
  assert.throws(()=>parseRepoUrl('https://example.com/user/repo'));
});
test('validate manifest',()=>{
  const m=validateManifest({id:'demo.ext',name:'Demo',version:'1.2.3',keywords:['x']});
  assert.equal(m.id,'demo.ext');
  assert.throws(()=>validateManifest({id:'../bad',name:'Bad',version:'1'}));
});
test('compare versions',()=>{
  assert.equal(compareVersions('1.2.0','1.1.9'),1);
  assert.equal(compareVersions('1.0.0','1.0.0'),0);
  assert.equal(compareVersions('1.0.0-beta','1.0.0'),-1);
});

test('Supabase configuration uses server secret variable',()=>{
  const cfg=supabaseConfig();
  assert.equal(typeof cfg.secretConfigured,'boolean');
  assert.equal(typeof cfg.publishableConfigured,'boolean');
});

const {scanExtensionFiles,assertExtensionSafe}=require('../backend/services/extensionSecurity');

test('AxiomGuard allows normal extension code',()=>{
  const report=scanExtensionFiles([{path:'main.js',bytes:Buffer.from("function spawnParticle(){ return 1 }\nmodule.exports={spawnParticle};")}]);
  assert.equal(report.verdict,'clean');
  assert.doesNotThrow(()=>assertExtensionSafe(report));
});

test('AxiomGuard blocks child_process and encoded PowerShell',()=>{
  const report=scanExtensionFiles([{path:'main.js',bytes:Buffer.from("const cp=require('child_process'); cp.exec('powershell.exe -EncodedCommand AAAA');")}]);
  assert.equal(report.verdict,'blocked');
  assert.throws(()=>assertExtensionSafe(report),/AxiomGuard bloqueó/);
  assert.ok(report.findings.some(x=>x.rule==='child-process'));
});

test('AxiomGuard blocks executable script payloads',()=>{
  const report=scanExtensionFiles([{path:'payload.ps1',bytes:Buffer.from("Write-Host test")}]);
  assert.equal(report.verdict,'blocked');
  assert.ok(report.findings.some(x=>x.rule==='blocked-file-type'));
});

test('AxiomGuard ignores documentation-only security terms',()=>{
  const report=scanExtensionFiles([{path:'README.md',bytes:Buffer.from("Do not use require('child_process') or PowerShell -EncodedCommand in extensions.")}]);
  assert.equal(report.verdict,'clean');
});

const vscodeGallery=require('./vscodeGallery');

test('VS Code gallery adapter returns native extensionquery shape',()=>{
  const catalog={extensions:[{
    id:'demo.hello',
    name:'Hello',
    version:'1.0.0',
    description:'Demo',
    publisher:'demo',
    tags:['test'],
    downloads:3,
    install:{kind:'vscode-files',files:[],vscode:{manifest:{name:'hello',publisher:'demo',version:'1.0.0',engines:{vscode:'^1.80.0'},categories:['Other']}}}
  }]};
  const body={filters:[{criteria:[{filterType:10,value:'hello'}],pageNumber:1,pageSize:50,sortBy:0,sortOrder:0}],assetTypes:[],flags:0};
  const out=vscodeGallery.query(catalog,body,'https://market.example');
  const ext=out.results[0].extensions[0];
  assert.equal(ext.extensionName,'hello');
  assert.equal(ext.publisher.publisherName,'demo');
  assert.ok(ext.versions[0].files.some(x=>x.assetType===vscodeGallery.ASSET.vsix));
  assert.ok(ext.versions[0].files.some(x=>x.assetType===vscodeGallery.ASSET.manifest));
});

test('VS Code gallery adapter excludes legacy-only packages',()=>{
  const out=vscodeGallery.query({extensions:[{id:'legacy.demo',name:'Legacy',version:'1.0.0',install:{kind:'files',files:[]}}]},{
    filters:[{criteria:[],pageNumber:1,pageSize:50,sortBy:0,sortOrder:0}]
  },'https://market.example');
  assert.equal(out.results[0].extensions.length,0);
});