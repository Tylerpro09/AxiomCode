const path=require('path');
const crypto=require('crypto');

const BLOCKED_EXTENSIONS=new Set([
  '.exe','.dll','.com','.scr','.msi','.msp','.sys','.cpl','.pif',
  '.bat','.cmd','.ps1','.psm1','.vbs','.vbe','.wsf','.wsh','.hta',
  '.reg','.lnk','.scf','.jar','.node','.sh','.command'
]);

const CODE_EXTENSIONS=new Set([
  '.js','.cjs','.mjs','.jsx','.ts','.tsx','.html','.htm','.svg'
]);

const RULES=[
  {id:'child-process',severity:'critical',score:10,re:/(?:require\s*\(\s*['"](?:node:)?child_process['"]\s*\)|from\s*['"](?:node:)?child_process['"]|process\.getBuiltinModule\s*\(\s*['"]child_process['"]\s*\)|\bchild_process\s*\.\s*(?:exec|execFile|spawn|fork)\w*\s*\()/i,message:'Ejecución de procesos del sistema'},
  {id:'process-loader-bypass',severity:'critical',score:12,re:/(?:process\.mainModule\.require|module\.constructor\._load|(?:globalThis|global)\.process\b|process\.binding\s*\()/i,message:'Intento de obtener APIs internas de Node'},
  {id:'powershell-encoded',severity:'critical',score:12,re:/powershell(?:\.exe)?[^\n\r]{0,180}(?:-enc(?:odedcommand)?\b|frombase64string|invoke-expression|\biex\b)/i,message:'PowerShell ofuscado o ejecución dinámica'},
  {id:'persistence',severity:'critical',score:12,re:/(?:schtasks\b|reg\s+add\b[^\n\r]{0,120}\\(?:run|runonce)\b|startup\\|wmic\s+startup|new-service\b|sc\.exe\s+create\b)/i,message:'Intento de persistencia en el sistema'},
  {id:'defense-evasion',severity:'critical',score:12,re:/(?:set-mppreference\b[^\n\r]{0,120}-disablerealtimemonitoring|add-mppreference\b|wevtutil\s+cl\b|vssadmin\s+delete\s+shadows|bcdedit\b[^\n\r]{0,120}recoveryenabled)/i,message:'Intento de desactivar seguridad o borrar evidencias'},
  {id:'credential-targets',severity:'high',score:8,re:/(?:Login Data|Local State|Cookies|\.ssh[\\/](?:id_rsa|id_ed25519)|discord[^\n\r]{0,80}(?:token|leveldb)|wallet\.dat|metamask|Exodus)/i,message:'Acceso a ubicaciones típicas de credenciales o wallets'},
  {id:'credential-dump',severity:'critical',score:12,re:/(?:mimikatz|sekurlsa|lsass|procdump[^\n\r]{0,80}lsass|comsvcs\.dll[^\n\r]{0,120}minidump)/i,message:'Patrón asociado a robo de credenciales'},
  {id:'remote-script-exec',severity:'critical',score:12,re:/(?:curl|wget|Invoke-WebRequest|iwr)\b[^\n\r]{0,300}(?:\|\s*(?:sh|bash|powershell)|&&\s*(?:sh|bash|powershell|cmd)|;\s*(?:sh|bash|powershell|cmd))/i,message:'Descarga y ejecución de código remoto'},
  {id:'lolbin-exec',severity:'critical',score:11,re:/(?:mshta|rundll32|regsvr32|certutil|bitsadmin)\.exe\b/i,message:'Uso de binarios del sistema comúnmente abusados'},
  {id:'crypto-miner',severity:'critical',score:12,re:/(?:stratum\+tcp|xmrig|cryptonight|coinhive|monero(?:pool|mining)|wallet_address)/i,message:'Indicadores de minería de criptomonedas'},
  {id:'eval',severity:'medium',score:3,re:/\beval\s*\(/i,message:'Ejecución dinámica con eval'},
  {id:'function-constructor',severity:'medium',score:3,re:/\b(?:new\s+)?Function\s*\(/i,message:'Ejecución dinámica con Function'},
  {id:'dynamic-require',severity:'medium',score:4,re:/\brequire\s*\(\s*[^'"][^)]*\)/i,message:'Carga dinámica de módulos'},
  {id:'env-access',severity:'low',score:2,re:/\bprocess\.env\b/i,message:'Lectura de variables de entorno'},
  {id:'filesystem',severity:'low',score:2,re:/\b(?:require\s*\(\s*['"]fs['"]\s*\)|node:fs\b|from\s*['"]fs['"])/i,message:'Acceso directo al sistema de archivos'},
  {id:'network',severity:'low',score:2,re:/\b(?:require\s*\(\s*['"](?:net|tls|http|https|dns|dgram)['"]\s*\)|node:(?:net|tls|http|https|dns|dgram)\b|new\s+WebSocket\s*\()/i,message:'Acceso directo a red'},
  {id:'native-addon',severity:'high',score:7,re:/\b(?:process\.dlopen|bindings\s*\(|node-gyp|ffi-napi|ref-napi)\b/i,message:'Carga de código nativo'}
];

function isProbablyText(bytes){
  const sample=bytes.subarray(0,Math.min(bytes.length,8192));
  let bad=0;
  for(const b of sample){ if(b===0)return false; if((b<9)||(b>13&&b<32))bad++; }
  return sample.length===0 || bad/sample.length<0.02;
}

function scanText(text,file){
  const findings=[];
  let score=0;
  for(const rule of RULES){
    if(rule.re.test(text)){
      findings.push({file,rule:rule.id,severity:rule.severity,score:rule.score,message:rule.message});
      score+=rule.score;
    }
  }
  const hugeB64=/[A-Za-z0-9+/]{1200,}={0,2}/.test(text);
  const decoderExec=/(?:atob|frombase64string|Buffer\.from\s*\([^)]*base64)[\s\S]{0,600}(?:eval\s*\(|Function\s*\(|child_process|spawn\s*\(|exec\s*\()/i.test(text)
    || /(?:eval\s*\(|Function\s*\()[\s\S]{0,600}(?:atob|frombase64string|Buffer\.from\s*\([^)]*base64)/i.test(text);
  if(hugeB64&&decoderExec){
    findings.push({file,rule:'obfuscated-loader',severity:'critical',score:12,message:'Carga ofuscada en Base64 seguida de ejecución'});
    score+=12;
  }
  const credential=findings.some(x=>x.rule==='credential-targets');
  const outbound=/(?:fetch\s*\(|axios\.|https?\.request|WebSocket\s*\(|XMLHttpRequest)/i.test(text);
  if(credential&&outbound){
    findings.push({file,rule:'credential-exfiltration-combo',severity:'critical',score:12,message:'Acceso a credenciales combinado con envío por red'});
    score+=12;
  }
  return {score,findings};
}

function scanExtensionFiles(files,{blockThreshold=10}={}){
  const findings=[];
  const hashes={};
  let score=0,scanned=0;
  for(const item of files||[]){
    const file=String(item.path||'').replace(/\\/g,'/');
    const ext=path.extname(file).toLowerCase();
    const bytes=Buffer.isBuffer(item.bytes)?item.bytes:Buffer.from(item.bytes||'');
    hashes[file]=crypto.createHash('sha256').update(bytes).digest('hex');
    scanned++;
    if(BLOCKED_EXTENSIONS.has(ext)){
      findings.push({file,rule:'blocked-file-type',severity:'critical',score:15,message:'Tipo de archivo ejecutable o script del sistema no permitido: '+ext});
      score+=15;
      continue;
    }
    if(bytes.length>5*1024*1024 && CODE_EXTENSIONS.has(ext)){
      findings.push({file,rule:'oversized-code',severity:'medium',score:3,message:'Archivo de código/texto inusualmente grande'});
      score+=3;
    }
    if(CODE_EXTENSIONS.has(ext)){
      const result=scanText(bytes.toString('utf8'),file);
      score+=result.score;
      findings.push(...result.findings);
    }
  }
  const critical=findings.some(x=>x.severity==='critical');
  const verdict=critical||score>=blockThreshold?'blocked':score>=5?'suspicious':'clean';
  return {
    engine:'AxiomGuard Static 1.0',
    verdict,score,filesScanned:scanned,
    findings:findings.slice(0,100),
    hashes
  };
}

function assertExtensionSafe(report){
  if(!report||report.verdict==='blocked'){
    const top=report?.findings?.slice(0,3).map(x=>x.message+' ['+x.file+']').join('; ')||'riesgo desconocido';
    const error=new Error('AxiomGuard bloqueó la extensión: '+top);
    error.code='AXIOM_EXTENSION_MALWARE';
    error.report=report;
    throw error;
  }
  return report;
}

function shouldInspectFile(file){
  const ext=path.extname(String(file||'')).toLowerCase();
  return BLOCKED_EXTENSIONS.has(ext)||CODE_EXTENSIONS.has(ext);
}

function combineSecurityReports(reports,{blockThreshold=10}={}){
  const findings=[],hashes={};
  let score=0,filesScanned=0;
  for(const report of reports||[]){
    if(!report)continue;
    score+=Number(report.score||0);
    filesScanned+=Number(report.filesScanned||0);
    findings.push(...(report.findings||[]));
    Object.assign(hashes,report.hashes||{});
  }
  const critical=findings.some(x=>x.severity==='critical');
  return {
    engine:'AxiomGuard Static 1.0',
    verdict:critical||score>=blockThreshold?'blocked':score>=5?'suspicious':'clean',
    score,filesScanned,findings:findings.slice(0,100),hashes
  };
}

module.exports={scanExtensionFiles,combineSecurityReports,assertExtensionSafe,shouldInspectFile,BLOCKED_EXTENSIONS,CODE_EXTENSIONS,RULES};