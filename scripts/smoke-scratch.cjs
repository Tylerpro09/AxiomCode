const { app, BrowserWindow, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
// A detached Windows GUI process may outlive the shell's output pipes.
// Keep test diagnostics on disk so closed pipes cannot trigger an Electron dialog.
const smokeLog = path.join(__dirname, 'scratch-smoke-result.log');
const writeLog = (...items) => fs.appendFileSync(smokeLog, items.map(x => x instanceof Error ? x.stack : typeof x === 'string' ? x : JSON.stringify(x)).join(' ') + '\n');
console.log = console.warn = console.error = writeLog;
for (const stream of [process.stdout, process.stderr]) stream.on('error', error => { if (error.code !== 'EPIPE') writeLog(error); });
fs.writeFileSync(smokeLog, 'Starting Scratch smoke test\n');
const scratchTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-scratch-test-'));
app.setPath('userData', scratchTemp);
const extensionSource=path.join(__dirname,'..','extensions','scratch-mode');
const extensionTarget=path.join(scratchTemp,'extensions','scratch-mode');
fs.mkdirSync(path.dirname(extensionTarget),{recursive:true});
fs.cpSync(extensionSource,extensionTarget,{recursive:true});
fs.writeFileSync(path.join(scratchTemp,'extension-state.json'),JSON.stringify({installed:{'axiom.scratch-mode':true},security:{'axiom.scratch-mode':{engine:'AxiomGuard Static 1.0',verdict:'clean',score:0,scannedAt:new Date().toISOString(),version:'2.4.1',hashes:{}}}}));
app.on('browser-window-created', (_, win) => win.hide());
dialog.showSaveDialog = async () => ({ canceled: false, filePath: path.join(scratchTemp, 'test.axiomscratch') });
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path.join(scratchTemp, 'test.axiomscratch')] });
require('../main');
const timeout = setTimeout(() => { console.error('Timed out'); app.exit(1); }, 25000);
app.whenReady().then(async () => {
  try {
    let win;
    for (let i = 0; i < 100; i++) {
      win = BrowserWindow.getAllWindows()[0];
      if (win && await win.webContents.executeJavaScript("Boolean(document.querySelector('#scratchBtn')?.onclick && getComputedStyle(document.querySelector('#scratchBtn')).display!=='none')").catch(() => false)) break;
      await new Promise(r => setTimeout(r, 100));
    }
    const result = await win.webContents.executeJavaScript(`(async () => {
      const check = (v,m) => { if(!v)throw new Error(m); };
      await openScratchMode();
      check(window.AxiomScratch.visible && !document.querySelector('#scratchOfficialMode')?.hidden,'Scratch button did not open official view');
      window.AxiomScratch.hide();
      window.AxiomScratchLegacy.show();
      check(window.AxiomScratchLegacy.visible,'Legacy Scratch compatibility view did not open');
      check(document.querySelectorAll('.scratch-tool').length === 11,'Missing legacy palette blocks');
      const tools=document.querySelectorAll('.scratch-tool');
      const data=new DataTransfer();
      tools[4].dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:data}));
      document.querySelector('.scratch-block .scratch-stack').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));
      check(document.querySelector('.scratch-block .scratch-stack').querySelectorAll('.scratch-block').length===3,'Drop inside repeat failed');
      document.querySelector('.scratch-block .scratch-stack').lastElementChild.previousElementSibling.querySelector('[aria-label="Eliminar bloque"]').click();
      const nested=document.querySelector('.scratch-block .scratch-stack .scratch-block');
      nested.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:data}));
      document.querySelector('#scratchProgram>.scratch-stack').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));
      check(document.querySelector('.scratch-block .scratch-stack').querySelectorAll('.scratch-block').length===1,'Move out of loop failed');
      const topBlocks=document.querySelectorAll('#scratchProgram>.scratch-stack>.scratch-block');
      topBlocks[topBlocks.length-1].dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:data}));
      document.querySelector('.scratch-block .scratch-stack').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));
      document.querySelector('.scratch-block .scratch-stack').querySelectorAll('.scratch-block')[1].querySelector('[aria-label="Subir bloque"]').click();
      await window.AxiomScratchLegacy.run();
      check(document.querySelector('#scratchSpeech').textContent==='\u00a1Hola, AxiomCode!','Program did not execute');
      check(document.querySelector('#scratchPosition').textContent.includes('x: 0'),'Square did not return to origin');
      const initial=document.querySelectorAll('.scratch-block').length;
      document.querySelector('.scratch-tool').click();
      check(document.querySelectorAll('.scratch-block').length===initial+1,'Cannot add block');
      check(await window.AxiomScratchLegacy.save(),'Save failed');
      document.querySelector('#scratchNew').click();
      check(document.querySelectorAll('.scratch-block').length===0,'New failed');
      await window.AxiomScratchLegacy.open();
      check(document.querySelectorAll('.scratch-block').length===initial+1,'Open did not restore blocks');
      const executing=window.AxiomScratchLegacy.run();
      setTimeout(()=>document.querySelector('#scratchStop').click(),20);
      await executing;
      check(document.querySelector('#scratchStatus').textContent==='Detenido','Stop failed');
      window.AxiomScratch.hide();
      check(!window.AxiomScratch.visible,'Return to code failed');
      window.AxiomScratch.show();
      return 'PASS: open, palette, nested drag/drop, move, reorder, execute, add, save, new, reopen, stop, return to code';
    })()`);
    await win.webContents.executeJavaScript('setSideMode("extensions")');
    await new Promise(r => setTimeout(r, 200));
    if (!await win.webContents.executeJavaScript('Boolean(document.querySelector(".scratch-extension-open"))')) throw new Error('Missing extension launch button');
    fs.writeFileSync(path.join(__dirname, 'scratch-smoke.png'), (await win.webContents.capturePage()).toPNG());
    console.log(result); clearTimeout(timeout); app.exit(0);
  } catch (error) { console.error(error); clearTimeout(timeout); app.exit(1); }
});


