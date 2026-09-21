const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('path');
const os=require('os');
const fs=require('fs');
const {RunnerService,candidatesFor,ps}=require('../extensions/runner/runnerService');

test('Runner recognizes core languages',()=>{
  assert.equal(candidatesFor('C:\\work\\app.js').name,'JavaScript');
  assert.equal(candidatesFor('C:\\work\\app.ts').name,'TypeScript');
  assert.equal(candidatesFor('C:\\work\\main.py').name,'Python');
  assert.equal(candidatesFor('C:\\work\\main.rs').name,'Rust');
  assert.equal(candidatesFor('C:\\work\\main.cpp').name,'C++');
  assert.equal(candidatesFor('C:\\work\\Main.java').name,'Java');
});

test('Runner PowerShell quoting escapes apostrophes',()=>{
  assert.equal(ps("C:\\O'Brien\\app.js"),"'C:\\O''Brien\\app.js'");
});

test('Runner reports unsupported files cleanly',()=>{
  const service=new RunnerService();
  const info=service.describe('C:\\work\\notes.txt');
  assert.equal(info.supported,false);
  assert.equal(info.extension,'txt');
});

test('Runner opens HTML without external runtime',async()=>{
  const service=new RunnerService();
  const plan=await service.prepare('C:\\work\\index.html');
  assert.equal(plan.supported,true);
  assert.equal(plan.available,true);
  assert.equal(plan.tool,'sistema');
  assert.match(plan.command,/Start-Process/);
});

test('Runner finds a C# project before building a plan',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'axiom-runner-'));
  try{
    const dir=path.join(root,'src');fs.mkdirSync(dir);
    const file=path.join(dir,'Program.cs');fs.writeFileSync(file,'Console.WriteLine("ok");');
    fs.writeFileSync(path.join(root,'Demo.csproj'),'<Project Sdk="Microsoft.NET.Sdk"></Project>');
    const plan=candidatesFor(file);
    assert.equal(plan.name,'C#');
    assert.match(plan.tools[0].command,/Demo\.csproj/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
