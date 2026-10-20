// 下周七集 V0.2：本地可携带备份。
// JSON 中嵌入图片的 base64 字节，换设备导入时重新生成本地图片文件。
// 与云同步无关；必须在真机验证微信会话文件分享/导入能力。
const store = require('./store');
const FORMAT = 'xiazhouqiji-portable-backup';
const MAX_NOTES = 500;
const MAX_BLOCKS = 100;
const MAX_SINGLE_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 18 * 1024 * 1024;
const MAX_BACKUP_FILE_BYTES = 26 * 1024 * 1024;
function fs() { return wx.getFileSystemManager(); }
function extractExtension(path) {
  const match = String(path || '').toLowerCase().match(/\.(jpg|jpeg|png|webp|gif)(?:\?|$)/);
  return match ? (match[1] === 'jpeg' ? 'jpg' : match[1]) : 'jpg';
}
function formatFor(base64) {
  if (base64.startsWith('iVBORw0KGgo')) return 'png';
  if (base64.startsWith('/9j/')) return 'jpg';
  if (base64.startsWith('R0lGOD')) return 'gif';
  if (base64.startsWith('UklGR')) return 'webp';
  return null;
}
function asPortableBackup(notes) {
  if (!Array.isArray(notes) || notes.length > MAX_NOTES) throw Error('当前笔记过多，无法一次性备份，请分批处理');
  let totalImageBytes = 0;
  const result = notes.map(note => {
    const blocks = (note.blocks || []).map(block => {
      if (block.type !== 'image') return { uid:block.uid, type:block.type, content:String(block.content || '') };
      let buffer;
      try { buffer = fs().readFileSync(block.content); } catch (err) { throw Error('有一张原图已不存在，请先检查笔记：' + note.title); }
      const length = buffer.byteLength || buffer.length || 0;
      if (length > MAX_SINGLE_IMAGE_BYTES) throw Error('图片超过 6MB，请先压缩：' + note.title);
      totalImageBytes += length;
      if (totalImageBytes > MAX_TOTAL_IMAGE_BYTES) throw Error('截图总量超过 18MB，暂时无法一次备份');
      // 不依赖 Buffer（小程序运行时并非 Node.js）
      const data = fs().readFileSync(block.content, 'base64');
      const ext = formatFor(data) || extractExtension(block.content);
      return { uid:block.uid, type:'image', ext, data };
    });
    return { id:note.id, title:note.title, category:note.category, status:note.status,
      createdAt:note.createdAt, updatedAt:note.updatedAt, blocks };
  });
  const backup = { format:FORMAT, version:1, exportedAt:new Date().toISOString(), notes:result };
  const json = JSON.stringify(backup);
  if (json.length > MAX_BACKUP_FILE_BYTES) throw Error('备份文件太大，请先减少图片数量');
  return json;
}
function createExportFile(kind) {
  if (!store.isAdminPreview()) throw Error('访客预览不能导出私人笔记');
  const notes = store.allNotes();
  if (!notes.length) throw Error('没有可导出的笔记');
  const isBackup = kind === 'backup';
  const content = isBackup ? asPortableBackup(notes) : store.toMarkdown(notes);
  const ext = isBackup ? 'json' : 'md';
  const filename = `下周七集_${isBackup?'完整备份':'笔记'}_${Date.now()}.${ext}`;
  const path = `${wx.env.USER_DATA_PATH}/${filename}`;
  fs().writeFileSync(path, content, 'utf8');
  return { filePath:path, fileName:filename, count:notes.length, containsImages:isBackup };
}
function normalizeAndValidate(payload) {
  if (!payload || payload.format !== FORMAT || payload.version !== 1 || !Array.isArray(payload.notes)) {
    throw Error('文件不是「下周七集」V0.2 完整备份');
  }
  if (payload.notes.length > MAX_NOTES) throw Error('备份笔记超过 500 篇');
  let total = 0;
  return payload.notes.map((n, index) => {
    if (!n || typeof n.title !== 'string' || !n.title.trim() || n.title.length > 80 ||
      !Array.isArray(n.blocks) || n.blocks.length > MAX_BLOCKS) throw Error('第 '+(index+1)+' 篇笔记的数据不符合要求');
    const title = n.title.trim();
    const blocks = n.blocks.map((b, i) => {
      if (!b || !['text','code','image'].includes(b.type)) throw Error('发现无法识别的内容块');
      const uid = typeof b.uid === 'string' && b.uid.length < 80 ? b.uid : 'r'+index+'_'+i;
      if (b.type === 'image') {
        if (typeof b.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(b.data)) throw Error('图片备份数据损坏');
        const bytes = Math.floor(b.data.length * 3 / 4) - (b.data.endsWith('==') ? 2 : b.data.endsWith('=') ? 1 : 0);
        if (bytes > MAX_SINGLE_IMAGE_BYTES) throw Error('备份中的图片超过 6MB');
        total += bytes;
        if (total > MAX_TOTAL_IMAGE_BYTES) throw Error('备份中的图片总量超过 18MB');
        const ext = formatFor(b.data);
        if (!ext) throw Error('备份中有无法识别格式的图片');
        return { uid, type:'image', data:b.data, ext };
      }
      if (typeof b.content !== 'string' || b.content.length > 200000) throw Error('笔记正文过长或数据格式错误');
      return { uid, type:b.type, content:b.content };
    });
    const id = (typeof n.id === 'string' && /^[a-zA-Z0-9_-]{1,70}$/.test(n.id)) ? n.id : ('import_'+Date.now()+'_'+index);
    return { id, title, category:(typeof n.category === 'string' ? n.category.slice(0,20) : '未分类'),
      status:n.status === 'published' ? 'published' : 'draft',
      createdAt:Number.isFinite(n.createdAt) ? n.createdAt : Date.now(),
      updatedAt:Number.isFinite(n.updatedAt) ? n.updatedAt : Date.now(), blocks };
  });
}
function inspectBackupFile(filePath, fileSize) {
  if (fileSize > MAX_BACKUP_FILE_BYTES) throw Error('备份文件超过 26MB，无法导入');
  const raw = fs().readFileSync(filePath,'utf8');
  if (raw.length > MAX_BACKUP_FILE_BYTES) throw Error('备份文本过大');
  let payload;
  try { payload = JSON.parse(raw); } catch (err) { throw Error('JSON 文件格式不正确'); }
  return normalizeAndValidate(payload);
}
function restoreNotes(validNotes) {
  if (!store.isAdminPreview()) throw Error('访客预览不能恢复笔记');
  const createdFiles = [];
  try {
    const notes = validNotes.map(note => ({...note, blocks:note.blocks.map(b => {
      if (b.type !== 'image') return b;
      const path = `${wx.env.USER_DATA_PATH}/xz7_restore_${Date.now()}_${createdFiles.length}_${Math.floor(Math.random()*100000)}.${b.ext}`;
      fs().writeFileSync(path, b.data, 'base64');
      createdFiles.push(path);
      return {uid:b.uid,type:'image',content:path};
    })}));
    const count = store.mergeImportedNotes(notes);
    return { imported:count, images:createdFiles.length };
  } catch (err) {
    for (const path of createdFiles) { try { fs().unlinkSync(path); } catch (_) {} }
    throw err;
  }
}
module.exports = {createExportFile,inspectBackupFile,restoreNotes};
