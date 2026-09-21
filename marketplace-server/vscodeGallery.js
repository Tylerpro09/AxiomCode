const crypto=require('crypto');
const {Readable}=require('stream');
const yazl=require('yazl');

const ASSET={
  icon:'Microsoft.VisualStudio.Services.Icons.Default',
  details:'Microsoft.VisualStudio.Services.Content.Details',
  changelog:'Microsoft.VisualStudio.Services.Content.Changelog',
  manifest:'Microsoft.VisualStudio.Code.Manifest',
  vsix:'Microsoft.VisualStudio.Services.VSIXPackage',
  license:'Microsoft.VisualStudio.Services.Content.License'
};

function uuidFrom(value){
  const h=crypto.createHash('sha256').update(String(value)).digest();
  const b=Buffer.from(h.subarray(0,16));
  b[6]=(b[6]&0x0f)|0x50;
  b[8]=(b[8]&0x3f)|0x80;
  const x=b.toString('hex');
  return x.slice(0,8)+'-'+x.slice(8,12)+'-'+x.slice(12,16)+'-'+x.slice(16,20)+'-'+x.slice(20);
}
function splitId(entry){
  const id=String(entry.id||'');
  const dot=id.indexOf('.');
  if(dot>0)return {publisher:id.slice(0,dot),name:id.slice(dot+1)};
  const publisher=String(entry.publisher||'community').toLowerCase().replace(/[^a-z0-9-]/g,'-')||'community';
  const name=id.toLowerCase().replace(/[^a-z0-9-]/g,'-')||'extension';
  return {publisher,name};
}
function iso(v){const d=new Date(v||Date.now());return Number.isNaN(d.getTime())?new Date().toISOString():d.toISOString();}
function native(entry){return Boolean(entry&&entry.install&&entry.install.vscode&&entry.install.vscode.manifest);}
function properties(entry){
  const v=entry.install.vscode||{},m=v.manifest||{};
  const out=[
    {key:'Microsoft.VisualStudio.Code.Engine',value:String((m.engines&&m.engines.vscode)||'^1.80.0')},
    {key:'Microsoft.VisualStudio.Code.ExecutesCode',value:String(Boolean(m.main||m.browser))}
  ];
  if(Array.isArray(m.extensionDependencies)&&m.extensionDependencies.length)out.push({key:'Microsoft.VisualStudio.Code.ExtensionDependencies',value:m.extensionDependencies.join(',')});
  if(Array.isArray(m.extensionPack)&&m.extensionPack.length)out.push({key:'Microsoft.VisualStudio.Code.ExtensionPack',value:m.extensionPack.join(',')});
  if(Array.isArray(m.enabledApiProposals)&&m.enabledApiProposals.length)out.push({key:'Microsoft.VisualStudio.Code.EnabledApiProposals',value:m.enabledApiProposals.join(',')});
  if(v.web===true||m.browser)out.push({key:'Microsoft.VisualStudio.Code.WebExtension',value:'true'});
  return out;
}
function toRawGalleryExtension(entry,base){
  const parts=splitId(entry),publisher=parts.publisher,name=parts.name;
  const date=iso(entry.updatedAt||entry.publishedAt||entry.updated_at||entry.published_at);
  const assetBase=base+'/_apis/public/gallery/assets/'+encodeURIComponent(entry.id)+'/'+encodeURIComponent(entry.version);
  const files=[
    {assetType:ASSET.manifest,source:'package.json'},
    {assetType:ASSET.vsix,source:'extension.vsix'}
  ];
  const v=entry.install.vscode||{};
  if(entry.icon||v.iconUrl)files.push({assetType:ASSET.icon,source:v.iconPath||'icon'});
  if(v.readmeUrl)files.push({assetType:ASSET.details,source:v.readmePath||'README.md'});
  if(v.changelogUrl)files.push({assetType:ASSET.changelog,source:v.changelogPath||'CHANGELOG.md'});
  if(v.licenseUrl)files.push({assetType:ASSET.license,source:v.licensePath||'LICENSE'});
  const version={
    version:String(entry.version),
    lastUpdated:date,
    assetUri:assetBase,
    fallbackAssetUri:assetBase,
    files:files,
    properties:properties(entry)
  };
  if(v.targetPlatform)version.targetPlatform=v.targetPlatform;
  return {
    extensionId:uuidFrom('extension:'+entry.id),
    extensionName:name,
    displayName:entry.name||(v.manifest&&v.manifest.displayName)||name,
    shortDescription:entry.description||(v.manifest&&v.manifest.description)||'',
    publisher:{
      displayName:entry.publisher||publisher,
      publisherId:uuidFrom('publisher:'+publisher),
      publisherName:publisher
    },
    versions:[version],
    statistics:[
      {statisticName:'install',value:Number(entry.downloads||0)},
      {statisticName:'averagerating',value:0},
      {statisticName:'ratingcount',value:0}
    ],
    tags:Array.isArray(entry.tags)?entry.tags:[],
    releaseDate:date,
    publishedDate:date,
    lastUpdated:date,
    categories:Array.isArray(v.manifest&&v.manifest.categories)?v.manifest.categories:[],
    flags:''
  };
}
function parseCriteria(body){
  const filter=body&&body.filters&&body.filters[0]||{};
  const criteria=Array.isArray(filter.criteria)?filter.criteria:[];
  return {
    criteria:criteria,
    pageNumber:Math.max(1,Number(filter.pageNumber)||1),
    pageSize:Math.min(200,Math.max(1,Number(filter.pageSize)||50)),
    sortBy:Number(filter.sortBy)||0,
    sortOrder:Number(filter.sortOrder)||0
  };
}
function query(catalog,body,base){
  const q=parseCriteria(body);
  let list=(catalog&&catalog.extensions||[]).filter(native);
  for(const c of q.criteria){
    const type=Number(c.filterType),value=String(c.value||'').trim().toLowerCase();
    if(!value)continue;
    if(type===10){
      const words=value.split(/\s+/).filter(Boolean);
      list=list.filter(function(e){
        const hay=[e.id,e.name,e.description,e.publisher].concat(e.tags||[]).join(' ').toLowerCase();
        return words.every(function(w){return hay.includes(w);});
      });
    }else if(type===7){
      list=list.filter(function(e){const p=splitId(e);return p.name.toLowerCase()===value||String(e.id).toLowerCase()===value;});
    }else if(type===4){
      list=list.filter(function(e){return String(e.id).toLowerCase()===value||uuidFrom('extension:'+e.id).toLowerCase()===value;});
    }else if(type===5){
      list=list.filter(function(e){return ((e.install&&e.install.vscode&&e.install.vscode.manifest&&e.install.vscode.manifest.categories)||[]).some(function(x){return String(x).toLowerCase()===value;});});
    }else if(type===9&&(value==='true'||value==='1')){
      list=list.filter(function(e){return e.featured;});
    }
  }
  if(q.sortBy===1)list.sort(function(a,b){return new Date(b.updatedAt||0)-new Date(a.updatedAt||0);});
  else if(q.sortBy===2)list.sort(function(a,b){return String(a.name).localeCompare(String(b.name));});
  else if(q.sortBy===3)list.sort(function(a,b){return String(a.publisher).localeCompare(String(b.publisher));});
  else if(q.sortBy===4)list.sort(function(a,b){return Number(b.downloads||0)-Number(a.downloads||0);});
  const total=list.length,start=(q.pageNumber-1)*q.pageSize;
  const extensions=list.slice(start,start+q.pageSize).map(function(e){return toRawGalleryExtension(e,base);});
  return {results:[{extensions:extensions,resultMetadata:[{metadataType:'ResultCount',metadataItems:[{name:'TotalCount',count:total}]}]}]};
}
function manifest(entry){return entry&&entry.install&&entry.install.vscode&&entry.install.vscode.manifest||null;}
function xmlEscape(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c];});}
function vsixManifest(entry){
  const m=manifest(entry)||{},parts=splitId(entry),publisher=parts.publisher,name=parts.name;
  const display=m.displayName||entry.name||name,desc=m.description||entry.description||'';
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">',
    '  <Metadata>',
    '    <Identity Language="en-US" Id="'+xmlEscape(name)+'" Version="'+xmlEscape(entry.version)+'" Publisher="'+xmlEscape(publisher)+'" />',
    '    <DisplayName>'+xmlEscape(display)+'</DisplayName>',
    '    <Description xml:space="preserve">'+xmlEscape(desc)+'</Description>',
    '    <Tags>'+xmlEscape((entry.tags||[]).join(','))+'</Tags>',
    '    <GalleryFlags>Public</GalleryFlags>',
    '    <Properties>',
    '      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="'+xmlEscape((m.engines&&m.engines.vscode)||'^1.80.0')+'" />',
    '    </Properties>',
    '  </Metadata>',
    '  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code" /></Installation>',
    '  <Dependencies />',
    '  <Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" /></Assets>',
    '</PackageManifest>'
  ].join('\n');
}
const contentTypes=[
  '<?xml version="1.0" encoding="utf-8"?>',
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
  '  <Default Extension="json" ContentType="application/json" />',
  '  <Default Extension="js" ContentType="application/javascript" />',
  '  <Default Extension="cjs" ContentType="application/javascript" />',
  '  <Default Extension="mjs" ContentType="application/javascript" />',
  '  <Default Extension="ts" ContentType="text/plain" />',
  '  <Default Extension="md" ContentType="text/markdown" />',
  '  <Default Extension="png" ContentType="image/png" />',
  '  <Default Extension="svg" ContentType="image/svg+xml" />',
  '  <Default Extension="txt" ContentType="text/plain" />',
  '  <Default Extension Extension="vsixmanifest" ContentType="text/xml" />',
  '</Types>'
].join('\n').replace('<Default Extension Extension','<Default Extension');

