const assert=require('assert');
const markdown=require('../utils/markdown');

function run(){
  const source=[
    '# **Java** 条件判断',
    '',
    '普通正文包含 **重点说明** 和 `score >= 60`。',
    '',
    '## 使用步骤',
    '- 读取分数',
    '- 判断区间',
    '1. 先处理优秀',
    '2. 再处理及格',
    '',
    '![示例截图](https://example.test/java.png)',
    '',
    '```java',
    'public class Main {',
    '\tpublic static void main(String[] args) {',
    '        System.out.println("OK");',
    '\t}',
    '}',
    '```',
    '',
    '### 易错点',
    '<script>alert("不能执行")</script>'
  ].join('\n');
  const parsed=markdown.parseImport(source,{useFirstHeadingAsTitle:true});
  assert.strictEqual(parsed.title,'Java 条件判断');
  assert.strictEqual(parsed.blocks.filter(b=>b.type==='code').length,1);
  assert.strictEqual(parsed.blocks.find(b=>b.type==='code').content,'public class Main {\n\tpublic static void main(String[] args) {\n        System.out.println("OK");\n\t}\n}');
  assert.strictEqual(parsed.imageLinks.length,1,'Markdown 图片链接必须被识别并提示');
  assert(parsed.stats.headings>=2&&parsed.stats.lists===4&&parsed.stats.strong===1&&parsed.stats.inlineCode===1);

  const lines=parsed.blocks.filter(b=>b.type==='text').flatMap(b=>markdown.renderText(b.content));
  assert(lines.some(x=>x.kind==='heading'&&x.level===2));
  assert(lines.some(x=>x.kind==='heading'&&x.level===3));
  assert(lines.some(x=>x.kind==='list'&&x.marker==='•'));
  assert(lines.some(x=>x.kind==='list'&&x.marker==='1.'));
  assert(lines.some(x=>x.spans.some(s=>s.kind==='strong'&&s.value==='重点说明')));
  assert(lines.some(x=>x.spans.some(s=>s.kind==='code'&&s.value==='score >= 60')));
  assert(lines.some(x=>x.spans.some(s=>s.value.includes('<script>'))),'HTML 必须作为普通文字保留，不能执行');
  assert(lines.every(x=>!Object.prototype.hasOwnProperty.call(x,'html')),'渲染模型不得生成可执行 HTML');
  const exported=markdown.noteToMarkdown({title:parsed.title,category:'Java基础',blocks:parsed.blocks});
  assert(exported.startsWith('# Java 条件判断\n\n'));
  assert(exported.includes('**重点说明**')&&exported.includes('```java\npublic class Main {'),'再次复制 Markdown 必须保留正文格式和 Java 围栏');

  const keptHeading=markdown.parseImport('# 不覆盖已有标题\n\n正文',{useFirstHeadingAsTitle:false});
  assert.strictEqual(keptHeading.title,'');
  const firstLine=markdown.renderText(keptHeading.blocks[0].content)[0];
  assert.strictEqual(firstLine.kind,'heading');assert.strictEqual(firstLine.level,1);

  const otherFence=markdown.parseImport('```javascript\nalert(1)\n```');
  assert.strictEqual(otherFence.blocks.length,1);assert.strictEqual(otherFence.blocks[0].type,'text','只有 Java 围栏转换为原生代码块');
  const legacy=markdown.renderText('旧笔记第一行\n旧笔记第二行');
  assert.strictEqual(legacy.length,1);assert.strictEqual(legacy[0].kind,'paragraph');
  assert.strictEqual(legacy[0].spans.map(s=>s.value).join(''),'旧笔记第一行\n旧笔记第二行','旧文字块必须原样显示');
  assert.throws(()=>markdown.parseImport('```java\nint n = 1;'),/缺少结束/);
  assert.throws(()=>markdown.parseImport(''),/请先粘贴/);
  for(const info of ['java id="example-1"','java title="Main.java"','JAVA id="a" title="Main.java"']){
    const imported=markdown.parseImport('```'+info+'\r\n\tint n = 1;\r\n    System.out.println(n);\r\n```');
    assert.deepStrictEqual(imported.blocks,[{type:'code',content:'\tint n = 1;\n    System.out.println(n);'}]);
  }
  const output='  result = 42\n\n# literal heading\n**literal bold**\n`literal code`\n<script>alert(1)</script>';
  const mixed=markdown.parseImport('# 示例\n\n说明\n\n```java title="Main.java"\n    System.out.println(42);\n```\n\n```text id="result"\n'+output+'\n```\n\n后文');
  assert.deepStrictEqual(mixed.blocks.map(b=>b.type),['text','code','text','text']);
  const outputBlock=mixed.blocks[2];
  const outputView=markdown.renderText(outputBlock.content);
  assert.strictEqual(outputView.length,1);
  assert.strictEqual(outputView[0].kind,'output');
  assert.deepStrictEqual(outputView[0].spans,[{kind:'text',value:output,key:0}],'运行结果不得解析 Markdown 或 HTML，缩进与空行必须保留');
  const copied=markdown.noteToMarkdown({title:mixed.title,category:'Java',blocks:mixed.blocks});
  const reimported=markdown.parseImport(copied);
  assert.deepStrictEqual(reimported.blocks.filter(b=>b.type==='code'),mixed.blocks.filter(b=>b.type==='code'));
  assert.strictEqual(reimported.blocks.find(b=>b.content.startsWith('```text')).content,outputBlock.content);
  assert.strictEqual(markdown.renderText(reimported.blocks.find(b=>b.content.startsWith('```text')).content)[0].spans[0].value,output);
  const nested=markdown.parseImport('````text\n```java title="literal"\n    notJava();\n```\n````');
  assert.strictEqual(nested.blocks.length,1);assert.strictEqual(nested.blocks[0].type,'text');
  assert(markdown.renderText(nested.blocks[0].content)[0].spans[0].value.startsWith('```java'));
  assert.throws(()=>markdown.parseImport('```text\n42'),/缺少结束/);
  assert.throws(()=>markdown.parseImport('```java title="Main.java"\nint n=1;'),/缺少结束/);
  console.log('Markdown 测试通过：标题、粗体、列表、行内代码、Java 缩进、图片提示、旧标题保护及 HTML 安全。');
}
run();
