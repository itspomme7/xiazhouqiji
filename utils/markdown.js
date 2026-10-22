// 轻量 Markdown 支持：只解析产品明确支持的语法，不执行 HTML。
const MAX_SOURCE_CHARS=180000;
const MAX_BLOCK_CHARS=24000;
const MAX_BLOCKS=60;

function normalize(value){return String(value||'').replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');}
function trimBlankLines(value){return value.replace(/^\n+|\n+$/g,'');}
function imageLinks(value){return String(value||'').match(/!\[[^\]]*\]\([^)]+\)/g)||[];}
function fenceStart(line){
  const match=/^ {0,3}(`{3,})([^`]*)$/.exec(line);
  if(!match)return null;
  const info=match[2].trim();
  return {length:match[1].length,language:(info.split(/\s+/)[0]||'').toLowerCase()};
}
function fenceEnd(line,fence){
  const match=/^ {0,3}(`{3,})\s*$/.exec(line);
  return Boolean(match&&match[1].length>=fence.length);
}

function splitTextBlock(value){
  const result=[];
  let rest=trimBlankLines(value);
  while(rest.length>MAX_BLOCK_CHARS){
    let cut=rest.lastIndexOf('\n',MAX_BLOCK_CHARS);
    if(cut<Math.floor(MAX_BLOCK_CHARS*0.6))cut=MAX_BLOCK_CHARS;
    result.push(rest.slice(0,cut));
    rest=rest.slice(cut).replace(/^\n+/, '');
  }
  if(rest)result.push(rest);
  return result;
}

function parseInline(value){
  const source=String(value||'');
  const spans=[];
  let index=0;
  const push=(kind,text)=>{if(text)spans.push({kind,value:text,key:spans.length});};
  while(index<source.length){
    if(source.startsWith('**',index)){
      const end=source.indexOf('**',index+2);
      if(end>index+2){push('strong',source.slice(index+2,end));index=end+2;continue;}
    }
    if(source[index]==='`'){
      const end=source.indexOf('`',index+1);
      if(end>index+1){push('code',source.slice(index+1,end));index=end+1;continue;}
    }
    const bold=source.indexOf('**',index+1);
    const code=source.indexOf('`',index+1);
    const candidates=[bold,code].filter(v=>v>=0);
    const next=candidates.length?Math.min(...candidates):source.length;
    push('text',source.slice(index,next));
    index=next;
  }
  return spans.length?spans:[{kind:'text',value:'',key:0}];
}

function renderText(value){
  const lines=normalize(value).split('\n');
  const rendered=[];
  let paragraph=[];
  const add=(line)=>rendered.push({...line,key:rendered.length});
  const flush=()=>{
    if(!paragraph.length)return;
    add({kind:'paragraph',spans:parseInline(paragraph.join('\n'))});
    paragraph=[];
  };
  for(let i=0;i<lines.length;i++){
    const raw=lines[i];
    const fence=fenceStart(raw);
    if(fence){
      // 围栏内容作为字面文本，绝不将运行结果里的 #、** 或 HTML 当作格式。
      let end=i+1;
      while(end<lines.length&&!fenceEnd(lines[end],fence))end++;
      if(fence.language==='text'&&end<lines.length){
        flush();
        add({kind:'output',spans:[{kind:'text',value:lines.slice(i+1,end).join('\n'),key:0}]});
      }else paragraph.push(...lines.slice(i,Math.min(end+1,lines.length)));
      i=end;
      continue;
    }
    const heading=/^(#{1,3})\s+(.+?)\s*$/.exec(raw);
    const unordered=/^\s*[-+*]\s+(.+)$/.exec(raw);
    const ordered=/^\s*(\d+)[.)]\s+(.+)$/.exec(raw);
    if(!raw.trim()){flush();continue;}
    if(heading){flush();add({kind:'heading',level:heading[1].length,spans:parseInline(heading[2])});continue;}
    if(unordered){flush();add({kind:'list',marker:'•',ordered:false,spans:parseInline(unordered[1])});continue;}
    if(ordered){flush();add({kind:'list',marker:ordered[1]+'.',ordered:true,spans:parseInline(ordered[2])});continue;}
    paragraph.push(raw);
  }
  flush();
  return rendered;
}

