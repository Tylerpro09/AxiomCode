const {app,BrowserWindow}=require('electron');
const fs=require('fs'),path=require('path'),os=require('os');

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'axiom-vscode-functions-'));
const project=path.join(temp,'workspace');
fs.mkdirSync(path.join(project,'src'),{recursive:true});
fs.writeFileSync(path.join(project,'src','alpha.js'),'const foo = 1;\nfunction sample(){ return foo; }\n');
fs.writeFileSync(path.join(project,'src','beta.js'),'const Foo = 2;\nconsole.log(foo);\n');

const resultFile=path.join(__dirname,'vscode-functions-result.log');
fs.writeFileSync(resultFile,'Starting VS Code functions smoke\n');
const log=(...x)=>fs.appendFileSync(resultFile,x.map(v=>typeof v==='string'?v:JSON.stringify(v)).join(' ')+'\n');

app.setPath('userData',path.join(temp,'userData'));
require('../main');

const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,label)=>{for(let i=0;i<500;i++){try{const v=await fn();if(v)return v;}catch{}await wait(100)}throw Error('Timeout: '+label)};
const timer=setTimeout(()=>{log('TIMEOUT');app.exit(1)},90000);
const finish=code=>{clearTimeout(timer);app.once('quit',()=>{try{fs.rmSync(temp,{recursive:true,force:true})}catch{}});app.exit(code);};

app.whenReady().then(async()=>{try{
  const win=await until(()=>BrowserWindow.getAllWindows()[0],'window');
  await until(()=>win.webContents.executeJavaScript("Boolean(window.axiom&&document.querySelector('.monaco-editor'))"),'workbench');

  const result=await win.webContents.executeJavaScript(`(async()=>{
    const root=${JSON.stringify(project)};
    const opened=await window.axiom.openWorkspacePath(root);
    useWorkspace(opened,false);
    const before=await window.axiom.searchWorkspace(root,'foo',{matchCase:false});
    const caseOnly=await window.axiom.searchWorkspace(root,'foo',{matchCase:true});
    const replaced=await window.axiom.replaceWorkspace(root,'foo','bar',{matchCase:true});
    const after=await window.axiom.searchWorkspace(root,'foo',{matchCase:true});
    const bars=await window.axiom.searchWorkspace(root,'bar',{matchCase:true});
    await openFile(root+'\\\\src\\\\alpha.js');
    setSideMode('search');
    await new Promise(r=>setTimeout(r,100));
    const searchReplaceUi=Boolean(document.querySelector('#sideReplaceInput')&&document.querySelector('#replaceAllBtn')&&document.querySelector('#searchCaseBtn'));
    const actionIds=['editor.action.rename','editor.action.quickFix','editor.action.triggerSuggest','editor.action.quickOutline','editor.action.marker.next'];
    const actions=Object.fromEntries(actionIds.map(id=>[id,Boolean(editor.getAction(id))]));
    const js=editor.getModel();
    js.setValue('function alphaSymbol(){ return 1; }\\nalphaSymbol();');
    editor.setPosition({lineNumber:2,column:4});
    await new Promise(r=>setTimeout(r,200));
    await goToDefinition();
    const definitionPos=editor.getPosition();
    editor.setPosition({lineNumber:2,column:4});
    const ctx=await tsWorkerForActive();
    const references=ctx?await ctx.worker.getReferencesAtPosition(ctx.uri,ctx.offset):[];
    await peekDefinition();
    const peekVisible=Boolean(document.querySelector('.definition-preview'));
    document.querySelector('.quick-dialog-backdrop')?.remove();
    setSideMode('outline');
    await new Promise(r=>setTimeout(r,300));
    const outlineRows=[...document.querySelectorAll('.outline-row')].map(x=>x.textContent.trim());
    const commandNames=commands.map(x=>x.name);
    return {
      before:before.length,
      caseOnly:caseOnly.length,
      replaced,
      after:after.length,
      bars:bars.length,
      recent:(await window.axiom.recentWorkspaces()).includes(root),
      breadcrumbs:[...document.querySelectorAll('.breadcrumb-item')].map(x=>x.textContent.trim()),
      searchReplaceUi,
      actions,
      definitionPos,
      references:references?.length||0,
      peekVisible,
      outlineRows,
      commandCoverage:[
        'Editor: Ir a definición','Editor: Ver definición','Editor: Ir a referencias',
        'Editor: Cambiar nombre de símbolo','Editor: Acción rápida','Editor: Ir a símbolo...',
        'Proyecto: Buscar y reemplazar','Archivo: Abrir reciente...'
      ].every(name=>commandNames.includes(name))
    };
  })()`);
  log('RESULT',result);
  if(result.before<3)throw Error('Workspace search did not find expected matches');
  if(result.caseOnly!==3)throw Error('Case-sensitive search failed');
  if(result.replaced.replacements!==3||result.replaced.filesChanged<1)throw Error('Workspace replace failed');
  if(result.after!==0||result.bars!==3)throw Error('Workspace replace verification failed');
  if(!result.recent)throw Error('Recent workspace integration failed');
  if(result.breadcrumbs.length<2)throw Error('Breadcrumbs did not render path segments');
  if(!result.searchReplaceUi)throw Error('Search/replace UI missing');
  if(Object.values(result.actions).some(v=>!v))throw Error('One or more Monaco editor actions missing');
  if(result.definitionPos?.lineNumber!==1)throw Error('Go to definition failed');
  if(result.references<2)throw Error('References lookup failed');
  if(!result.peekVisible)throw Error('Peek definition preview failed');
  if(!result.outlineRows?.some(x=>/alphaSymbol/.test(x)))throw Error('Outline view failed');
  if(!result.commandCoverage)throw Error('Command palette coverage missing');
  log('PASS search/replace, recent workspaces, breadcrumbs, editor navigation/actions');
  finish(0);
}catch(error){log(error.stack||error);finish(1)}});
