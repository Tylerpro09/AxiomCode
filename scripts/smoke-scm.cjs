const {app,BrowserWindow}=require('electron');
const fs=require('fs'),path=require('path'),os=require('os');
const {spawnSync}=require('child_process');

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'axiom-scm-'));
const workspace=path.join(temp,'repo');
fs.mkdirSync(workspace,{recursive:true});

function git(args){
  const r=spawnSync('git',args,{cwd:workspace,encoding:'utf8',windowsHide:true});
  if(r.status!==0)throw new Error('git '+args.join(' ')+' failed: '+(r.stderr||r.stdout));
  return r.stdout;
}
git(['init','-b','main']);
git(['config','user.email','axiom@test.local']);
git(['config','user.name','Axiom Test']);
fs.writeFileSync(path.join(workspace,'sample.txt'),'one\n');
git(['add','sample.txt']);
git(['commit','-m','initial']);
git(['branch','feature']);
fs.writeFileSync(path.join(workspace,'sample.txt'),'two\n');

const resultFile=path.join(__dirname,'scm-smoke-result.log');
fs.writeFileSync(resultFile,'Starting SCM smoke\n');
const log=(...args)=>fs.appendFileSync(resultFile,args.map(v=>typeof v==='string'?v:JSON.stringify(v)).join(' ')+'\n');

app.setPath('userData',path.join(temp,'userData'));
require('../main');

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(fn,label)=>{for(let i=0;i<400;i++){try{const v=await fn();if(v)return v;}catch{}await wait(100)}throw new Error('Timeout: '+label)};
const finish=code=>{app.once('quit',()=>{try{fs.rmSync(temp,{recursive:true,force:true})}catch{}});app.exit(code);};

app.whenReady().then(async()=>{try{
  const win=await until(()=>BrowserWindow.getAllWindows()[0],'window');
  await until(()=>win.webContents.executeJavaScript("Boolean(window.axiom&&document.querySelector('.monaco-editor'))"),'workbench');
  const result=await win.webContents.executeJavaScript(`(async()=>{
    const root=${JSON.stringify(workspace)};
    const initial=await window.axiom.gitChanges(root);
    const stage=await window.axiom.gitStageFile(root,'sample.txt');
    const staged=await window.axiom.gitChanges(root);
    const unstage=await window.axiom.gitUnstageFile(root,'sample.txt');
    const unstaged=await window.axiom.gitChanges(root);
    const branches=await window.axiom.gitBranches(root);
    const checkout=await window.axiom.gitCheckout(root,'feature');
    const status=await window.axiom.gitStatus(root);
    const discard=await window.axiom.gitDiscardFile(root,'sample.txt');
    const clean=await window.axiom.gitChanges(root);
    return {initial,stage,staged,unstage,unstaged,branches,checkout,status,discard,clean};
  })()`);
  log('RESULT',result);
  if(!result.initial.ok||!/ M sample\.txt/.test(result.initial.stdout))throw new Error('Initial unstaged state missing');
  if(!result.stage.ok||!/^M  sample\.txt/m.test(result.staged.stdout))throw new Error('Stage file failed');
  if(!result.unstage.ok||!/ M sample\.txt/.test(result.unstaged.stdout))throw new Error('Unstage file failed');
  if(!result.branches.ok||!result.branches.stdout.includes('feature'))throw new Error('Branch listing failed');
  if(!result.checkout.ok||!/^## feature/m.test(result.status.stdout))throw new Error('Branch checkout failed');
  if(!result.discard.ok||String(result.clean.stdout).trim())throw new Error('Discard file failed');
  log('PASS per-file stage, unstage, discard, branches and checkout');
  finish(0);
}catch(error){log(error?.stack||error);finish(1)}});