function parseImport(value,options={}){
  const source=normalize(value);
  if(!source.trim())throw Error('请先粘贴 Markdown 内容');
  if(source.length>MAX_SOURCE_CHARS)throw Error('Markdown 内容过长，请拆分后导入');
  const lines=source.split('\n');
  let title='';
  if(options.useFirstHeadingAsTitle!==false){
    const first=/^#\s+(.+?)\s*$/.exec(lines[0]||'');
    if(first){
      title=parseInline(first[1]).map(span=>span.value).join('').trim();
      if(title.length>80)throw Error('Markdown 一级标题超过 80 个字');
      lines.shift();
    }
  }
  const blocks=[];
  let text=[];
  const flushText=()=>{
    const value=trimBlankLines(text.join('\n'));
    text=[];
    for(const content of splitTextBlock(value))blocks.push({type:'text',content});
  };
  for(let i=0;i<lines.length;i++){
    const fence=fenceStart(lines[i]);
    if(fence){
      const opening=lines[i];
      flushText();
      const code=[];
      let closed=false;
      for(i=i+1;i<lines.length;i++){
        if(fenceEnd(lines[i],fence)){closed=true;break;}
        code.push(lines[i]);
      }
      if(!closed)throw Error('代码块缺少结束的反引号围栏');
      const content=code.join('\n');
      if(fence.language==='java'){
        if(!content.trim())throw Error('Java 代码块不能为空');
        if(content.length>25000)throw Error('单个 Java 代码块超过 25000 个字符，请拆分后导入');
        blocks.push({type:'code',content});
      }else{
        const literal=[opening,...code,lines[i]].join('\n');
        if(literal.length>MAX_BLOCK_CHARS)throw Error('单个文本围栏超过 24000 个字符，请拆分后导入');
        blocks.push({type:'text',content:literal});
      }
    }else text.push(lines[i]);
  }
  flushText();
  if(!blocks.length)throw Error('Markdown 中没有可导入的正文或代码');
  if(blocks.length>MAX_BLOCKS)throw Error('导入后内容块超过 60 个，请拆分文章');
  const links=blocks.filter(b=>b.type==='text').flatMap(b=>imageLinks(b.content));
  const rendered=blocks.filter(b=>b.type==='text').flatMap(b=>renderText(b.content));
  return {
    title,blocks,imageLinks:links,
    stats:{
      textBlocks:blocks.filter(b=>b.type==='text').length,
      codeBlocks:blocks.filter(b=>b.type==='code').length,
      headings:rendered.filter(x=>x.kind==='heading').length,
      lists:rendered.filter(x=>x.kind==='list').length,
      strong:rendered.reduce((n,x)=>n+x.spans.filter(s=>s.kind==='strong').length,0),
      inlineCode:rendered.reduce((n,x)=>n+x.spans.filter(s=>s.kind==='code').length,0)
    }
  };
}

// 复制 Markdown 只导出文字与云文件引用，不替代完整图文备份。
function noteToMarkdown(note){
  let result=`# ${String(note&&note.title||'').trim()}\n\n分类：${String(note&&note.category||'未分类')}\n\n`;
  for(const block of (note&&note.blocks)||[]){
    if(block.type==='text')result+=String(block.content||'')+'\n\n';
    if(block.type==='code')result+='```java\n'+String(block.content||'')+'\n```\n\n';
    if(block.type==='image')result+='[云端学习截图：'+String(block.content||'')+']\n\n';
  }
  return result;
}

module.exports={parseImport,renderText,parseInline,imageLinks,noteToMarkdown};
