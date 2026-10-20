// 本地演示数据层。没有云同步，也不是正式权限系统。
const NOTES_KEY = 'xz7_notes_v01';
const PREVIEW_KEY = 'xz7_admin_preview_v01';
const FAV_KEY = 'xz7_favorites_v01';
const HISTORY_KEY = 'xz7_history_v01';
const seed = [
  {
    id: 'demo-and', title: 'Java基础｜短路与 &&', category: 'Java基础', status: 'published', createdAt: Date.now()-86400000, updatedAt: Date.now()-3600000,
    blocks: [
      { uid: 'a1', type: 'text', content: '&& 是短路与运算符。只有左右两个条件都为 true，整体才为 true。如果左边是 false，右边不会再执行。' },
      { uid: 'a2', type: 'code', content: 'int a = 10;\nif (a > 20 && ++a < 100) {\n    System.out.println("OK");\n}\nSystem.out.println(a); // 10' },
      { uid: 'a3', type: 'text', content: '易错点：右侧 ++a 没有执行，a 仍然是 10。' }
    ]
  },
  {
    id: 'demo-if', title: 'Java基础｜if 条件判断', category: 'Java基础', status: 'published', createdAt: Date.now()-172800000, updatedAt: Date.now()-75000000,
    blocks: [
      { uid: 'b1', type: 'text', content: 'if 用来判断条件是否成立。条件为 true 时执行对应代码块，else if 用于多条件判断，else 用于处理其他情况。' },
      { uid: 'b2', type: 'code', content: 'int score = 85;\nif (score >= 90) {\n    System.out.println("优秀");\n} else if (score >= 60) {\n    System.out.println("及格");\n} else {\n    System.out.println("继续加油");\n}' }
    ]
  },
  {
    id: 'demo-types', title: 'Java基础｜数据类型与变量', category: 'Java基础', status: 'published', createdAt: Date.now()-259200000, updatedAt: Date.now()-172800000,
    blocks: [
      { uid: 'c1', type: 'text', content: 'Java 有 byte、short、int、long、float、double、char、boolean 八种基本数据类型。变量需要先声明类型，再赋值使用。' },
      { uid: 'c2', type: 'code', content: 'int age = 18;\ndouble price = 9.9;\nboolean passed = true;\nchar grade = \'A\';' }
    ]
  },
  {
    id: 'demo-draft', title: '下一篇：数组基础（示例草稿）', category: 'Java基础', status: 'draft', createdAt: Date.now()-4000000, updatedAt: Date.now()-4000000,
    blocks: [{ uid: 'd1', type: 'text', content: '这是草稿示例，访客预览时不会显示。' }]
  }
];
function read(key, fallback) { try { const value=wx.getStorageSync(key); return value === '' || value === undefined ? fallback : value; } catch(e) { return fallback; } }
function write(key, value) { wx.setStorageSync(key,value); }
function initialize() {
  if (!read(NOTES_KEY,null)) write(NOTES_KEY,seed);
  if (read(PREVIEW_KEY,null)===null) write(PREVIEW_KEY,true);
  if (!read(FAV_KEY,null)) write(FAV_KEY,[]);
  if (!read(HISTORY_KEY,null)) write(HISTORY_KEY,[]);
}
function isAdminPreview() { return !!read(PREVIEW_KEY,true); }
function setAdminPreview(v) { write(PREVIEW_KEY,!!v); }
function allNotes() { initialize(); return read(NOTES_KEY,[]).slice().sort((a,b)=>b.updatedAt-a.updatedAt); }
function visibleNotes() { return allNotes().filter(n=>n.status==='published'||isAdminPreview()); }
function publishedNotes() { return allNotes().filter(n=>n.status==='published'); }
function noteById(id) { return allNotes().find(n=>n.id===id) || null; }
function firstText(n) { const b=(n.blocks||[]).find(x=>x.type==='text'); return b ? b.content : (n.blocks||[]).find(x=>x.type==='code')?.content || '图文记录'; }
function summary(n) { const text=firstText(n).replace(/\s+/g,' '); return text.length>60 ? text.slice(0,60)+'…' : text; }
function formatDate(t) { const d=new Date(t); const now=new Date(); const day=d.toDateString()===now.toDateString()?'今天':`${d.getMonth()+1}月${d.getDate()}日`; return `${day} ${('0'+d.getHours()).slice(-2)}:${('0'+d.getMinutes()).slice(-2)}`; }
function decorate(n) { return {...n, summary:summary(n), dateLabel:formatDate(n.updatedAt), hasImage:(n.blocks||[]).some(b=>b.type==='image'), hasCode:(n.blocks||[]).some(b=>b.type==='code'), isFavorite:isFavorite(n.id)}; }
function decoratedNotes(notes) {return notes.map(decorate);}
function saveNote(note) {
  if (!isAdminPreview()) throw new Error('当前是访客预览模式');
  const notes=allNotes(); const now=Date.now();
  const fresh={...note, id:note.id || 'n'+now+'_'+Math.floor(Math.random()*99999), createdAt:note.createdAt||now,updatedAt:now};
  const index=notes.findIndex(x=>x.id===fresh.id);
  if (index>=0) notes[index]=fresh; else notes.unshift(fresh);
  write(NOTES_KEY,notes);return fresh;
}
function deleteNote(id) {if (!isAdminPreview()) return;write(NOTES_KEY,allNotes().filter(x=>x.id!==id));write(FAV_KEY,favorites().filter(x=>x!==id));}
function favorites() {return read(FAV_KEY,[]);}
function isFavorite(id) {return favorites().includes(id);}
function toggleFavorite(id) {const f=favorites(); const next=f.includes(id)?f.filter(x=>x!==id):[id,...f]; write(FAV_KEY,next);return next.includes(id);}
function favoritesNotes() {return visibleNotes().filter(n=>isFavorite(n.id));}
function categories() { const all=visibleNotes(); const names=[...new Set(all.map(n=>n.category||'未分类'))];return names.map(name=>({name,count:all.filter(x=>(x.category||'未分类')===name).length})); }
function recordHistory(id) {const list=read(HISTORY_KEY,[]).filter(x=>x!==id);list.unshift(id);write(HISTORY_KEY,list.slice(0,30));}
function historyIds(){return read(HISTORY_KEY,[]);}
function historyNotes(){const ids=read(HISTORY_KEY,[]);const list=visibleNotes();return ids.map(id=>list.find(n=>n.id===id)).filter(Boolean);}
function toMarkdown(notes) {return notes.map(n=>{let result=`# ${n.title}\n\n分类：${n.category}  状态：${n.status==='published'?'已发布':'草稿'}\n\n`; (n.blocks||[]).forEach(b=>{if(b.type==='text')result+=b.content+'\n\n';if(b.type==='code')result+='```java\n'+b.content+'\n```\n\n';if(b.type==='image')result+='[图片：需从原设备单独备份]\n\n';});return result;}).join('\n---\n\n');}
// 完整备份恢复：按 ID 合并笔记，不清空已有数据，更新在最后一次写入成功后生效。
function mergeImportedNotes(incoming) {
  if (!isAdminPreview()) throw new Error('访客预览不可恢复数据');
  if (!Array.isArray(incoming)) throw new Error('导入数据格式错误');
  const original = allNotes();
  const map = new Map(original.map(x => [x.id, x]));
  for (const item of incoming) map.set(item.id, item);
  const next = Array.from(map.values()).sort((a,b)=>b.updatedAt-a.updatedAt);
  write(NOTES_KEY,next);
  return incoming.length;
}
module.exports={mergeImportedNotes,initialize,isAdminPreview,setAdminPreview,allNotes,visibleNotes,publishedNotes,noteById,decorate,decoratedNotes,saveNote,deleteNote,favorites,isFavorite,toggleFavorite,favoritesNotes,categories,historyNotes,historyIds,recordHistory,toMarkdown};
