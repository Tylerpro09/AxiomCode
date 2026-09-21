const fs=require('fs');
const path=require('path');
const {execFile}=require('child_process');

const ps=s=>"'"+String(s).replace(/'/g,"''")+"'";
const extOf=file=>path.extname(String(file||'')).slice(1).toLowerCase();
const execCmd=(tool,args)=>'& '+ps(tool)+' '+args.map(ps).join(' ');

function findProject(file,extension){
  let dir=path.dirname(file);
  for(let i=0;i<10;i++){
    try{
      const hit=fs.readdirSync(dir).find(name=>name.toLowerCase().endsWith(extension));
      if(hit)return path.join(dir,hit);
    }catch{}
    const parent=path.dirname(dir);
    if(parent===dir)break;
    dir=parent;
  }
  return null;
}

function candidatesFor(file){
  const ext=extOf(file), q=ps(file);
  const direct=(name,tools,args=[file])=>({name,tools:tools.map(tool=>({tool,command:execCmd(tool,args)}))});
  if(['js','mjs','cjs'].includes(ext))return direct('JavaScript',['node']);
  if(['ts','tsx'].includes(ext))return {name:'TypeScript',tools:[
    {tool:'tsx',command:execCmd('tsx',[file])},
    {tool:'npx',checkArgs:['--no-install','tsx','--version'],command:execCmd('npx',['--no-install','tsx',file])}
  ]};
  if(ext==='py')return direct('Python',['py','python','python3']);
  if(ext==='ps1')return {name:'PowerShell',tools:[{tool:'powershell.exe',command:execCmd('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',file])}]};
  if(['bat','cmd'].includes(ext))return {name:'Batch / CMD',tools:[{tool:'cmd.exe',command:execCmd('cmd.exe',['/d','/c',file])}]};
  if(ext==='php')return direct('PHP',['php']);
  if(ext==='rb')return direct('Ruby',['ruby']);
  if(ext==='pl')return direct('Perl',['perl']);
  if(ext==='lua')return direct('Lua',['lua']);
  if(ext==='go')return {name:'Go',tools:[{tool:'go',command:execCmd('go',['run',file])}]};
  if(ext==='dart')return direct('Dart',['dart'],['run',file]);
  if(ext==='sh')return direct('Bash',['bash']);
  if(['html','htm'].includes(ext))return {name:'HTML',tools:[{tool:null,command:'Start-Process -LiteralPath '+q}]};
  if(ext==='java')return {name:'Java',tools:[{tool:'java',command:execCmd('java',[file])}]};
  if(ext==='rs')return {name:'Rust',tools:[{tool:'rustc',command:
    "$axiomOut=Join-Path $env:TEMP ('axiom-runner-'+[guid]::NewGuid().ToString('N')+'.exe'); "+
    execCmd('rustc',[file,'-o'])+" $axiomOut; if($LASTEXITCODE -eq 0){ & $axiomOut }; Remove-Item -LiteralPath $axiomOut -Force -ErrorAction SilentlyContinue"}]};
  if(ext==='c')return {name:'C',tools:[{tool:'gcc',command:
    "$axiomOut=Join-Path $env:TEMP ('axiom-runner-'+[guid]::NewGuid().ToString('N')+'.exe'); "+
    execCmd('gcc',[file,'-o'])+" $axiomOut; if($LASTEXITCODE -eq 0){ & $axiomOut }; Remove-Item -LiteralPath $axiomOut -Force -ErrorAction SilentlyContinue"}]};
  if(['cpp','cc','cxx'].includes(ext))return {name:'C++',tools:[
    {tool:'g++',command:"$axiomOut=Join-Path $env:TEMP ('axiom-runner-'+[guid]::NewGuid().ToString('N')+'.exe'); "+execCmd('g++',[file,'-o'])+" $axiomOut; if($LASTEXITCODE -eq 0){ & $axiomOut }; Remove-Item -LiteralPath $axiomOut -Force -ErrorAction SilentlyContinue"},
    {tool:'clang++',command:"$axiomOut=Join-Path $env:TEMP ('axiom-runner-'+[guid]::NewGuid().ToString('N')+'.exe'); "+execCmd('clang++',[file,'-o'])+" $axiomOut; if($LASTEXITCODE -eq 0){ & $axiomOut }; Remove-Item -LiteralPath $axiomOut -Force -ErrorAction SilentlyContinue"}
  ]};
  if(ext==='cs'){
    const project=findProject(file,'.csproj');
    if(!project)return {name:'C#',tools:[],reason:'Runner necesita un archivo .csproj para ejecutar C#.'};
    return {name:'C#',tools:[{tool:'dotnet',command:execCmd('dotnet',['run','--project',project])}]};
  }
  return null;
}

function probeTool(spec){
  if(!spec.tool)return Promise.resolve({ok:true,path:null});
  return new Promise(resolve=>{
    const args=spec.checkArgs||[];
    if(args.length){
      execFile(spec.tool,args,{windowsHide:true,timeout:5000},(error,stdout)=>resolve({ok:!error,path:String(stdout||'').trim()||spec.tool}));
      return;
    }
    execFile('where.exe',[spec.tool],{windowsHide:true,timeout:3000},(error,stdout)=>resolve({ok:!error,path:String(stdout||'').split(/\r?\n/).find(Boolean)||null}));
  });
}

class RunnerService{
  describe(file){
    const item=candidatesFor(file);
    if(!item)return {supported:false,extension:extOf(file),name:null,candidates:[]};
    return {supported:Boolean(item.tools.length),extension:extOf(file),name:item.name,candidates:item.tools.map(x=>x.tool||'sistema'),reason:item.reason||null};
  }

  async prepare(file){
    const item=candidatesFor(file);
    if(!item)return {supported:false,available:false,extension:extOf(file),reason:'Runner no tiene un ejecutor para este tipo de archivo.'};
    if(!item.tools.length)return {supported:false,available:false,extension:extOf(file),name:item.name,reason:item.reason||'No se puede ejecutar este archivo.'};
    for(const spec of item.tools){
      const probe=await probeTool(spec);
      if(probe.ok)return {supported:true,available:true,extension:extOf(file),name:item.name,tool:spec.tool||'sistema',toolPath:probe.path,command:spec.command};
    }
    return {supported:true,available:false,extension:extOf(file),name:item.name,candidates:item.tools.map(x=>x.tool).filter(Boolean),reason:'No se encontró un runtime compatible en PATH.'};
  }
}

module.exports={RunnerService,candidatesFor,ps};