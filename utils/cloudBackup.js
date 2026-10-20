// 下周七集 v1.0.0：管理员云端完整图文 JSON 备份/安全恢复。
// 原图以 base64 嵌入 JSON，离开 CloudBase 后也可以恢复。
// 不静默跳过失败的图片；中断时不报告“完整备份成功”。
const cloud = require('./cloudNotes');
const FORMAT = 'xiazhouqiji-cloud-portable';
const VERSION = 1;
const MAX_NOTES = 500;
const MAX_BLOCKS = 60;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_JSON_BYTES = 24 * 1024 * 1024;
const IMAGE_TYPES = ['png', 'jpg', 'gif', 'webp'];
function imageBytes(base64) {
  if (typeof base64 !== 'string' || !base64.length || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 !== 0) throw Error('图片备份数据不完整');
  return base64.length * 3 / 4 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
}
function imageType(base64) {
  if (base64.startsWith('iVBORw0KGgo')) return 'png';
  if (base64.startsWith('/9j/')) return 'jpg';
  if (base64.startsWith('R0lGOD')) return 'gif';
  if (base64.startsWith('UklGR')) return 'webp';
  throw Error('备份里包含不支持的图片格式');
}
function fs() { return wx.getFileSystemManager(); }
function safeString(value, limit) { return typeof value === 'string' && value.length <= limit; }
function normalizeNote(note) {
  if (!note || !safeString(note.id, 90) || !/^[A-Za-z0-9_-]+$/.test(note.id) ||
      !safeString(note.title,80) || !note.title.trim() || !safeString(note.category,30) ||
      !['published','draft'].includes(note.status) || !Array.isArray(note.blocks) ||
      note.blocks.length < 1 || note.blocks.length > MAX_BLOCKS) throw Error('备份笔记格式不正确');
  const blocks = note.blocks.map((b,i) => {
    if (!b || !['image','code','text'].includes(b.type)) throw Error('备份存在不支持的内容块');
    if (!safeString(b.content, b.type === 'image' ? 500 : 25000)) throw Error('内容块超过限制');
    if (b.type === 'image' && !b.content.startsWith('cloud://')) throw Error('图片必须为云存储文件 ID');
    return { uid: safeString(b.uid,60) && /^[-\w]+$/.test(b.uid) ? b.uid : `b${i}`, type:b.type, content:b.content };
  });
  return { id:note.id,title:note.title,category:note.category,status:note.status,
    createdAt:note.createdAt, updatedAt:note.updatedAt, blocks };
}
function assertAdmin() { if (!cloud.role()) throw Error('仅云端管理员可以进行备份和恢复'); }
function progress(fn, current, total, label) { if (typeof fn === 'function') fn({ current, total, label }); }
// 不经云函数传送图片字节：云函数只返回短期 URL，手机自行下载到临时文件。
function promiseDownload(fileID, url) {
  return new Promise((resolve,reject)=>{
    const fallback=()=>{
      if (!url || typeof wx.downloadFile !== 'function') return reject(Error('无法获取原始图片，请检查云存储读取权限'));
      wx.downloadFile({url,success:r=>r.statusCode===200&&r.tempFilePath?resolve(r.tempFilePath):reject(Error('原图下载失败：HTTP '+r.statusCode)),fail:e=>reject(Error('原图下载失败：'+(e.errMsg||'请检查合法域名或网络')))});
    };
    if (wx.cloud && typeof wx.cloud.downloadFile === 'function') {
      wx.cloud.downloadFile({fileID,success:r=>r.tempFilePath?resolve(r.tempFilePath):fallback(),fail:fallback});
    } else fallback();
  });
}
async function readCloudImage(meta) {
  if (!meta || typeof meta.fileID!=='string' || typeof meta.tempFileURL!=='string' ||
      !Number.isSafeInteger(meta.size) || meta.size<1 || meta.size>MAX_IMAGE_BYTES ||
      typeof meta.sha256!=='string' || !/^[0-9a-f]{64}$/.test(meta.sha256)) throw Error('原图元数据无效');
  const path=await promiseDownload(meta.fileID,meta.tempFileURL);
  try {
    const count=fs().statSync(path).size;
    if(count!==meta.size) throw Error('图片下载不完整，大小与云端不一致');
    const base64=fs().readFileSync(path,'base64');
    if(imageBytes(base64)!==meta.size || imageType(base64)!==meta.ext) throw Error('图片内容校验失败');
    return base64;
  } finally {
    // 只清理下载生成的临时文件，不动相册或笔记图片。
    try {fs().unlinkSync(path);}catch(_) {}
  }
}
// Base64 字符数按 4 字符边界拆分，每块解码后 <=192KB。
async function uploadImageInChunks(img) {
  const chunks=[];
  const CHUNK_CHARS=192*1024*4/3;
  let saved=false;
  try {
    for(let i=0;i<img.base64.length;i+=CHUNK_CHARS) {
      const part=await cloud.request('restoreImageChunk',{base64:img.base64.slice(i,i+CHUNK_CHARS)});
      if(typeof part.fileID!=='string'||!part.fileID.startsWith('cloud://')) throw Error('图片分块上传失败');
      chunks.push(part.fileID);
    }
    if(chunks.length>16) throw Error('图片分块数量超限');
    const result=await cloud.request('restoreImageCommit',{parts:chunks,size:img.bytes,sha256:img.sha256});
    if(typeof result.fileID!=='string'||!result.fileID.startsWith('cloud://')) throw Error('云端图片合并失败');
    saved=true;
    return result.fileID;
  } finally {
    if(!saved && chunks.length) {
      try{await cloud.request('restoreImageCleanup',{parts:chunks});}catch(_){}
    }
  }
}

