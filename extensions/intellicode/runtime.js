(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.AxiomIntelliCode=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';

  const VERSION='1.3.0';
  const MAX_MODEL_BYTES=512*1024;
  const MAX_TOTAL_BYTES=6*1024*1024;
  const MAX_CONTEXTS=32000;
  const MAX_SYMBOLS=18000;
  const MAX_LINES=5000;
  const MEMBER_OPS=new Set(['.','?.','::','->']);
  const SUPPORTED=[
    'javascript','typescript','python','java','c','cpp','csharp','go','rust',
    'php','html','css','scss','json','sql','shell','powershell','lua',
    'yaml','xml','markdown','bat'
  ];
  const EXT_TO_LANGUAGE={
    js:'javascript',mjs:'javascript',cjs:'javascript',jsx:'javascript',
    ts:'typescript',tsx:'typescript',py:'python',java:'java',c:'c',h:'c',
    cpp:'cpp',cc:'cpp',cxx:'cpp',hpp:'cpp',cs:'csharp',go:'go',rs:'rust',
    php:'php',html:'html',htm:'html',css:'css',scss:'scss',json:'json',
    sql:'sql',sh:'shell',bash:'shell',ps1:'powershell',lua:'lua',
    yaml:'yaml',yml:'yaml',xml:'xml',md:'markdown',bat:'bat',cmd:'bat'
  };
  const STOP=new Set([
    'true','false','null','undefined','none','this','self','return','break','continue',
    'const','let','var','function','class','def','if','else','for','while','switch',
    'case','try','catch','finally','import','from','export','public','private','protected',
    'static','void','new','in','of','and','or','not','async','await','package','using',
    'namespace','struct','enum','interface','type','extends','implements','yield','throw'
  ]);
  const SKIP_DIRS=new Set([
    '.git','.hg','.svn','node_modules','vendor','dist','build','out','target','.next',
    '.cache','coverage','.idea','.vscode','__pycache__','.venv','venv','bin','obj'
  ]);
  const SKIP_FILES=new Set([
    'package-lock.json','yarn.lock','pnpm-lock.yaml','composer.lock','cargo.lock',
    'poetry.lock','pipfile.lock','bun.lock','bun.lockb'
  ]);
  const GENERATED_FILE_RE=/(?:^|[._-])(?:min|bundle|generated|vendor)(?:[._-]|$)|\.map$/i;
  const VICTORS_API_BASE='https://api.victors.qzz.io/v1';
  const VICTORS_DEFAULT_MODEL='auto:coding';

  const TEMPLATES={
    javascript:[
      ['for','for…of','for (const item of items) {\n\t$0\n}'],
      ['fun','function','function name(args) {\n\t$0\n}'],
      ['arr','arrow function','const name = (args) => {\n\t$0\n};'],
      ['asy','async function','async function name(args) {\n\t$0\n}'],
      ['try','try/catch','try {\n\t$0\n} catch (error) {\n\tconsole.error(error);\n}'],
      ['fet','fetch JSON','const response = await fetch(url);\nconst data = await response.json();\n$0'],
      ['map','map','const result = items.map(item => $0);'],
      ['con','console.log','console.log($0);']
    ],
    typescript:[
      ['for','for…of','for (const item of items) {\n\t$0\n}'],
      ['fun','typed function','function name(args: unknown): void {\n\t$0\n}'],
      ['asy','async function','async function name(args: unknown): Promise<void> {\n\t$0\n}'],
      ['int','interface','interface Name {\n\t$0\n}'],
      ['typ','type','type Name = {\n\t$0\n};'],
      ['gen','generic function','function name<T>(value: T): T {\n\t$0\n\treturn value;\n}'],
      ['try','try/catch','try {\n\t$0\n} catch (error) {\n\tconsole.error(error);\n}']
    ],
    python:[
      ['def','def function','def function_name(args):\n    $0'],
      ['asy','async def','async def function_name(args):\n    $0'],
      ['cla','class','class Name:\n    def __init__(self):\n        $0'],
      ['for','for loop','for item in items:\n    $0'],
      ['try','try/except','try:\n    $0\nexcept Exception as exc:\n    print(exc)'],
      ['wit','with open','with open(path, "r", encoding="utf-8") as file:\n    $0'],
      ['lis','list comprehension','result = [item for item in items if $0]']
    ],
    java:[
      ['cla','class','public class Name {\n\t$0\n}'],
      ['mai','main','public static void main(String[] args) {\n\t$0\n}'],
      ['for','for-each','for (var item : items) {\n\t$0\n}'],
      ['try','try/catch','try {\n\t$0\n} catch (Exception exception) {\n\texception.printStackTrace();\n}'],
      ['met','method','public void methodName() {\n\t$0\n}']
    ],
    c:[
      ['mai','main','int main(void) {\n\t$0\n\treturn 0;\n}'],
      ['for','for loop','for (int i = 0; i < count; ++i) {\n\t$0\n}'],
      ['fun','function','void function_name(void) {\n\t$0\n}']
    ],
    cpp:[
      ['mai','main','int main() {\n\t$0\n\treturn 0;\n}'],
      ['for','range for','for (const auto& item : items) {\n\t$0\n}'],
      ['cla','class','class Name {\npublic:\n\t$0\n};']
    ],
    csharp:[
      ['cla','class','public class Name\n{\n\t$0\n}'],
      ['for','foreach','foreach (var item in items)\n{\n\t$0\n}'],
      ['asy','async Task','async Task MethodAsync()\n{\n\t$0\n}'],
      ['pro','property','public string Name { get; set; } = $0;']
    ],
    go:[
      ['mai','main','func main() {\n\t$0\n}'],
      ['fun','func','func name(args) {\n\t$0\n}'],
      ['for','for range','for _, item := range items {\n\t$0\n}'],
      ['err','error check','if err != nil {\n\treturn err\n}\n$0']
    ],
    rust:[
      ['mai','main','fn main() {\n\t$0\n}'],
      ['fun','fn','fn name() {\n\t$0\n}'],
      ['mat','match','match value {\n\tpattern => $0,\n}'],
      ['imp','impl','impl Type {\n\t$0\n}'],
      ['res','Result function','fn name() -> Result<(), Box<dyn std::error::Error>> {\n\t$0\n\tOk(())\n}']
    ],
    php:[
      ['fun','function','function name($args) {\n\t$0\n}'],
      ['for','foreach','foreach ($items as $item) {\n\t$0\n}'],
      ['cla','class','class Name {\n\t$0\n}']
    ],
    html:[
      ['htm','HTML document','<!doctype html>\n<html lang="en">\n<head>\n\t<meta charset="utf-8">\n\t<meta name="viewport" content="width=device-width, initial-scale=1">\n\t<title>$0</title>\n</head>\n<body>\n\n</body>\n</html>'],
      ['scr','script module','<script type="module">\n\t$0\n</script>']
    ],
    css:[
      ['med','media query','@media (max-width: 768px) {\n\t$0\n}'],
      ['gri','grid','display: grid;\ngrid-template-columns: repeat(auto-fit, minmax(220px, 1fr));\ngap: 1rem;'],
      ['fle','flex','display: flex;\nalign-items: center;\ngap: 1rem;\n$0']
    ],
    scss:[
      ['med','media query','@media (max-width: 768px) {\n\t$0\n}'],
      ['mix','mixin','@mixin name($value) {\n\t$0\n}']
    ],
    json:[['obj','object','{\n\t"key": "$0"\n}'],['arr','array','[\n\t$0\n]']],
    sql:[
      ['sel','SELECT','SELECT *\nFROM table_name\nWHERE $0;'],
      ['ins','INSERT','INSERT INTO table_name (column)\nVALUES ($0);'],
      ['upd','UPDATE','UPDATE table_name\nSET column = value\nWHERE $0;']
    ],
    shell:[
      ['if','if','if [ condition ]; then\n\t$0\nfi'],
      ['for','for','for item in items; do\n\t$0\ndone'],
      ['fun','function','name() {\n\t$0\n}']
    ],
    powershell:[
      ['for','foreach','foreach ($item in $items) {\n\t$0\n}'],
      ['try','try/catch','try {\n\t$0\n} catch {\n\tWrite-Error $_\n}'],
      ['fun','function','function Name {\n\tparam($Value)\n\t$0\n}']
    ],
    lua:[
      ['fun','function','function name(args)\n\t$0\nend'],
      ['for','for ipairs','for i, item in ipairs(items) do\n\t$0\nend']
    ],
    yaml:[['obj','mapping','key:\n  $0'],['arr','list','items:\n  - $0']],
    xml:[['tag','element','<element>\n\t$0\n</element>']],
    markdown:[['cod','code block','\`\`\`text\n$0\n\`\`\`'],['tab','table','| Column | Value |\n| --- | --- |\n| $0 | |']],
    bat:[['if','if','if condition (\n\t$0\n)'],['for','for','for %%i in (*) do (\n\t$0\n)']]
  };

  function tokenise(text){
    return String(text||'').match(/[A-Za-z_$][A-Za-z0-9_$]*|\d+(?:\.\d+)?|\?\.|::|->|=>|===|!==|==|!=|<=|>=|\+\+|--|&&|\|\||[{}()[\].,:;+\-*\/%=<>!?]/g)||[];
  }
  function languageFromPath(filePath){
    const name=String(filePath||'').split(/[\\/]/).pop()||'';
    const ext=(name.includes('.')?name.split('.').pop():'').toLowerCase();
    return EXT_TO_LANGUAGE[ext]||null;
  }
  function isIdentifier(value){
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(String(value||''));
  }
  function camelInitials(value){
    return String(value||'').replace(/[^A-Za-z0-9_$]+/g,' ').split(/\s+/).filter(Boolean)
      .flatMap(part=>{
        const caps=part.match(/[A-Z]+(?=[A-Z][a-z]|\b)|[A-Z]?[a-z]+|\d+/g)||[part];
        return caps.map(x=>x[0]||'');
      }).join('').toLowerCase();
  }
  function fuzzyMatch(value,prefix){
    const v=String(value||''),p=String(prefix||'');
    if(!p)return 1;
    if(v.startsWith(p))return 40;
    if(v.toLowerCase().startsWith(p.toLowerCase()))return 34;
    const initials=camelInitials(v);
    if(initials.startsWith(p.toLowerCase()))return 25;
    let j=0;
    for(let i=0;i<v.length&&j<p.length;i++)if(v[i].toLowerCase()===p[j].toLowerCase())j++;
    return j===p.length?12:0;
  }
  function bump(map,key,value,weight=1,max=MAX_CONTEXTS){
    if(!key||!value)return;
    let bucket=map.get(key);
    if(!bucket){
      if(map.size>=max)return;
      bucket=new Map();
      map.set(key,bucket);
    }
    bucket.set(value,(bucket.get(value)||0)+weight);
  }
  function bumpFlat(map,key,weight=1,max=MAX_SYMBOLS){
    if(!key)return;
    if(!map.has(key)&&map.size>=max)return;
    map.set(key,(map.get(key)||0)+weight);
  }
  function topBucket(bucket,prefix='',limit=8){
    if(!bucket)return [];
    const rows=[];
    for(const [value,count] of bucket){
      const match=fuzzyMatch(value,prefix);
      if(match)rows.push({value,score:count+match});
    }
    rows.sort((a,b)=>b.score-a.score||String(a.value).localeCompare(String(b.value)));
    return rows.slice(0,limit);
  }
  function topFlat(map,prefix='',limit=8){
    const rows=[];
    for(const [value,count] of map){
      const match=fuzzyMatch(value,prefix);
      if(match)rows.push({value,score:count+match});
    }
    rows.sort((a,b)=>b.score-a.score||a.value.localeCompare(b.value));
    return rows.slice(0,limit);
  }
  function topNested(map,key,prefix='',limit=8){
    if(!map||!key)return [];
    return topBucket(map.get(key),prefix,limit);
  }
  function kindPatterns(language){
    const common=[
      ['class',/\b(?:class|interface|struct|enum|trait|type)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g],
      ['function',/\b(?:function|def|fn|func)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g],
      ['variable',/\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g]
    ];
    if(language==='python')return [
      ['class',/\bclass\s+([A-Za-z_][A-Za-z0-9_]*)/g],
      ['function',/\bdef\s+([A-Za-z_][A-Za-z0-9_]*)/g],
      ['variable',/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/gm]
    ];
    if(language==='java'||language==='csharp'||language==='cpp'||language==='c')return common.concat([
      ['function',/\b[A-Za-z_$][A-Za-z0-9_$<>\[\], ?]*\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^;{}]*\)\s*\{/g]
    ]);
    if(language==='go')return [
      ['class',/\btype\s+([A-Za-z_][A-Za-z0-9_]*)\s+(?:struct|interface)/g],
      ['function',/\bfunc\s+(?:\([^)]*\)\s*)?([A-Za-z_][A-Za-z0-9_]*)/g],
      ['variable',/\b(?:var|const)\s+([A-Za-z_][A-Za-z0-9_]*)/g]
    ];
    if(language==='rust')return [
      ['class',/\b(?:struct|enum|trait|type)\s+([A-Za-z_][A-Za-z0-9_]*)/g],
      ['function',/\bfn\s+([A-Za-z_][A-Za-z0-9_]*)/g],
      ['variable',/\blet\s+(?:mut\s+)?([A-Za-z_][A-Za-z0-9_]*)/g]
    ];
    return common;
  }
  function looksLikeComment(line,language){
    const s=String(line||'').trimStart();
    if(['python','shell','powershell','yaml'].includes(language))return s.startsWith('#');
    if(language==='sql')return s.startsWith('--');
    if(['html','xml'].includes(language))return s.startsWith('<!--');
    return s.startsWith('//')||s.startsWith('/*')||s.startsWith('*');
  }


  function safeHeader(response,name){
    try{return response?.headers?.get?.(name)??null;}catch{return null;}
  }
  function makeUniqueRequestId(){
    const cryptoApi=typeof crypto!=='undefined'?crypto:null;
    if(cryptoApi?.randomUUID)return cryptoApi.randomUUID();
    if(cryptoApi?.getRandomValues){
      const bytes=new Uint8Array(16);
      cryptoApi.getRandomValues(bytes);
      bytes[6]=(bytes[6]&0x0f)|0x40;
      bytes[8]=(bytes[8]&0x3f)|0x80;
      const hex=[...bytes].map(x=>x.toString(16).padStart(2,'0')).join('');
      return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
    }
    throw new Error('No se pudo generar un X-Request-ID seguro');
  }
  function victorsError(status,message,code,diagnostic){
    const error=new Error(message);
    error.status=status;
    error.code=code;
    error.diagnostic=diagnostic||null;
    return error;
  }
  function parseRateWaitMs(response){
    const retryAfter=safeHeader(response,'Retry-After');
    if(retryAfter){
      const seconds=Number(retryAfter);
      if(Number.isFinite(seconds)&&seconds>=0)return Math.ceil(seconds*1000);
      const when=Date.parse(retryAfter);
      if(Number.isFinite(when))return Math.max(0,when-Date.now());
    }
    const reset=safeHeader(response,'X-RateLimit-Reset');
    if(reset){
      const numeric=Number(reset);
      if(Number.isFinite(numeric)){
        const when=numeric>1e12?numeric:numeric*1000;
        return Math.max(0,when-Date.now());
      }
      const parsed=Date.parse(reset);
      if(Number.isFinite(parsed))return Math.max(0,parsed-Date.now());
    }
    return 1000;
  }
  function diagnosticFromResponse(response,body,requestedModel,requestId){
    const usage=body?.usage&&typeof body.usage==='object'?{
      prompt_tokens:Number.isFinite(Number(body.usage.prompt_tokens))?Number(body.usage.prompt_tokens):null,
      completion_tokens:Number.isFinite(Number(body.usage.completion_tokens))?Number(body.usage.completion_tokens):null,
      total_tokens:Number.isFinite(Number(body.usage.total_tokens))?Number(body.usage.total_tokens):null
    }:{prompt_tokens:null,completion_tokens:null,total_tokens:null};
    return {
      model:body?.model||requestedModel||null,
      status:Number(response?.status)||null,
      responseTimeMs:safeHeader(response,'X-Response-Time-Ms'),
      rateLimit:safeHeader(response,'X-RateLimit-Limit'),
      remaining:safeHeader(response,'X-RateLimit-Remaining'),
      reset:safeHeader(response,'X-RateLimit-Reset'),
      policy:safeHeader(response,'X-RateLimit-Policy'),
      localIntervalSeconds:safeHeader(response,'X-Local-Request-Interval-Seconds'),
      requestId:safeHeader(response,'X-Request-ID')||requestId||null,
      usage
    };
  }
  class VictorsAIClient{
    constructor(options={}){
      this.baseUrl=String(options.baseUrl||VICTORS_API_BASE).replace(/\/+$/,'');
      this.fetchFn=options.fetchFn||((...args)=>fetch(...args));
      this.keyProvider=options.keyProvider||(()=>null);
      this.uuidFn=options.uuidFn||makeUniqueRequestId;
      this.sleepFn=options.sleepFn||(ms=>new Promise(resolve=>setTimeout(resolve,ms)));
      this.lastDiagnostic=null;
      this.lastModels=[];
    }
    key(){
      const value=String(this.keyProvider?.()||'').trim();
      if(!value)throw victorsError(null,'Configura la API key de Victorsia Free primero.','NO_API_KEY',null);
      return value;
    }
    async request(path,options={},retry429=true){
      const requestId=this.uuidFn();
      const key=this.key();
      const headers={
        'Authorization':'Bearer '+key,
        'X-Request-ID':requestId,
        ...(options.body?{'Content-Type':'application/json'}:{}),
        ...(options.headers||{})
      };
      let response;
      try{
        response=await this.fetchFn(this.baseUrl+path,{...options,headers});
      }catch(error){
        throw victorsError(null,'No se pudo conectar con Victorsia Free: '+String(error?.message||error),'NETWORK',null);
      }
      let body=null;
      try{body=await response.json();}catch{}
      const diagnostic=diagnosticFromResponse(response,body,options.requestedModel,requestId);
      this.lastDiagnostic=diagnostic;
      if(response.status===429&&retry429){
        const waitMs=Math.min(60000,Math.max(250,parseRateWaitMs(response)));
        await this.sleepFn(waitMs);
        return this.request(path,options,false);
      }
      if(response.status===401)throw victorsError(401,'La API key fue rechazada. Revisa la API key de Victorsia Free.','AUTH',diagnostic);
      if(response.status===503)throw victorsError(503,'Victorsia Free está offline temporalmente.','PROVIDER_OFFLINE',diagnostic);
      if(!response.ok)throw victorsError(response.status,'Victorsia Free respondió con HTTP '+response.status+'.','HTTP',diagnostic);
      return {body,diagnostic};
    }
    async models(){
      const {body,diagnostic}=await this.request('/models',{method:'GET'});
      const models=(body?.data||[]).map(item=>String(item?.id||'')).filter(Boolean);
      this.lastModels=models;
      return {models,diagnostic};
    }
    async complete({model,messages,temperature=0.2,maxTokens=512}){
      if(!model)throw new Error('No hay modelo de IA seleccionado');
      const payload={
        model:String(model),
        messages:Array.isArray(messages)?messages:[],
        temperature:Number(temperature),
        max_tokens:Math.max(1,Math.min(4096,Number(maxTokens)||512))
      };
      const {body,diagnostic}=await this.request('/chat/completions',{
        method:'POST',
        body:JSON.stringify(payload),
        requestedModel:model
      });
      const content=String(body?.choices?.[0]?.message?.content||'');
      return {content,body,diagnostic};
    }
  }
  function chooseVictorsModel(models,preferred){
    const list=(models||[]).map(String).filter(Boolean);
    if(preferred&&list.includes(preferred))return preferred;
    if(list.includes(VICTORS_DEFAULT_MODEL))return VICTORS_DEFAULT_MODEL;
    const coding=list.find(id=>/coding|code|codestral|coder|devstral|north-mini-code/i.test(id)&&(/:free$/.test(id)||/^auto:/.test(id)));
    if(coding)return coding;
    const free=list.find(id=>/:free$/.test(id));
    return free||list[0]||null;
  }
  function stripCodeFence(text){
    let value=String(text||'').trim();
    const fence=String.fromCharCode(96).repeat(3);
    if(value.startsWith(fence)&&value.endsWith(fence)){
      const firstNewline=value.indexOf('\n');
      const lastFence=value.lastIndexOf(fence);
      if(firstNewline>=0&&lastFence>firstNewline)value=value.slice(firstNewline+1,lastFence).replace(/\n$/,'');
    }
    return value;
  }

  class LocalIntelliEngine{
    constructor(label='local'){this.label=label;this.reset();}
    reset(){
      this.one=new Map();
      this.two=new Map();
      this.three=new Map();
      this.symbols=new Map();
      this.byLanguage=new Map();
      this.memberAny=new Map();
      this.memberByReceiver=new Map();
      this.symbolKinds=new Map();
      this.linesByLanguage=new Map();
      this.lineTransitions=new Map();
      this.stats={
        models:0,bytes:0,tokens:0,contexts:0,symbols:0,lines:0,
        rebuilds:(this.stats?.rebuilds||0),label:this.label
      };
    }
    languageSymbols(language){
      let map=this.byLanguage.get(language);
      if(!map){map=new Map();this.byLanguage.set(language,map);}
      return map;
    }
    languageLines(language){
      let map=this.linesByLanguage.get(language);
      if(!map){map=new Map();this.linesByLanguage.set(language,map);}
      return map;
    }
    rememberKind(name,kind){
      if(!name||!kind)return;
      let bucket=this.symbolKinds.get(name);
      if(!bucket){bucket=new Map();this.symbolKinds.set(name,bucket);}
      bucket.set(kind,(bucket.get(kind)||0)+1);
    }
    bestKind(name){
      const bucket=this.symbolKinds.get(name);
      if(!bucket)return 'variable';
      return [...bucket.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]||'variable';
    }
    learnKinds(sample,language){
      for(const [kind,regex] of kindPatterns(language)){
        regex.lastIndex=0;
        let match;
        while((match=regex.exec(sample))){
          const name=match[1];
          if(isIdentifier(name)){
            this.rememberKind(name,kind);
            bumpFlat(this.symbols,name,5);
            bumpFlat(this.languageSymbols(language),name,8);
          }
          if(regex.lastIndex===match.index)regex.lastIndex++;
        }
      }
    }
    learnText(text,language='plaintext',weight=1){
      if(typeof text!=='string'||!text)return;
      let sample=text;
      if(sample.length>MAX_MODEL_BYTES)sample=sample.slice(sample.length-MAX_MODEL_BYTES);
      const remaining=Math.max(0,MAX_TOTAL_BYTES-this.stats.bytes);
      if(!remaining)return;
      if(sample.length>remaining)sample=sample.slice(0,remaining);
      this.stats.models++;
      this.stats.bytes+=sample.length;
      this.learnKinds(sample,language);
      const tokens=tokenise(sample);
      this.stats.tokens+=tokens.length;
      const langSymbols=this.languageSymbols(language);
      for(let i=0;i<tokens.length;i++){
        const value=tokens[i];
        if(isIdentifier(value)&&value.length>1&&!STOP.has(value.toLowerCase())){
          bumpFlat(this.symbols,value,weight);
          bumpFlat(langSymbols,value,weight*1.5);
        }
        if(i>0)bump(this.one,tokens[i-1],value,weight,MAX_CONTEXTS);
        if(i>1)bump(this.two,tokens[i-2]+'\u0000'+tokens[i-1],value,weight*2,MAX_CONTEXTS);
        if(i>2)bump(this.three,tokens[i-3]+'\u0000'+tokens[i-2]+'\u0000'+tokens[i-1],value,weight*4,MAX_CONTEXTS);
        if(i>0&&MEMBER_OPS.has(tokens[i-1])&&isIdentifier(value)){
          bumpFlat(this.memberAny,value,weight*3,8000);
          const receiver=i>1&&isIdentifier(tokens[i-2])?tokens[i-2]:null;
          if(receiver)bump(this.memberByReceiver,receiver,value,weight*5,8000);
        }
      }
      const lines=this.languageLines(language);
      const rows=sample.split(/\r?\n/);
      let previous='';
      for(const raw of rows){
        const line=raw.trim();
        if(line.length>=4&&line.length<=240&&!/^[{}()[\];,]+$/.test(line)&&!looksLikeComment(line,language)){
          bumpFlat(lines,line,weight,MAX_LINES);
          if(previous&&previous!==line)bump(this.lineTransitions,language+'\u0000'+previous.slice(-160),line,weight,7000);
          previous=line;
        }
      }
      this.stats.contexts=this.one.size+this.two.size+this.three.size+this.memberByReceiver.size+this.lineTransitions.size;
      this.stats.symbols=this.symbols.size;
      this.stats.lines=[...this.linesByLanguage.values()].reduce((n,m)=>n+m.size,0);
    }
    rebuild(models){
      const rebuilds=(this.stats?.rebuilds||0)+1;
      this.reset();
      this.stats.rebuilds=rebuilds;
      let total=0;
      for(const model of (models||[]).slice(0,24)){
        let value='';
        try{value=model.getValue();}catch{continue;}
        if(total>=MAX_TOTAL_BYTES)break;
        if(value.length+total>MAX_TOTAL_BYTES)value=value.slice(0,MAX_TOTAL_BYTES-total);
        total+=value.length;
        let language='plaintext';
        try{language=model.getLanguageId();}catch{}
        this.learnText(value,language,2);
      }
      return this.status();
    }
    suggestTokens(contextTokens,prefix='',limit=10,options={}){
      const ctx=Array.isArray(contextTokens)?contextTokens:[];
      const language=options.language||'plaintext';
      const receiver=options.receiver||null;
      const memberMode=ctx.length&&MEMBER_OPS.has(ctx[ctx.length-1]);
      const scored=new Map();
      const add=(rows,bonus,source)=>{
        for(const row of rows){
          const score=row.score+bonus;
          const old=scored.get(row.value);
          if(!old||score>old.score)scored.set(row.value,{value:row.value,score,source});
        }
      };
      if(ctx.length>=3)add(topNested(this.three,ctx.slice(-3).join('\u0000'),prefix,limit*3),80,'context-3');
      if(ctx.length>=2)add(topNested(this.two,ctx.slice(-2).join('\u0000'),prefix,limit*3),48,'context-2');
      if(ctx.length>=1)add(topNested(this.one,ctx[ctx.length-1],prefix,limit*3),26,'context-1');
      if(memberMode){
        if(receiver)add(topNested(this.memberByReceiver,receiver,prefix,limit*4),70,'member-receiver');
        add(topFlat(this.memberAny,prefix,limit*4),38,'member');
      }
      add(topFlat(this.byLanguage.get(language)||new Map(),prefix,limit*4),18,'language-symbol');
      add(topFlat(this.symbols,prefix,limit*4),8,'symbol');
      return [...scored.values()]
        .filter(x=>x.value!==prefix&&!STOP.has(String(x.value).toLowerCase()))
        .sort((a,b)=>b.score-a.score||a.value.localeCompare(b.value))
        .slice(0,limit)
        .map(x=>({...x,kind:this.bestKind(x.value)}));
    }
    suggestLinePrefix(currentLine,language,limit=4){
      const prefix=String(currentLine||'').trim();
      if(prefix.length<4)return [];
      const lines=this.linesByLanguage.get(language);
      if(!lines)return [];
      const low=prefix.toLowerCase(),rows=[];
      for(const [line,count] of lines){
        if(line.length<=prefix.length)continue;
        let quality=0;
        if(line.startsWith(prefix))quality=80;
        else if(line.toLowerCase().startsWith(low))quality=60;
        if(!quality)continue;
        rows.push({value:line,suffix:line.slice(prefix.length),score:quality+count+Math.min(prefix.length,40)});
      }
      rows.sort((a,b)=>b.score-a.score||a.value.localeCompare(b.value));
      return rows.slice(0,limit);
    }
    suggestNextLine(previousLine,language,limit=3){
      return topNested(this.lineTransitions,language+'\u0000'+String(previousLine||'').trim().slice(-160),'',limit);
    }
    compact(){
      const symbols=[...this.symbols.entries()].sort((a,b)=>b[1]-a[1]).slice(0,1800);
      const members=[...this.memberAny.entries()].sort((a,b)=>b[1]-a[1]).slice(0,800);
      const kinds=[...this.symbolKinds.entries()].slice(0,1000).map(([name,map])=>[name,[...map.entries()]]);
      return {version:VERSION,symbols,members,kinds};
    }
    seedCompact(data){
      if(!data||!Array.isArray(data.symbols))return false;
      for(const [name,count] of data.symbols.slice(0,1800))if(isIdentifier(name))bumpFlat(this.symbols,name,Math.max(1,Number(count)||1));
      for(const [name,count] of (data.members||[]).slice(0,800))if(isIdentifier(name))bumpFlat(this.memberAny,name,Math.max(1,Number(count)||1));
      for(const [name,kinds] of (data.kinds||[]).slice(0,1000))for(const [kind,count] of (kinds||[]))for(let i=0;i<Math.min(5,Number(count)||1);i++)this.rememberKind(name,kind);
      this.stats.symbols=this.symbols.size;
      return true;
    }
    status(){return {...this.stats};}
  }

  let active=false;
  let enabled=true;
  let host=null;
  let projectEngine=new LocalIntelliEngine('project');
  let liveEngine=new LocalIntelliEngine('live');
  let disposables=[];
  let modelListeners=new Map();
  let liveTimer=null;
  let workspaceTimer=null;
  let projectRoot='';
  let projectIndexing=false;
  let projectFiles=0;
  let projectBytes=0;
  let cacheLoaded=false;
  let lastProjectError='';
  let profileOverride='auto';
  let projectIndexEnabled=true;
  let aiClient=null;
  let aiApiKey='';
  let aiModels=[];
  let aiModel='';
  let aiInlineEnabled=false;
  let aiLastDiagnostic=null;
  let aiLastInlineAt=0;
  let aiInlineInflight=null;
  const aiInlineCache=new Map();


  function getAiKey(){
    return String(aiApiKey||'').trim();
  }
  function setAiKey(value){
    aiApiKey=String(value||'').trim();
    return Boolean(aiApiKey);
  }
  function createDialog(title,message,kind='text',options=[]){
    return new Promise(resolve=>{
      const back=document.createElement('div');
      back.dataset.axiomIntelliCodeDialog='1';
      Object.assign(back.style,{position:'fixed',inset:'0',zIndex:'999999',background:'rgba(0,0,0,.58)',display:'grid',placeItems:'center'});
      const box=document.createElement('div');
      Object.assign(box.style,{width:'min(560px,calc(100vw - 32px))',background:'#1f1f1f',color:'#ddd',border:'1px solid #555',borderRadius:'8px',padding:'16px',boxShadow:'0 16px 50px rgba(0,0,0,.45)',fontFamily:'var(--vscode-font-family,Segoe UI,sans-serif)'});
      const heading=document.createElement('div');
      heading.textContent=title;
      Object.assign(heading.style,{fontWeight:'600',fontSize:'15px',marginBottom:'8px'});
      const msg=document.createElement('div');
      msg.textContent=message||'';
      Object.assign(msg.style,{fontSize:'12px',opacity:'.86',marginBottom:'12px',whiteSpace:'pre-wrap'});
      let field;
      if(kind==='select'){
        field=document.createElement('select');
        for(const value of options){
          const opt=document.createElement('option');
          opt.value=value;
          opt.textContent=value;
          field.appendChild(opt);
        }
      }else if(kind==='textarea'){
        field=document.createElement('textarea');
        field.rows=7;
      }else{
        field=document.createElement('input');
        field.type=kind==='secret'?'password':'text';
        field.autocomplete='off';
      }
      Object.assign(field.style,{boxSizing:'border-box',width:'100%',background:'#111',color:'#eee',border:'1px solid #555',borderRadius:'4px',padding:'9px',font:'inherit',resize:'vertical'});
      const actions=document.createElement('div');
      Object.assign(actions.style,{display:'flex',justifyContent:'flex-end',gap:'8px',marginTop:'12px'});
      const cancel=document.createElement('button');
      cancel.textContent='Cancelar';
      const ok=document.createElement('button');
      ok.textContent='Aceptar';
      for(const button of [cancel,ok])Object.assign(button.style,{padding:'7px 12px',border:'1px solid #666',borderRadius:'4px',background:'#333',color:'#fff',cursor:'pointer'});
      ok.style.background='#0e639c';
      const done=value=>{field.value='';back.remove();resolve(value);};
      cancel.onclick=()=>done(null);
      ok.onclick=()=>done(field.value);
      back.onclick=event=>{if(event.target===back)done(null);};
      field.onkeydown=event=>{
        if(event.key==='Escape'){event.preventDefault();done(null);}
        if(kind!=='textarea'&&event.key==='Enter'){event.preventDefault();done(field.value);}
      };
      actions.append(cancel,ok);
      box.append(heading,msg,field,actions);
      back.appendChild(box);
      document.body.appendChild(back);
      field.focus();
    });
  }
  function ensureAiClient(){
    if(!host?.network?.request)throw victorsError(null,'Esta función de IA requiere una versión de AxiomCode con la API genérica de red para extensiones.','CORE_NETWORK_REQUIRED',null);
    if(!aiClient){
      const bridgeFetch=async(url,options={})=>{
        const raw=await host.network.request({
          url,
          method:options.method||'GET',
          headers:options.headers||{},
          body:options.body,
          timeoutMs:30000
        });
        const headers=raw?.headers&&typeof raw.headers==='object'?raw.headers:{};
        const headerEntries=Object.entries(headers).map(([name,value])=>[String(name).toLowerCase(),String(value)]);
        const headerMap=new Map(headerEntries);
        return {
          status:Number(raw?.status)||0,
          ok:Boolean(raw?.ok),
          url:String(raw?.url||url),
          headers:{get:name=>headerMap.get(String(name||'').toLowerCase())??null},
          json:async()=>{
            try{return JSON.parse(String(raw?.text||''));}
            catch{throw new Error('Victorsia Free devolvió una respuesta JSON no válida');}
          }
        };
      };
      aiClient=new VictorsAIClient({keyProvider:getAiKey,fetchFn:bridgeFetch});
    }
    return aiClient;
  }
  function friendlyAiError(error,quiet=false){
    const code=error?.code;
    if(code==='AUTH')setAiKey('');
    if(!quiet){
      if(code==='PROVIDER_OFFLINE')host?.info?.('Axiom IntelliCode IA','<p>Victorsia Free está offline temporalmente.</p>');
      else if(code==='AUTH')host?.info?.('Axiom IntelliCode IA','<p>La API key fue rechazada. Revisa la API key y vuelve a configurarla.</p>');
      else if(code==='NO_API_KEY')host?.info?.('Axiom IntelliCode IA','<p>Configura primero la API key de Victorsia Free.</p>');
      else if(code==='CORE_NETWORK_REQUIRED')host?.info?.('Axiom IntelliCode IA','<p>Actualiza AxiomCode para habilitar la API genérica de red requerida por esta extensión.</p>');
      else host?.info?.('Axiom IntelliCode IA','<p>'+htmlEscape(String(error?.message||error))+'</p>');
    }
    return null;
  }
  async function refreshAiModels(){
    const client=ensureAiClient();
    const result=await client.models();
    aiModels=result.models;
    aiLastDiagnostic=result.diagnostic;
    let preferred='';
    try{preferred=localStorage.getItem('axiom.intellicode.victors.model')||'';}catch{}
    aiModel=chooseVictorsModel(aiModels,preferred);
    if(aiModel){try{localStorage.setItem('axiom.intellicode.victors.model',aiModel);}catch{}}
    return aiModels;
  }
  async function ensureAiReady(){
    if(!getAiKey())throw victorsError(null,'Configura la API key de Victorsia Free primero.','NO_API_KEY',null);
    if(!aiModels.length||!aiModel)await refreshAiModels();
    if(!aiModel)throw new Error('Victorsia Free no devolvió modelos disponibles');
    return aiModel;
  }
  async function configureAi(){
    let key=getAiKey();
    if(!key){
      key=await createDialog('Victorsia Free','Introduce la API key. Se mantiene solo durante esta sesión y no se registra en logs.','secret');
      if(!key)return status();
      setAiKey(key);
    }
    try{
      host?.status?.('Axiom IntelliCode IA: consultando modelos...');
      const models=await refreshAiModels();
      if(!models.length)throw new Error('La API no devolvió modelos');
      const selected=await createDialog('Modelo de IA','Selecciona un identificador completo devuelto por /v1/models.','select',models);
      if(selected&&models.includes(selected)){
        aiModel=selected;
        try{localStorage.setItem('axiom.intellicode.victors.model',selected);}catch{}
      }
      host?.status?.('Axiom IntelliCode IA: '+aiModel);
      return status();
    }catch(error){
      friendlyAiError(error);
      return status();
    }
  }
  function editorContext(maxBefore=7000,maxAfter=1800){
    const model=host?.editor?.getModel?.();
    const position=host?.editor?.getPosition?.();
    if(!model||!position)return null;
    const value=model.getValue();
    const offset=model.getOffsetAt(position);
    const language=model.getLanguageId?.()||'plaintext';
    const uri=model.uri?.toString?.()||'';
    return {
      model,position,language,uri,
      before:value.slice(Math.max(0,offset-maxBefore),offset),
      after:value.slice(offset,Math.min(value.length,offset+maxAfter))
    };
  }
  async function aiRequest(messages,options={}){
    const model=await ensureAiReady();
    const result=await ensureAiClient().complete({
      model,messages,
      temperature:options.temperature??0.2,
      maxTokens:options.maxTokens??512
    });
    aiLastDiagnostic=result.diagnostic;
    host?.log?.('IA Victorsia · HTTP '+(result.diagnostic?.status??'?')+' · modelo '+String(result.diagnostic?.model||model)+' · request '+String(result.diagnostic?.requestId||'N/D'));
    return result;
  }
  function insertAtCursor(text){
    const editor=host?.editor;
    const position=editor?.getPosition?.();
    if(!editor||!position||!text)return false;
    editor.executeEdits('axiom.intellicode.ai',[{
      range:new host.monaco.Range(position.lineNumber,position.column,position.lineNumber,position.column),
      text:String(text),forceMoveMarkers:true
    }]);
    editor.focus();
    return true;
  }
  async function aiCompleteAtCursor(){
    try{
      const ctx=editorContext();
      if(!ctx)throw new Error('No hay un editor activo');
      host?.status?.('Axiom IntelliCode IA: generando...');
      const prompt=[
        'Completa el código exactamente en <CURSOR>.',
        'Lenguaje: '+ctx.language+'.',
        'Devuelve únicamente el código que debe insertarse en el cursor, sin Markdown, sin explicación y sin repetir código existente.',
        '',
        ctx.before+'<CURSOR>'+ctx.after
      ].join('\n');
      const result=await aiRequest([{role:'user',content:prompt}],{temperature:0.15,maxTokens:384});
      const code=stripCodeFence(result.content);
      if(!code)throw new Error('El modelo no devolvió código');
      insertAtCursor(code);
      host?.status?.('Axiom IntelliCode IA: completado con '+String(aiModel));
      return result.diagnostic;
    }catch(error){
      friendlyAiError(error);
      return error?.diagnostic||null;
    }
  }
  async function aiExplainSelection(){
    try{
      const editor=host?.editor,model=editor?.getModel?.(),selection=editor?.getSelection?.();
      if(!model||!selection)throw new Error('No hay un editor activo');
      const selected=model.getValueInRange(selection).slice(0,8000);
      if(!selected.trim())throw new Error('Selecciona código para explicarlo');
      const language=model.getLanguageId?.()||'plaintext';
      host?.status?.('Axiom IntelliCode IA: analizando selección...');
      const result=await aiRequest([{role:'user',content:'Explica de forma clara y breve este código '+language+'. Señala qué hace, riesgos y posibles mejoras si aplican.\n\n'+selected}],{temperature:0.25,maxTokens:700});
      host?.info?.('Axiom IntelliCode IA · Explicación','<div style="white-space:pre-wrap">'+htmlEscape(result.content)+'</div>');
      return result.diagnostic;
    }catch(error){
      friendlyAiError(error);
      return error?.diagnostic||null;
    }
  }
  async function aiFixSelection(){
    try{
      const editor=host?.editor,model=editor?.getModel?.(),selection=editor?.getSelection?.();
      if(!model||!selection)throw new Error('No hay un editor activo');
      const selected=model.getValueInRange(selection).slice(0,8000);
      if(!selected.trim())throw new Error('Selecciona el código que quieres corregir');
      const language=model.getLanguageId?.()||'plaintext';
      host?.status?.('Axiom IntelliCode IA: corrigiendo selección...');
      const result=await aiRequest([{role:'user',content:'Corrige y mejora este código '+language+'. Conserva su intención. Devuelve únicamente el código final, sin Markdown ni explicación.\n\n'+selected}],{temperature:0.15,maxTokens:900});
      const code=stripCodeFence(result.content);
      if(!code)throw new Error('El modelo no devolvió código');
      if(!window.confirm('¿Reemplazar la selección con la corrección generada por IA?'))return result.diagnostic;
      editor.executeEdits('axiom.intellicode.ai.fix',[{range:selection,text:code,forceMoveMarkers:true}]);
      editor.focus();
      return result.diagnostic;
    }catch(error){
      friendlyAiError(error);
      return error?.diagnostic||null;
    }
  }
  async function selectAiModel(){
    try{
      const models=await refreshAiModels();
      const selected=await createDialog('Modelo de Victorsia Free','Selecciona el modelo completo.','select',models);
      if(selected&&models.includes(selected)){
        aiModel=selected;
        try{localStorage.setItem('axiom.intellicode.victors.model',selected);}catch{}
        host?.status?.('Axiom IntelliCode IA: modelo '+selected);
      }
      return status();
    }catch(error){
      friendlyAiError(error);
      return status();
    }
  }
  async function aiInlineCompletion(ctx){
    if(!aiInlineEnabled||!getAiKey()||!ctx)return null;
    const now=Date.now();
    const cacheKeyValue=hashText(ctx.language+'\n'+ctx.before.slice(-2200)+'\n'+ctx.after.slice(0,500));
    const cached=aiInlineCache.get(cacheKeyValue);
    if(cached&&now-cached.time<30000)return cached.text;
    if(aiInlineInflight||now-aiLastInlineAt<5000)return null;
    aiLastInlineAt=now;
    aiInlineInflight=(async()=>{
      try{
        const prompt=[
          'Completa el código en <CURSOR>.',
          'Lenguaje: '+ctx.language+'.',
          'Devuelve solo una continuación corta de código, máximo unas pocas líneas. Sin Markdown ni explicación.',
          '',
          ctx.before.slice(-2600)+'<CURSOR>'+ctx.after.slice(0,700)
        ].join('\n');
        const result=await aiRequest([{role:'user',content:prompt}],{temperature:0.1,maxTokens:120});
        const text=stripCodeFence(result.content);
        if(text){
          aiInlineCache.set(cacheKeyValue,{text,time:Date.now()});
          while(aiInlineCache.size>24)aiInlineCache.delete(aiInlineCache.keys().next().value);
        }
        return text||null;
      }catch(error){
        if(error?.code==='AUTH'||error?.code==='PROVIDER_OFFLINE')aiInlineEnabled=false;
        friendlyAiError(error,true);
        return null;
      }finally{
        aiInlineInflight=null;
      }
    })();
    return aiInlineInflight;
  }

  function memoryProfile(){
    const profiles={
      light:{id:'light',name:'ligero',files:28,bytes:1536*1024,fileBytes:192*1024,concurrency:2},
      balanced:{id:'balanced',name:'equilibrado',files:64,bytes:4*1024*1024,fileBytes:384*1024,concurrency:4},
      high:{id:'high',name:'alto',files:96,bytes:6*1024*1024,fileBytes:512*1024,concurrency:5}
    };
    if(profileOverride&&profileOverride!=='auto'&&profiles[profileOverride])return profiles[profileOverride];
    let memory=8;
    try{memory=Number(navigator.deviceMemory||8)||8;}catch{}
    if(memory<=4)return profiles.light;
    if(memory>=12)return profiles.high;
    return profiles.balanced;
  }
  function hashText(value){
    let hash=2166136261;
    for(const ch of String(value||'')){hash^=ch.charCodeAt(0);hash=Math.imul(hash,16777619);}
    return (hash>>>0).toString(36);
  }
  function cacheKey(rootPath){return 'axiom.intellicode.cache.v2.'+hashText(rootPath||'global');}
  function loadCache(rootPath){
    cacheLoaded=false;
    try{
      const raw=localStorage.getItem(cacheKey(rootPath));
      if(!raw)return false;
      const data=JSON.parse(raw);
      if(!data||data.version!==VERSION)return false;
      cacheLoaded=projectEngine.seedCompact(data);
      return cacheLoaded;
    }catch{return false;}
  }
  function saveCache(rootPath){
    try{
      const data=projectEngine.compact();
      const raw=JSON.stringify(data);
      if(raw.length<450000)localStorage.setItem(cacheKey(rootPath),raw);
    }catch{}
  }
  function clearCache(rootPath){
    try{localStorage.removeItem(cacheKey(rootPath||projectRoot));}catch{}
  }
  function filePriority(file){
    const pathValue=String(file.path||file.name||'').replace(/\\/g,'/');
    const name=String(file.name||pathValue.split('/').pop()||'').toLowerCase();
    const depth=Math.max(0,pathValue.split('/').filter(Boolean).length-1);
    let score=depth*4;
    if(/^(?:index|main|app|server|client|core|lib|mod)\./.test(name))score-=18;
    if(/(?:test|spec)\./.test(name))score+=8;
    if(GENERATED_FILE_RE.test(name))score+=100;
    return score;
  }
  function workspaceFiles(tree){
    const out=[];
    const walk=nodes=>{
      for(const node of (nodes||[])){
        if(node.type==='dir'){
          if(SKIP_DIRS.has(String(node.name||'').toLowerCase()))continue;
          walk(node.children||[]);
        }else if(node.type==='file'){
          const name=String(node.name||'').toLowerCase();
          if(SKIP_FILES.has(name)||GENERATED_FILE_RE.test(name))continue;
          const language=languageFromPath(node.path||node.name);
          if(language&&SUPPORTED.includes(language))out.push({path:node.path,name:node.name,language});
        }
      }
    };
    walk(tree||[]);
    return out.sort((a,b)=>filePriority(a)-filePriority(b)||String(a.path).localeCompare(String(b.path)));
  }
  async function readProjectFile(file,maxBytes){
    try{
      if(!window?.axiom?.readFile)return null;
      const result=await window.axiom.readFile(file.path);
      let content=String(result?.content||'');
      if(content.length>maxBytes)content=content.slice(0,maxBytes);
      return {...file,content};
    }catch{return null;}
  }
  async function indexWorkspace(force=false){
    if(!active||!host||projectIndexing)return status();
    const workspace=host.getWorkspace?.();
    const rootPath=String(workspace?.root||'');
    if(!rootPath||!workspace?.tree){
      projectRoot='';
      projectFiles=0;
      projectBytes=0;
      return status();
    }
    if(!projectIndexEnabled){
      projectRoot=rootPath;
      projectEngine=new LocalIntelliEngine('project');
      projectFiles=0;
      projectBytes=0;
      return status();
    }
    if(!force&&projectRoot===rootPath&&projectFiles>0)return status();
    projectIndexing=true;
    lastProjectError='';
    try{
      const profile=memoryProfile();
      const files=workspaceFiles(workspace.tree).slice(0,profile.files);
      const next=new LocalIntelliEngine('project');
      let bytes=0,count=0;
      for(let i=0;i<files.length&&bytes<profile.bytes;i+=profile.concurrency){
        const batch=files.slice(i,i+profile.concurrency);
        const rows=await Promise.all(batch.map(file=>readProjectFile(file,Math.min(profile.fileBytes,profile.bytes-bytes))));
        for(const row of rows){
          if(!row||!row.content||bytes>=profile.bytes)continue;
          let content=row.content;
          const remaining=profile.bytes-bytes;
          if(content.length>remaining)content=content.slice(0,remaining);
          next.learnText(content,row.language,1);
          bytes+=content.length;
          count++;
        }
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      projectEngine=next;
      projectRoot=rootPath;
      projectFiles=count;
      projectBytes=bytes;
      saveCache(rootPath);
      host.log?.('índice de proyecto actualizado · '+count+' archivos · '+next.stats.symbols+' símbolos · perfil '+profile.name);
    }catch(error){
      lastProjectError=String(error?.message||error);
      host.log?.('índice de proyecto: '+lastProjectError);
    }finally{
      projectIndexing=false;
    }
    return status();
  }
  function disposeAll(){
    clearTimeout(liveTimer);
    liveTimer=null;
    clearInterval(workspaceTimer);
    workspaceTimer=null;
    for(const d of disposables.splice(0)){try{d.dispose();}catch{}}
    for(const d of modelListeners.values()){try{d.dispose();}catch{}}
    modelListeners.clear();
  }
  function supportedModels(){
    const models=host?.getModels?host.getModels():host?.monaco?.editor?.getModels?.()||[];
    return models.filter(model=>{
      try{return SUPPORTED.includes(model.getLanguageId());}catch{return false;}
    });
  }
  function rebuildLive(){
    if(!active||!host)return status();
    const models=supportedModels();
    const activeModel=host.editor?.getModel?.();
    const activeKey=activeModel?.uri?.toString?.()||'';
    const next=new LocalIntelliEngine('live');
    next.stats.rebuilds=(liveEngine.stats?.rebuilds||0)+1;
    const ordered=[...models].sort((a,b)=>{
      const ak=(a.uri?.toString?.()||'')===activeKey?0:1;
      const bk=(b.uri?.toString?.()||'')===activeKey?0:1;
      return ak-bk;
    }).slice(0,24);
    for(const model of ordered){
      let value='';
      let language='plaintext';
      try{value=model.getValue();language=model.getLanguageId();}catch{continue;}
      const isActive=(model.uri?.toString?.()||'')===activeKey;
      next.learnText(value,language,isActive?4:2);
      if(isActive&&value.length>12000)next.learnText(value.slice(-12000),language,6);
    }
    liveEngine=next;
    return liveEngine.status();
  }
  function scheduleLiveRebuild(delay=420){
    clearTimeout(liveTimer);
    liveTimer=setTimeout(()=>{
      if(!active||!host)return;
      rebuildLive();
    },delay);
  }
  function watchModel(model){
    if(!model)return;
    const key=model.uri?.toString?.()||model.id||String(model);
    if(modelListeners.has(key))return;
    try{modelListeners.set(key,model.onDidChangeContent(()=>scheduleLiveRebuild()));}catch{}
  }
  function mergeRows(projectRows,liveRows,limit){
    const merged=new Map();
    const add=(rows,multiplier,label)=>{
      for(const row of rows||[]){
        const score=row.score*multiplier;
        const old=merged.get(row.value);
        if(!old||score>old.score)merged.set(row.value,{...row,score,source:label+':'+(row.source||'learned')});
      }
    };
    add(projectRows,1,'proyecto');
    add(liveRows,1.55,'archivo');
    return [...merged.values()].sort((a,b)=>b.score-a.score||a.value.localeCompare(b.value)).slice(0,limit);
  }
  function receiverFromContext(contextTokens){
    if(!Array.isArray(contextTokens)||contextTokens.length<2)return null;
    if(!MEMBER_OPS.has(contextTokens[contextTokens.length-1]))return null;
    const receiver=contextTokens[contextTokens.length-2];
    return isIdentifier(receiver)?receiver:null;
  }
  function scopeSuggestions(contextTokens,prefix='',limit=8){
    const counts=new Map();
    const slice=(contextTokens||[]).slice(-160);
    for(const token of slice){
      if(!isIdentifier(token)||STOP.has(token.toLowerCase())||token.length<2)continue;
      counts.set(token,(counts.get(token)||0)+1);
    }
    return [...counts.entries()]
      .map(([value,count])=>({value,score:120+count*8+fuzzyMatch(value,prefix),source:'scope',kind:'variable'}))
      .filter(row=>fuzzyMatch(row.value,prefix)>0&&row.value!==prefix)
      .sort((a,b)=>b.score-a.score||a.value.localeCompare(b.value))
      .slice(0,limit);
  }
  function mergeScope(rows,scopeRows,limit=24){
    const merged=new Map((rows||[]).map(row=>[row.value,row]));
    for(const row of scopeRows||[]){
      const old=merged.get(row.value);
      if(!old||row.score>old.score)merged.set(row.value,row);
    }
    return [...merged.values()].sort((a,b)=>b.score-a.score||a.value.localeCompare(b.value)).slice(0,limit);
  }
  function monacoKind(kind){
    const kinds=host.monaco.languages.CompletionItemKind;
    return {
      class:kinds.Class,interface:kinds.Interface,struct:kinds.Struct,enum:kinds.Enum,
      function:kinds.Function,method:kinds.Method,variable:kinds.Variable,property:kinds.Property,
      module:kinds.Module
    }[kind]||kinds.Variable;
  }
  function templatesFor(language,prefix,range){
    const rows=[];
    for(const template of TEMPLATES[language]||[]){
      const [key,label,insert]=template;
      if(prefix&&!key.startsWith(prefix.toLowerCase())&&!label.toLowerCase().startsWith(prefix.toLowerCase()))continue;
      rows.push({
        label,
        kind:host.monaco.languages.CompletionItemKind.Snippet,
        insertText:insert,
        insertTextRules:host.monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        detail:'Axiom IntelliCode · plantilla '+language,
        sortText:'zz-'+label,
        range
      });
    }
    return rows;
  }
  function completionProvider(language){
    return {
      triggerCharacters:['.','_','$',':','>'],
      provideCompletionItems(model,position,_context,cancelToken){
        if(!enabled||cancelToken?.isCancellationRequested)return {suggestions:[]};
        const lineBefore=model.getLineContent(position.lineNumber).slice(0,position.column-1);
        if(looksLikeComment(lineBefore,language))return {suggestions:[]};
        const word=model.getWordUntilPosition(position);
        const prefix=word.word||'';
        const before=model.getValueInRange({
          startLineNumber:Math.max(1,position.lineNumber-8),startColumn:1,
          endLineNumber:position.lineNumber,endColumn:word.startColumn
        });
        const context=tokenise(before);
        const receiver=receiverFromContext(context);
        const options={language,receiver};
        const projectRows=projectEngine.suggestTokens(context,prefix,18,options);
        const liveRows=liveEngine.suggestTokens(context,prefix,18,options);
        const rows=mergeScope(mergeRows(projectRows,liveRows,24),scopeSuggestions(context,prefix,10),24);
        const range={
          startLineNumber:position.lineNumber,startColumn:word.startColumn,
          endLineNumber:position.lineNumber,endColumn:position.column
        };
        const suggestions=[];
        const seen=new Set();
        for(let i=0;i<rows.length;i++){
          const row=rows[i];
          if(!row.value||seen.has(row.value)||row.value===prefix)continue;
          seen.add(row.value);
          suggestions.push({
            label:row.value,
            kind:monacoKind(row.kind),
            insertText:row.value,
            filterText:row.value,
            detail:'Axiom IntelliCode · '+row.source,
            sortText:String(999999999-Math.min(999999998,Math.round(row.score*100))).padStart(9,'0'),
            preselect:i===0,
            range
          });
        }
        for(const item of templatesFor(language,prefix,range))if(!seen.has(item.label))suggestions.push(item);
        return {suggestions:suggestions.slice(0,30)};
      }
    };
  }
  function bestLineSuggestion(currentLine,language){
    const rows=mergeRows(
      projectEngine.suggestLinePrefix(currentLine,language,4),
      liveEngine.suggestLinePrefix(currentLine,language,4),
      4
    );
    return rows[0]||null;
  }
  function inlineProvider(language){
    return {
      async provideInlineCompletions(model,position,_context,cancelToken){
        if(!enabled||cancelToken?.isCancellationRequested)return {items:[]};
        const lineBefore=model.getLineContent(position.lineNumber).slice(0,position.column-1);
        if(looksLikeComment(lineBefore,language))return {items:[]};
        const trimmed=lineBefore.trim();
        if(!trimmed&&position.lineNumber>1){
          const previous=model.getLineContent(position.lineNumber-1).trim();
          if(previous){
            const rows=mergeRows(
              projectEngine.suggestNextLine(previous,language,3),
              liveEngine.suggestNextLine(previous,language,3),
              1
            );
            const best=rows[0];
            if(best?.value)return {items:[{
              insertText:best.value,
              range:{
                startLineNumber:position.lineNumber,startColumn:position.column,
                endLineNumber:position.lineNumber,endColumn:position.column
              }
            }]};
          }
        }
        if(trimmed.length>=4){
          const line=bestLineSuggestion(trimmed,language);
          if(line?.value&&line.value.length>trimmed.length){
            const suffix=line.value.slice(trimmed.length);
            if(suffix)return {items:[{
              insertText:suffix,
              range:{
                startLineNumber:position.lineNumber,startColumn:position.column,
                endLineNumber:position.lineNumber,endColumn:position.column
              }
            }]};
          }
        }
        const word=model.getWordUntilPosition(position);
        const prefix=word.word||'';
        if(prefix.length<2)return {items:[]};
        const before=model.getValueInRange({
          startLineNumber:Math.max(1,position.lineNumber-6),startColumn:1,
          endLineNumber:position.lineNumber,endColumn:word.startColumn
        });
        const context=tokenise(before);
        const receiver=receiverFromContext(context);
        const rows=mergeRows(
          projectEngine.suggestTokens(context,prefix,2,{language,receiver}),
          liveEngine.suggestTokens(context,prefix,2,{language,receiver}),
          1
        );
        const best=rows[0];
        if(best&&best.value.length>prefix.length&&best.value.toLowerCase().startsWith(prefix.toLowerCase())){
          return {items:[{
            insertText:best.value.slice(prefix.length),
            range:{
              startLineNumber:position.lineNumber,startColumn:position.column,
              endLineNumber:position.lineNumber,endColumn:position.column
            }
          }]};
        }
        if(aiInlineEnabled&&prefix.length>=2&&getAiKey()){
          const full=model.getValue(),offset=model.getOffsetAt(position);
          const aiText=await aiInlineCompletion({
            language,
            before:full.slice(Math.max(0,offset-3200),offset),
            after:full.slice(offset,Math.min(full.length,offset+900))
          });
          if(aiText)return {items:[{
            insertText:aiText,
            range:{
              startLineNumber:position.lineNumber,startColumn:position.column,
              endLineNumber:position.lineNumber,endColumn:position.column
            }
          }]};
        }
        return {items:[]};
      },
      freeInlineCompletions(){}
    };
  }
  async function activate(nextHost){
    if(!nextHost?.monaco||!nextHost?.editor)throw new Error('Axiom IntelliCode necesita Monaco y el editor activo');
    disposeAll();
    host=nextHost;
    active=true;
    projectEngine=new LocalIntelliEngine('project');
    liveEngine=new LocalIntelliEngine('live');
    projectFiles=0;
    projectBytes=0;
    projectRoot='';
    try{
      enabled=localStorage.getItem('axiom.intellicode.enabled')!=='0';
      projectIndexEnabled=localStorage.getItem('axiom.intellicode.projectIndex')!=='0';
      profileOverride=localStorage.getItem('axiom.intellicode.profile')||'auto';
      if(!['auto','light','balanced','high'].includes(profileOverride))profileOverride='auto';
      aiInlineEnabled=localStorage.getItem('axiom.intellicode.aiInline')==='1';
      aiModel=localStorage.getItem('axiom.intellicode.victors.model')||'';
    }catch{
      enabled=true;
      projectIndexEnabled=true;
      profileOverride='auto';
      aiInlineEnabled=false;
      aiModel='';
    }
    aiClient=null;
    aiModels=[];
    aiLastDiagnostic=null;
    const initialWorkspace=host.getWorkspace?.();
    if(initialWorkspace?.root)loadCache(String(initialWorkspace.root));
    for(const language of SUPPORTED){
      disposables.push(host.monaco.languages.registerCompletionItemProvider(language,completionProvider(language)));
      if(typeof host.monaco.languages.registerInlineCompletionsProvider==='function'){
        disposables.push(host.monaco.languages.registerInlineCompletionsProvider(language,inlineProvider(language)));
      }
    }
    for(const model of supportedModels())watchModel(model);
    if(typeof host.monaco.editor.onDidCreateModel==='function'){
      disposables.push(host.monaco.editor.onDidCreateModel(model=>{watchModel(model);scheduleLiveRebuild(60);}));
    }
    if(typeof host.monaco.editor.onWillDisposeModel==='function'){
      disposables.push(host.monaco.editor.onWillDisposeModel(model=>{
        const key=model.uri?.toString?.()||model.id||String(model);
        try{modelListeners.get(key)?.dispose?.();}catch{}
        modelListeners.delete(key);
        scheduleLiveRebuild(60);
      }));
    }
    rebuildLive();
    await indexWorkspace(false);
    workspaceTimer=setInterval(()=>{
      if(!active)return;
      const rootNow=String(host.getWorkspace?.()?.root||'');
      if(projectIndexEnabled&&rootNow&&rootNow!==projectRoot){
        projectEngine=new LocalIntelliEngine('project');
        loadCache(rootNow);
        indexWorkspace(true).catch(()=>{});
      }
    },2500);
    host.log?.('motor '+VERSION+' activo · '+(enabled?'sugerencias habilitadas':'sugerencias pausadas'));
    return status();
  }
  function deactivate(){
    active=false;
    disposeAll();
    aiApiKey='';
    aiClient=null;
    aiModels=[];
    aiLastDiagnostic=null;
    aiInlineCache.clear();
    host=null;
    projectEngine=new LocalIntelliEngine('project');
    liveEngine=new LocalIntelliEngine('live');
    return true;
  }
  async function rebuild(){
    rebuildLive();
    await indexWorkspace(true);
    return status();
  }
  function status(){
    const project=projectEngine.status(),live=liveEngine.status(),profile=memoryProfile();
    return {
      active,enabled,version:VERSION,supportedLanguages:[...SUPPORTED],
      projectFiles,projectBytes,projectRoot,projectIndexing,lastProjectError,
      project,live,cacheLoaded,memoryProfile:profile.name,profileMode:profileOverride,
      projectIndexEnabled,
      ai:{
        configured:Boolean(getAiKey()),
        inlineEnabled:aiInlineEnabled,
        model:aiModel||null,
        availableModels:aiModels.length,
        lastDiagnostic:aiLastDiagnostic?{...aiLastDiagnostic}:null
      },
      models:live.models,
      tokens:project.tokens+live.tokens,
      symbols:new Set([...projectEngine.symbols.keys(),...liveEngine.symbols.keys()]).size,
      cloud:false,telemetry:false
    };
  }
  function htmlEscape(value){
    return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }
  async function runCommand(id){
    if(id==='intellicode.status'){
      const s=status();
      host?.info?.('Axiom IntelliCode',
        '<p><b>'+(s.enabled?'Activo':'Pausado')+'</b> · v'+htmlEscape(s.version)+' · motor local, sin nube ni telemetría.</p>'+
        '<p>Proyecto: '+Number(s.projectFiles||0)+' archivos · '+Math.round(Number(s.projectBytes||0)/1024).toLocaleString()+' KiB</p>'+
        '<p>Modelos abiertos: '+Number(s.models||0)+' · tokens: '+Number(s.tokens||0).toLocaleString()+
        ' · símbolos: '+Number(s.symbols||0).toLocaleString()+'</p>'+
        '<p>Perfil de memoria: '+htmlEscape(s.memoryProfile)+' ('+htmlEscape(s.profileMode)+') · índice de proyecto: '+(s.projectIndexEnabled?'sí':'no')+' · caché: '+(s.cacheLoaded?'sí':'no')+'</p>'+
        '<p>IA Victorsia: '+(s.ai.configured?'configurada':'sin API key')+' · modelo: '+htmlEscape(s.ai.model||'N/D')+' · inline: '+(s.ai.inlineEnabled?'sí':'no')+'</p>'
      );
      return s;
    }
    if(id==='intellicode.rebuild'){
      host?.status?.('Axiom IntelliCode: reindexando proyecto...');
      const s=await rebuild();
      host?.status?.('Axiom IntelliCode: '+Number(s.projectFiles||0)+' archivos · '+Number(s.symbols||0).toLocaleString()+' símbolos');
      return s;
    }
    if(id==='intellicode.toggle'){
      enabled=!enabled;
      try{localStorage.setItem('axiom.intellicode.enabled',enabled?'1':'0');}catch{}
      host?.status?.('Axiom IntelliCode: '+(enabled?'activado':'pausado'));
      return status();
    }
    if(id==='intellicode.clear'){
      clearCache(projectRoot);
      cacheLoaded=false;
      projectEngine=new LocalIntelliEngine('project');
      liveEngine=new LocalIntelliEngine('live');
      rebuildLive();
      await indexWorkspace(true);
      host?.status?.('Axiom IntelliCode: aprendizaje local reconstruido');
      return status();
    }
    if(id==='intellicode.profile'){
      const order=['auto','light','balanced','high'];
      profileOverride=order[(order.indexOf(profileOverride)+1)%order.length];
      try{localStorage.setItem('axiom.intellicode.profile',profileOverride);}catch{}
      if(projectIndexEnabled)await indexWorkspace(true);
      host?.status?.('Axiom IntelliCode: perfil '+memoryProfile().name+' ('+profileOverride+')');
      return status();
    }
    if(id==='intellicode.projectIndex'){
      projectIndexEnabled=!projectIndexEnabled;
      try{localStorage.setItem('axiom.intellicode.projectIndex',projectIndexEnabled?'1':'0');}catch{}
      if(projectIndexEnabled)await indexWorkspace(true);
      else{
        projectEngine=new LocalIntelliEngine('project');
        projectFiles=0;
        projectBytes=0;
      }
      host?.status?.('Axiom IntelliCode: índice de proyecto '+(projectIndexEnabled?'activado':'desactivado'));
      return status();
    }
    if(id==='intellicode.ai.configure')return configureAi();
    if(id==='intellicode.ai.model')return selectAiModel();
    if(id==='intellicode.ai.complete')return aiCompleteAtCursor();
    if(id==='intellicode.ai.explain')return aiExplainSelection();
    if(id==='intellicode.ai.fix')return aiFixSelection();
    if(id==='intellicode.ai.inline'){
      aiInlineEnabled=!aiInlineEnabled;
      try{localStorage.setItem('axiom.intellicode.aiInline',aiInlineEnabled?'1':'0');}catch{}
      host?.status?.('Axiom IntelliCode IA inline: '+(aiInlineEnabled?'activada':'desactivada'));
      return status();
    }
    if(id==='intellicode.ai.diagnostics'){
      const d=aiLastDiagnostic||ensureAiClient().lastDiagnostic;
      if(!d){
        host?.info?.('Axiom IntelliCode IA · Diagnóstico','<p>No hay una solicitud de IA registrada todavía.</p>');
        return null;
      }
      const value=v=>v===null||v===undefined||v===''?'No disponible':htmlEscape(v);
      const usage=d.usage||{};
      host?.info?.('Axiom IntelliCode IA · Diagnóstico',
        '<p>Modelo: <b>'+value(d.model)+'</b></p>'+
        '<p>HTTP: '+value(d.status)+' · tiempo: '+value(d.responseTimeMs)+' ms</p>'+
        '<p>Restantes: '+value(d.remaining)+' · límite: '+value(d.rateLimit)+' · reinicio: '+value(d.reset)+'</p>'+
        '<p>Política: '+value(d.policy)+' · intervalo local: '+value(d.localIntervalSeconds)+' s</p>'+
        '<p>Request ID: '+value(d.requestId)+'</p>'+
        '<p>Tokens: prompt '+value(usage.prompt_tokens)+' · completion '+value(usage.completion_tokens)+' · total '+value(usage.total_tokens)+'</p>'
      );
      return d;
    }
    if(id==='intellicode.ai.clearKey'){
      setAiKey('');
      aiModels=[];
      aiModel='';
      aiInlineEnabled=false;
      aiLastDiagnostic=null;
      if(aiClient)aiClient.lastDiagnostic=null;
      host?.status?.('Axiom IntelliCode IA: API key eliminada de la sesión');
      return status();
    }
    throw new Error('Comando no reconocido: '+id);
  }

  return {
    LocalIntelliEngine,VictorsAIClient,tokenise,languageFromPath,fuzzyMatch,
    chooseVictorsModel,stripCodeFence,diagnosticFromResponse,parseRateWaitMs,
    activate,deactivate,rebuild,status,runCommand,version:VERSION
  };
});
