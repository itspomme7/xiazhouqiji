// 运行：node tests/backup.test.js
// 用微信存储/文件 API 的最小 mock 检查完整备份往返，不替代真机测试。
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(),'xz7-backup-'));
const storage = new Map();
global.wx = {
  env:{USER_DATA_PATH:dir},
  getStorageSync:k=>storage.has(k)?storage.get(k):'',
  setStorageSync:(k,v)=>storage.set(k,v),
  getFileSystemManager:()=>({
    readFileSync:(file,enc)=>fs.readFileSync(file,enc),
    writeFileSync:(file,data,enc)=>fs.writeFileSync(file,data,enc),
    unlinkSync:(file)=>fs.unlinkSync(file)
  })
};
const store=require('../utils/store');
const backup=require('../utils/backup');
try {
  store.initialize();
  assert.strictEqual(store.allNotes().length,4);
  assert(store.visibleNotes().some(x=>x.status==='draft'));
  const png=path.join(dir,'example.png');
  // 1x1 PNG 测试图片
  fs.writeFileSync(png,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==','base64'));
  const item=store.saveNote({title:'测试图文',category:'Java基础',status:'draft',blocks:[{uid:'t1',type:'text',content:'中文笔记'},{uid:'t2',type:'code',content:'int i = 1;'},{uid:'t3',type:'image',content:png}]});
  const exported=backup.createExportFile('backup');
  assert(fs.existsSync(exported.filePath));
  const parsed=JSON.parse(fs.readFileSync(exported.filePath,'utf8'));
  assert.strictEqual(parsed.notes.length,5);
  const imageEntry=parsed.notes.find(n=>n.id===item.id).blocks.find(b=>b.type==='image');
  assert(imageEntry.data.length>30);
  const inspect=backup.inspectBackupFile(exported.filePath,fs.statSync(exported.filePath).size);
  const imageBefore=inspect.find(n=>n.id===item.id).blocks.find(b=>b.type==='image');
  assert.strictEqual(imageBefore.ext,'png');
  const restored=backup.restoreNotes(inspect);
  assert.strictEqual(restored.imported,5);
  assert.strictEqual(restored.images,1);
  assert.strictEqual(store.allNotes().length,5);
  const after=store.noteById(item.id).blocks.find(b=>b.type==='image').content;
  assert(fs.existsSync(after));
  assert(fs.readFileSync(after).equals(fs.readFileSync(png)));
  const md=backup.createExportFile('markdown');
  assert(fs.readFileSync(md.filePath,'utf8').includes('int i = 1;'));
  store.setAdminPreview(false);
  assert.throws(()=>backup.createExportFile('backup'),/访客/);
  assert.throws(()=>backup.restoreNotes(inspect),/访客/);
  assert(!store.visibleNotes().some(n=>n.status==='draft'));
  console.log('PASS：完整备份、原图还原、Markdown 导出、访客演示行为');
} finally { fs.rmSync(dir,{recursive:true,force:true}); }
