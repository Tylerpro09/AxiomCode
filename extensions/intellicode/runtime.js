(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.AxiomIntelliCode=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';

  const MAX_MODEL_BYTES=384*1024;
  const MAX_TOTAL_BYTES=2*1024*1024;
  const MAX_CONTEXTS=20000;
  const MAX_SYMBOLS=12000;
  const SUPPORTED=[
    'javascript','typescript','python','java','c','cpp','csharp','go','rust',
    'php','html','css','scss','json','sql','shell','powershell','lua'
  ];
  const STOP=new Set([
    'true','false','null','undefined','none','this','self','return','break','continue',
    'const','let','var','function','class','def','if','else','for','while','switch',
    'case','try','catch','finally','import','from','export','public','private','protected',
    'static','void','new','in','of','and','or','not','async','await'
  ]);

  const TEMPLATES={
    javascript:[
      ['for','for…of','for (const item of items) {\n\t$0\n}'],
      ['fun','function','function name(args) {\n\t$0\n}'],
      ['asy','async function','async function name(args) {\n\t$0\n}'],
      ['try','try/catch','try {\n\t$0\n} catch (error) {\n\tconsole.error(error);\n}'],
      ['con','console.log','console.log($0);']
    ],
    typescript:[
      ['for','for…of','for (const item of items) {\n\t$0\n}'],
      ['fun','typed function','function name(args: unknown): void {\n\t$0\n}'],
      ['asy','async function','async function name(args: unknown): Promise<void> {\n\t$0\n}'],
      ['int','interface','interface Name {\n\t$0\n}'],
      ['try','try/catch','try {\n\t$0\n} catch (error) {\n\tconsole.error(error);\n}']
    ],
    python:[
      ['def','def function','def function_name(args):\n    $0'],
      ['asy','async def','async def function_name(args):\n    $0'],
      ['for','for loop','for item in items:\n    $0'],
      ['try','try/except','try:\n    $0\nexcept Exception as exc:\n    print(exc)'],
      ['wit','with open','with open(path, "r", encoding="utf-8") as file:\n    $0']
    ],
    java:[
      ['cla','class','public class Name {\n\t$0\n}'],
      ['mai','main','public static void main(String[] args) {\n\t$0\n}'],
      ['for','for-each','for (var item : items) {\n\t$0\n}'],
      ['try','try/catch','try {\n\t$0\n} catch (Exception exception) {\n\texception.printStackTrace();\n}']
    ],
    c:[['mai','main','int main(void) {\n\t$0\n\treturn 0;\n}'],['for','for loop','for (int i = 0; i < count; ++i) {\n\t$0\n}']],
    cpp:[['mai','main','int main() {\n\t$0\n\treturn 0;\n}'],['for','range for','for (const auto& item : items) {\n\t$0\n}']],
    csharp:[['cla','class','public class Name\n{\n\t$0\n}'],['for','foreach','foreach (var item in items)\n{\n\t$0\n}'],['asy','async Task','async Task MethodAsync()\n{\n\t$0\n}']],
    go:[['mai','main','func main() {\n\t$0\n}'],['fun','func','func name(args) {\n\t$0\n}'],['for','for range','for _, item := range items {\n\t$0\n}']],
    rust:[['mai','main','fn main() {\n\t$0\n}'],['fun','fn','fn name() {\n\t$0\n}'],['mat','match','match value {\n\tpattern => $0,\n}']],
    php:[['fun','function','function name($args) {\n\t$0\n}'],['for','foreach','foreach ($items as $item) {\n\t$0\n}']],
    html:[['htm','HTML document','<!doctype html>\n<html lang="en">\n<head>\n\t<meta charset="utf-8">\n\t<meta name="viewport" content="width=device-width, initial-scale=1">\n\t<title>$0</title>\n</head>\n<body>\n\n</body>\n</html>']],
    css:[['med','media query','@media (max-width: 768px) {\n\t$0\n}'],['gri','grid','display: grid;\ngrid-template-columns: repeat(auto-fit, minmax(220px, 1fr));\ngap: 1rem;']],
    scss:[['med','media query','@media (max-width: 768px) {\n\t$0\n}']],
    json:[['obj','object','{\n\t"key": "$0"\n}']],
    sql:[['sel','SELECT','SELECT *\nFROM table_name\nWHERE $0;'],['ins','INSERT','INSERT INTO table_name (column)\nVALUES ($0);']],
    shell:[['if','if','if [ condition ]; then\n\t$0\nfi'],['for','for','for item in items; do\n\t$0\ndone']],
    powershell:[['for','foreach','foreach ($item in $items) {\n\t$0\n}'],['try','try/catch','try {\n\t$0\n} catch {\n\tWrite-Error $_\n}']],
    lua:[['fun','function','function name(args)\n\t$0\nend'],['for','for ipairs','for i, item in ipairs(items) do\n\t$0\nend']]
  };

  function tokenise(text){
    return String(text||'').match(/[A-Za-z_$][A-Za-z0-9_$]*|\d+(?:\.\d+)?|=>|===|!==|==|!=|<=|>=|\+\+|--|&&|\|\||[{}()[\].,:;+\-*\/%=<>!?]/g)||[];
  }
  function bump(map,key,value,weight=1,max=MAX_CONTEXTS){
    if(!key||!value)return;
    let bucket=map.get(key);
    if(!bucket){
      if(map.size>=max)return;
      bucket=new Map();map.set(key,bucket);
    }
    bucket.set(value,(bucket.get(value)||0)+weight);
  }
  function top(bucket,prefix='',limit=8){
    if(!bucket)return [];
    const low=String(prefix||'').toLowerCase();
    return [...bucket.entries()]
      .filter(([value])=>!low||String(value).toLowerCase().startsWith(low))
      .sort((a,b)=>b[1]-a[1]||String(a[0]).localeCompare(String(b[0])))
      .slice(0,limit)
      .map(([value,score])=>({value,score}));
  }

  class LocalIntelliEngine{
    constructor(){this.reset();}
    reset(){
      this.one=new Map();this.two=new Map();this.symbols=new Map();this.lines=new Map();
      this.stats={models:0,bytes:0,tokens:0,contexts:0,symbols:0,rebuilds:(this.stats?.rebuilds||0)};
    }
    learnText(text,language='plaintext'){
      if(typeof text!=='string'||!text)return;
      let sample=text;
      if(sample.length>MAX_MODEL_BYTES)sample=sample.slice(sample.length-MAX_MODEL_BYTES);
      const remaining=Math.max(0,MAX_TOTAL_BYTES-this.stats.bytes);
      if(!remaining)return;
      if(sample.length>remaining)sample=sample.slice(sample.length-remaining);
      this.stats.models++;this.stats.bytes+=sample.length;
      const tokens=tokenise(sample);
      this.stats.tokens+=tokens.length;
      for(let i=0;i<tokens.length;i++){
        const value=tokens[i];
        if(/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value)&&value.length>1&&!STOP.has(value.toLowerCase())){
          if(this.symbols.has(value)||this.symbols.size<MAX_SYMBOLS)this.symbols.set(value,(this.symbols.get(value)||0)+1);
        }
        if(i>0)bump(this.one,tokens[i-1],value,1);
        if(i>1)bump(this.two,tokens[i-2]+'\u0000'+tokens[i-1],value,3);
      }
      const lines=sample.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
      for(let i=1;i<lines.length;i++){
        const prev=lines[i-1].slice(-160),next=lines[i].slice(0,180);
        if(prev&&next&&prev!==next)bump(this.lines,prev,next,1,6000);
      }
      this.stats.contexts=this.one.size+this.two.size+this.lines.size;
      this.stats.symbols=this.symbols.size;
      void language;
    }
    rebuild(models){
      const rebuilds=(this.stats?.rebuilds||0)+1;
      this.reset();this.stats.rebuilds=rebuilds;
      let total=0;
      for(const model of (models||[]).slice(0,16)){
        let value='';
        try{value=model.getValue();}catch{continue;}
        if(total>=MAX_TOTAL_BYTES)break;
        if(value.length+total>MAX_TOTAL_BYTES)value=value.slice(0,MAX_TOTAL_BYTES-total);
        total+=value.length;
        let language='plaintext';try{language=model.getLanguageId();}catch{}
        this.learnText(value,language);
      }
      return this.status();
    }
    suggestTokens(contextTokens,prefix='',limit=8){
      const ctx=Array.isArray(contextTokens)?contextTokens:[];
      const scored=new Map();
      const add=(rows,bonus)=>rows.forEach(row=>scored.set(row.value,Math.max(scored.get(row.value)||0,row.score+bonus)));
      if(ctx.length>=2)add(top(this.two,ctx.slice(-2).join('\u0000'),prefix,limit*2),12);
      if(ctx.length>=1)add(top(this.one,ctx[ctx.length-1],prefix,limit*2),5);
      add(top(this.symbols,prefix,limit*3),0);
      return [...scored.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,limit).map(([value,score])=>({value,score}));
    }
    suggestLine(previousLine,limit=3){return top(this.lines,String(previousLine||'').trim().slice(-160),'',limit);}
    status(){return {...this.stats};}
  }

  let active=false,host=null,engine=new LocalIntelliEngine(),disposables=[],modelListeners=new Map(),timer=null;

  function disposeAll(){
    clearTimeout(timer);timer=null;
    for(const d of disposables.splice(0)){try{d.dispose();}catch{}}
    for(const d of modelListeners.values()){try{d.dispose();}catch{}}
    modelListeners.clear();
  }
  function scheduleRebuild(delay=260){
    clearTimeout(timer);
    timer=setTimeout(()=>{
      if(!active||!host)return;
      const models=(host.getModels?host.getModels():host.monaco.editor.getModels()).filter(m=>SUPPORTED.includes(m.getLanguageId()));
      const stats=engine.rebuild(models);
      host.log?.('Axiom IntelliCode: modelo local actualizado · '+stats.tokens+' tokens · '+stats.symbols+' símbolos');
    },delay);
  }
  function watchModel(model){
    if(!model||modelListeners.has(model.uri?.toString?.()||model.id))return;
    const key=model.uri?.toString?.()||String(Math.random());
    try{modelListeners.set(key,model.onDidChangeContent(()=>scheduleRebuild()));}catch{}
  }
  function completionProvider(language){
    return {
      triggerCharacters:['.','_','$'],
      provideCompletionItems(model,position){
        const word=model.getWordUntilPosition(position);
        const prefix=word.word||'';
        const before=model.getValueInRange({
          startLineNumber:Math.max(1,position.lineNumber-3),startColumn:1,
          endLineNumber:position.lineNumber,endColumn:word.startColumn
        });
        const context=tokenise(before);
        const range={
          startLineNumber:position.lineNumber,startColumn:word.startColumn,
          endLineNumber:position.lineNumber,endColumn:position.column
        };
        const suggestions=[];
        const seen=new Set();
        for(const row of engine.suggestTokens(context,prefix,12)){
          if(!row.value||seen.has(row.value)||row.value===prefix)continue;
          seen.add(row.value);
          suggestions.push({
            label:row.value,
            kind:host.monaco.languages.CompletionItemKind.Variable,
            insertText:row.value,
            detail:'Axiom IntelliCode · aprendido localmente',
            sortText:String(999999-Math.min(999998,row.score)).padStart(6,'0'),
            range
          });
        }
        for(const template of (TEMPLATES[language]||[])){
          const [key,label,insert]=template;
          if(prefix&&!key.startsWith(prefix.toLowerCase())&&!label.toLowerCase().startsWith(prefix.toLowerCase()))continue;
          suggestions.push({
            label,
            kind:host.monaco.languages.CompletionItemKind.Snippet,
            insertText:insert,
            insertTextRules:host.monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            detail:'Axiom IntelliCode · plantilla '+language,
            sortText:'zz-'+label,
            range
          });
        }
        return {suggestions:suggestions.slice(0,24)};
      }
    };
  }
  function inlineProvider(){
    return {
      provideInlineCompletions(model,position){
        const word=model.getWordUntilPosition(position);
        const prefix=word.word||'';
        if(prefix.length<2)return {items:[]};
        const before=model.getValueInRange({
          startLineNumber:Math.max(1,position.lineNumber-3),startColumn:1,
          endLineNumber:position.lineNumber,endColumn:word.startColumn
        });
        const context=tokenise(before);
        const best=engine.suggestTokens(context,prefix,1)[0];
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

  function activate(nextHost){
    if(!nextHost?.monaco||!nextHost?.editor)throw new Error('Axiom IntelliCode necesita Monaco y el editor activo');
    disposeAll();host=nextHost;active=true;engine=new LocalIntelliEngine();
    for(const language of SUPPORTED){
      disposables.push(host.monaco.languages.registerCompletionItemProvider(language,completionProvider(language)));
      if(typeof host.monaco.languages.registerInlineCompletionsProvider==='function'){
        disposables.push(host.monaco.languages.registerInlineCompletionsProvider(language,inlineProvider()));
      }
    }
    const models=host.getModels?host.getModels():host.monaco.editor.getModels();
    for(const model of models)watchModel(model);
    if(typeof host.monaco.editor.onDidCreateModel==='function')disposables.push(host.monaco.editor.onDidCreateModel(model=>{watchModel(model);scheduleRebuild(50);}));
    scheduleRebuild(0);
    return status();
  }
  function deactivate(){active=false;disposeAll();host=null;engine=new LocalIntelliEngine();return true;}
  function rebuild(){if(!active||!host)return status();return engine.rebuild(host.getModels?host.getModels():host.monaco.editor.getModels());}
  function status(){return {active,supportedLanguages:[...SUPPORTED],...engine.status(),cloud:false,telemetry:false};}

  return {LocalIntelliEngine,tokenise,activate,deactivate,rebuild,status,version:'1.0.0'};
});
