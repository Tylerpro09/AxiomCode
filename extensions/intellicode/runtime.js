(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.AxiomIntelliCode=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';

  const VERSION='1.1.0';
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
      if(ctx.length>=3)add(topBucket(this.three,ctx.slice(-3).join('\u0000'),prefix,limit*3),80,'context-3');
      if(ctx.length>=2)add(topBucket(this.two,ctx.slice(-2).join('\u0000'),prefix,limit*3),48,'context-2');
      if(ctx.length>=1)add(topBucket(this.one,ctx[ctx.length-1],prefix,limit*3),26,'context-1');
      if(memberMode){
        if(receiver)add(topBucket(this.memberByReceiver,receiver,prefix,limit*4),70,'member-receiver');
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
      return topBucket(this.lineTransitions,language+'\u0000'+String(previousLine||'').trim().slice(-160),'',limit);
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

  function memoryProfile(){
    let memory=8;
    try{memory=Number(navigator.deviceMemory||8)||8;}catch{}
    if(memory<=4)return {name:'ligero',files:28,bytes:1536*1024,fileBytes:192*1024,concurrency:2};
    if(memory>=12)return {name:'alto',files:96,bytes:6*1024*1024,fileBytes:512*1024,concurrency:5};
    return {name:'equilibrado',files:64,bytes:4*1024*1024,fileBytes:384*1024,concurrency:4};
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
  function workspaceFiles(tree){
    const out=[];
    const walk=nodes=>{
      for(const node of (nodes||[])){
        if(node.type==='dir'){
          if(SKIP_DIRS.has(String(node.name||'').toLowerCase()))continue;
          walk(node.children||[]);
        }else if(node.type==='file'){
          const language=languageFromPath(node.path||node.name);
          if(language&&SUPPORTED.includes(language))out.push({path:node.path,name:node.name,language});
        }
      }
    };
    walk(tree||[]);
    return out;
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
    return liveEngine.rebuild(supportedModels());
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
        const rows=mergeRows(projectRows,liveRows,20);
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
      provideInlineCompletions(model,position,_context,cancelToken){
        if(!enabled||cancelToken?.isCancellationRequested)return {items:[]};
        const lineBefore=model.getLineContent(position.lineNumber).slice(0,position.column-1);
        if(looksLikeComment(lineBefore,language))return {items:[]};
        const trimmed=lineBefore.trim();
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
        if(!best||best.value.length<=prefix.length||!best.value.toLowerCase().startsWith(prefix.toLowerCase()))return {items:[]};
        return {items:[{
          insertText:best.value.slice(prefix.length),
          range:{
            startLineNumber:position.lineNumber,startColumn:position.column,
            endLineNumber:position.lineNumber,endColumn:position.column
          }
        }]};
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
    try{enabled=localStorage.getItem('axiom.intellicode.enabled')!=='0';}catch{enabled=true;}
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
      if(rootNow&&rootNow!==projectRoot){
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
      project,live,cacheLoaded,memoryProfile:profile.name,
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
        '<p>Perfil de memoria: '+htmlEscape(s.memoryProfile)+' · caché: '+(s.cacheLoaded?'sí':'no')+'</p>'
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
    throw new Error('Comando no reconocido: '+id);
  }

  return {
    LocalIntelliEngine,tokenise,languageFromPath,fuzzyMatch,
    activate,deactivate,rebuild,status,runCommand,version:VERSION
  };
});
