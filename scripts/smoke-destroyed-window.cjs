const {app,BrowserWindow}=require('electron');
const fs=require('fs'),path=require('path'),os=require('os');

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'axiom-destroyed-window-'));
const workspace=path.join(temp,'workspace');
fs.mkdirSync(workspace,{recursive:true});
fs.writeFileSync(path.join(workspace,'a.txt'),'before');

const resultFile=path.join(__dirname,'destroyed-window-result.log');
fs.writeFileSync(resultFile,'Starting destroyed-window watcher smoke\n');
const log=(...args)=>fs.appendFileSync(resultFile,args.map(v=>typeof v==='string'?v:JSON.stringify(v)).join(' ')+'\n');

app.setPath('userData',path.join(temp,'userData'));
let uncaught=null;
process.on('uncaughtException',error=>{uncaught=error;log('UNCAUGHT',error?.stack||error);});
require('../main');

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
  let guard=null;
  try{
    guard=new BrowserWindow({show:false,width:100,height:100});
    let win=null;
    for(let i=0;i<200;i++){
      win=BrowserWindow.getAllWindows().find(item=>item!==guard&&item.isVisible());
      if(win)break;
      await wait(50);
    }
    if(!win)throw new Error('Main window not found');
    await wait(1000);

    await win.webContents.executeJavaScript(`window.axiom.openWorkspacePath(${JSON.stringify(workspace)})`);
    await win.webContents.executeJavaScript(`window.axiom.writeFile(${JSON.stringify(path.join(workspace,'a.txt'))},'after')`);
    await wait(10);

    win.destroy();
    await wait(500);

    if(uncaught)throw uncaught;
    log('PASS watcher event ignored safely after renderer destruction');

    guard.destroy();
    fs.rmSync(temp,{recursive:true,force:true});
    app.exit(0);
  }catch(error){
    log(error?.stack||error);
    try{guard?.destroy();}catch{}
    fs.rmSync(temp,{recursive:true,force:true});
    app.exit(1);
  }
});