async function streamVsix(entry,res){
  if(!native(entry))throw new Error('La extensión no es un paquete VS Code nativo');
  const zip=new yazl.ZipFile();
  zip.addBuffer(Buffer.from(contentTypes),'[Content_Types].xml');
  zip.addBuffer(Buffer.from(vsixManifest(entry)),'extension.vsixmanifest');
  const files=entry.install.files||[];
  const generated=entry.install.vscode?.generatedFiles||[];
  const generatedPaths=new Set();
  const hasPackage=files.some(file=>String(file.path||'').replace(/\\/g,'/').replace(/^\/+/,'')==='package.json');
  if(!hasPackage)zip.addBuffer(Buffer.from(JSON.stringify(manifest(entry),null,2)),'extension/package.json');
  for(const file of generated){
    const rel=String(file.path||'').replace(/\\/g,'/').replace(/^\/+/,'');
    if(!rel||rel.includes('..')||rel.startsWith('.git/'))continue;
    generatedPaths.add(rel);
    zip.addBuffer(Buffer.from(String(file.content||'')),'extension/'+rel);
  }
  for(const file of files){
    const rel=String(file.path||'').replace(/\\/g,'/').replace(/^\/+/,'');
    if(!rel||rel.includes('..')||rel.startsWith('.git/')||generatedPaths.has(rel))continue;
    const response=await fetch(file.url,{headers:{'User-Agent':'AxiomCode-Gallery-VSIX/1'},signal:AbortSignal.timeout(120000)});
    if(!response.ok)throw new Error('No se pudo empaquetar '+rel+': HTTP '+response.status);
    const len=Number(response.headers.get('content-length')||file.size||0);
    if(len>0&&response.body){
      zip.addReadStream(Readable.fromWeb(response.body),'extension/'+rel,{size:len});
    }else{
      const bytes=Buffer.from(await response.arrayBuffer());
      zip.addBuffer(bytes,'extension/'+rel);
    }
  }
  zip.end();
  await new Promise(function(resolve,reject){zip.outputStream.on('error',reject).on('end',resolve).pipe(res);});
}
module.exports={ASSET:ASSET,native:native,uuidFrom:uuidFrom,splitId:splitId,toRawGalleryExtension:toRawGalleryExtension,query:query,manifest:manifest,streamVsix:streamVsix};