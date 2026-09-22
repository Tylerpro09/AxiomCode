const fs=require('fs');
const path=require('path');
const asar=require('@electron/asar');

const root=path.resolve(__dirname,'..');
const output=String(process.argv[2]||'dist').trim()||'dist';
const archive=path.join(root,output,'win-unpacked','resources','app.asar');
if(!fs.existsSync(archive))throw new Error(`No existe ${output}/win-unpacked/resources/app.asar. Compila ese output primero.`);
const files=asar.listPackage(archive);
const bundled=files.filter(x=>/^\\extensions(?:\\|$)/i.test(x));
if(bundled.length){
  console.error(bundled.slice(0,50).join('\n'));
  throw new Error('El Setup contiene extensiones oficiales; deben instalarse desde el repositorio.');
}
const fallback='\\marketplace\\fallback.json';
const service='\\backend\\services\\extensionService.js';
if(!files.includes(fallback)||!files.includes(service))throw new Error('El paquete no contiene el instalador de Marketplace requerido.');
console.log(JSON.stringify({ok:true,archive,files:files.length,bundledExtensions:0},null,2));