// 完成下载全部原图后才写文件；如果超额/缺图，会整体报错，避免残缺备份。
async function exportCloudBackup(onProgress) {
  const { notes, isAdmin } = await cloud.loadNotes();
  if (!isAdmin) throw Error('云端没有授予管理员身份');
  if (!notes.length) throw Error('当前云端没有笔记可以备份');
  if (notes.length > MAX_NOTES) throw Error('超过 500 篇，请分批导出；没有生成不完整备份');
  const cleanNotes = notes.map(normalizeNote);
  const fileIDs = Array.from(new Set(cleanNotes.flatMap(n => n.blocks.filter(b => b.type === 'image').map(b => b.content))));
  const images = [];
  let totalBytes = 0;
  for (let i=0; i<fileIDs.length; i++) {
    progress(onProgress,i,fileIDs.length,`正在读取原始截图 ${i+1}/${fileIDs.length}`);
    const r = await cloud.request('backupImage',{fileID:fileIDs[i]});
    if (r.fileID !== fileIDs[i]) throw Error('图片 ID 核验失败');
    if (!IMAGE_TYPES.includes(r.ext) || !Number.isSafeInteger(r.size) || r.size < 1 || r.size > MAX_IMAGE_BYTES) throw Error('云端图片格式或大小不正确');
    // 在下载前判断限制，避免传输无谓的大文件。
    if(totalBytes+r.size>MAX_TOTAL_IMAGE_BYTES) throw Error('原图总量超过 16MB，未生成备份，需要分卷备份');
    const base64=await readCloudImage(r);
    const bytes=imageBytes(base64);
    totalBytes+=bytes;
    images.push({fileID:r.fileID,ext:r.ext,bytes,sha256:r.sha256,base64});
  }
  const backupId = 'xz7_'+Date.now()+'_'+Math.random().toString(36).slice(2,13);
  const doc={format:FORMAT,version:VERSION,backupId,exportedAt:new Date().toISOString(),
    notes:cleanNotes,images};
  const json=JSON.stringify(doc);
  // Base64 不包含非 ASCII，粗估的 UTF-8 长度不足以覆盖中文；留余量并用实际 UTF-8 字节数校验。
  if (json.length > MAX_JSON_BYTES) throw Error('备份包太大，未生成不完整文件');
  const fileName=`下周七集_云端完整备份_${Date.now()}.json`;
  const filePath=`${wx.env.USER_DATA_PATH}/${fileName}`;
  progress(onProgress,fileIDs.length,fileIDs.length,'正在写入备份文件');
  fs().writeFileSync(filePath,json,'utf8');
  // 文件落盘后再次读取文件信息，保证完整备份不超额。
  const count = fs().statSync(filePath).size;
  if (count > MAX_JSON_BYTES) { try { fs().unlinkSync(filePath); } catch (_) {} throw Error('备份文件超过 24MB，未保存'); }
  return {filePath,fileName,noteCount:notes.length,imageCount:images.length,bytes:count};
}
function inspectCloudBackup(filePath, fileSize) {
  if (typeof fileSize === 'number' && fileSize > MAX_JSON_BYTES) throw Error('文件超过 24MB，不能导入');
  const raw = fs().readFileSync(filePath,'utf8');
  if (raw.length > MAX_JSON_BYTES) throw Error('文件过大');
  let doc;
  try {doc=JSON.parse(raw);} catch(_) {throw Error('这不是有效的 JSON 备份文件');}
  if (!doc || doc.format !== FORMAT || doc.version !== VERSION ||
      typeof doc.backupId !== 'string' || !/^[-\w]{12,90}$/.test(doc.backupId) ||
      !Array.isArray(doc.notes) || doc.notes.length < 1 || doc.notes.length > MAX_NOTES ||
      !Array.isArray(doc.images)) throw Error('文件不是支持的下周七集云端完整备份');
  const imagesById = new Map();
  let total=0;
  doc.images.forEach(img=>{
    if (!img || !safeString(img.fileID,500) || !img.fileID.startsWith('cloud://') || imagesById.has(img.fileID)) throw Error('图片索引不正确');
    const count=imageBytes(img.base64);
    if (count<1 || count>MAX_IMAGE_BYTES || count!==img.bytes || imageType(img.base64)!==img.ext ||
        typeof img.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(img.sha256)) throw Error('图片格式、大小或校验信息不正确');
    total+=count;
    if (total>MAX_TOTAL_IMAGE_BYTES) throw Error('图片合计超过 16MB');
    imagesById.set(img.fileID,img);
  });
  const idSet = new Set();
  const notes = doc.notes.map(n=>{
    const clean=normalizeNote(n);
    if (idSet.has(clean.id)) throw Error('笔记 ID 重复');
    idSet.add(clean.id);
    clean.blocks.forEach(b=>{if(b.type==='image' && !imagesById.has(b.content)) throw Error('缺少图片原始数据，不能恢复');});
    return clean;
  });
  // 严格要求每个内嵌图片都被笔记引用，避免被恶意注入额外文件。
  const wanted = new Set(notes.flatMap(n=>n.blocks.filter(b=>b.type==='image').map(b=>b.content)));
  if (wanted.size!==imagesById.size) throw Error('备份里包含未引用的图片');
  return { backupId:doc.backupId, notes, imagesById,
    noteCount:notes.length,imageCount:imagesById.size,publishedCount:notes.filter(n=>n.status==='published').length };
}
// 默认安全模式：全部还原为私人草稿；用户可主动选择保留发布状态。
// 重复恢复同一份备份，会跳过已经完成的笔记，不覆盖原云端内容。
async function restoreCloudBackup(doc, preservePublished, onProgress) {
  const {isAdmin}=await cloud.loadNotes();
  if (!isAdmin) throw Error('只有管理员可以恢复云端笔记');
  const result={created:0,skipped:0,failed:0,total:doc.notes.length};
  const uploaded = new Map();
  for(let i=0;i<doc.notes.length;i++) {
    const note=doc.notes[i];
    progress(onProgress,i,doc.notes.length,`正在恢复第 ${i+1}/${doc.notes.length} 篇`);
    try {
      const check=await cloud.request('restoreCheck',{backupId:doc.backupId,originalId:note.id});
      if(check.exists) { result.skipped++; continue; }
      const blocks=[];
      for(const b of note.blocks) {
        if(b.type!=='image') { blocks.push({...b});continue; }
        let fileID=uploaded.get(b.content);
        if(!fileID) {
          const img=doc.imagesById.get(b.content);
          fileID=await uploadImageInChunks(img);
          if(typeof fileID!=='string'||!fileID.startsWith('cloud://')) throw Error('原图重传失败');
          uploaded.set(b.content,fileID);
        }
        blocks.push({...b,content:fileID});
      }
      const record={title:note.title,category:note.category,
        status:preservePublished ? note.status : 'draft', blocks};
      const saved=await cloud.request('restoreNote',{
        backupId:doc.backupId,originalId:note.id,note:record,
        times:{createdAt:note.createdAt,updatedAt:note.updatedAt}
      });
      if(saved.skipped) result.skipped++; else result.created++;
    } catch(err) {
      result.failed++;
      // 不删除已有数据；如中断，用户可稍后重试同一份备份。
      err.restoreResult=result;
      err.message=`第 ${i+1}/${doc.notes.length} 篇「${note.title}」失败：${err.message}`;
      throw err;
    }
  }
  progress(onProgress,doc.notes.length,doc.notes.length,'恢复完成');
  return result;
}
module.exports={exportCloudBackup,inspectCloudBackup,restoreCloudBackup,normalizeNote,imageBytes,FORMAT,VERSION};
