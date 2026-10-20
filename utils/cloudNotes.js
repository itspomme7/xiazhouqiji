// 云端读写工具：服务端才拥有 notes 集合读写权限。
const digest=require('./sha256');
const MAX_IMAGE_BYTES=2*1024*1024;
const IMAGE_COMPRESSION_ATTEMPTS=[
  {quality:92,scale:1},{quality:84,scale:1},{quality:76,scale:1},
  {quality:82,scale:0.9},{quality:76,scale:0.8},{quality:70,scale:0.7}
];
let noteCache = [];
let isAdmin = false;
let hasLoaded = false;
function requireCloud() {
  if (!wx.cloud) throw Error('当前小程序未启用云开发');
}
async function request(action, params = {}) {
  requireCloud();
  const res = await wx.cloud.callFunction({ name:'notesApi', data:{ action, ...params } });
  const payload = res && res.result;
  if (!payload || !payload.ok) throw Error((payload && payload.message) || '云端请求失败');
  if (typeof payload.isAdmin === 'boolean') isAdmin = payload.isAdmin;
  return payload;
}
async function loadNotes() {
  noteCache = [];
  let page = 0, more = true;
  do {
    const result = await request('list',{page});
    noteCache.push(...result.notes);
    more = Boolean(result.hasMore);
    page++;
  } while(more && page < 50);
  hasLoaded = true;
  return { notes:noteCache.slice(), isAdmin };
}
async function getNote(id) {
  const blocks=[];
  let cursor=0, revision='';
  let note=null;
  for(let page=0;page<61;page++) {
    const params={id,cursor};
    if(revision) params.revision=revision;
    const result=await request('get',params);
    if(!result.note||!Array.isArray(result.note.blocks)||typeof result.revision!=='string') throw Error('云端笔记分页响应无效');
    if(!revision) {revision=result.revision;note={...result.note,blocks:undefined};}
    else if(result.revision!==revision||result.note.id!==note.id) throw Error('笔记读取期间发生变化，请重新加载');
    blocks.push(...result.note.blocks);
    if(result.nextCursor===null||result.nextCursor===undefined) return {...note,blocks};
    if(!Number.isSafeInteger(result.nextCursor)||result.nextCursor<=cursor) throw Error('云端笔记分页位置无效');
    cursor=result.nextCursor;
  }
  throw Error('云端笔记分页次数超限');
}
async function saveNote(note) { return (await request('save',{note})).note; }
async function deleteNote(id) { await request('delete',{id}); }
function callbackResult(run) {
  return new Promise((resolve,reject)=>run(resolve,reject));
}
async function fileSize(fs,filePath) {
  let firstError;
  if(typeof fs.getFileInfo==='function') {
    try {
      const info=await callbackResult((resolve,reject)=>fs.getFileInfo({filePath,success:resolve,fail:reject}));
      if(Number.isSafeInteger(info.size)&&info.size>0)return info.size;
    } catch(e) { firstError=e; }
  }
  if(typeof fs.stat==='function') {
    try {
      const info=await callbackResult((resolve,reject)=>fs.stat({path:filePath,success:resolve,fail:reject}));
      if(info.stats&&Number.isSafeInteger(info.stats.size)&&info.stats.size>0)return info.stats.size;
    } catch(e) { if(!firstError)firstError=e; }
  }
  const detail=firstError&&firstError.errMsg?'：'+firstError.errMsg:'';
  throw Error('无法读取图片实际大小，已停止上传'+detail);
}
function compressionOptions(filePath,meta,attempt) {
  const options={src:filePath,quality:attempt.quality};
  const width=Number(meta&&meta.width),height=Number(meta&&meta.height);
  if(attempt.scale<1&&Number.isFinite(width)&&width>0&&Number.isFinite(height)&&height>0) {
    options.compressedWidth=Math.max(1,Math.round(width*attempt.scale));
    options.compressedHeight=Math.max(1,Math.round(height*attempt.scale));
  }
  return options;
}
async function compressToLimit(fs,filePath,meta) {
  if(typeof wx.compressImage!=='function')throw Error('图片超过 2MB，当前微信版本无法自动压缩，请裁剪后重试');
  let smallest=Infinity;
  for(const attempt of IMAGE_COMPRESSION_ATTEMPTS) {
    let result;
    try {
      const options=compressionOptions(filePath,meta,attempt);
      result=await callbackResult((resolve,reject)=>wx.compressImage({...options,success:resolve,fail:reject}));
    } catch(_) {
      throw Error('图片超过 2MB，手机端自动压缩失败，请裁剪后重试');
    }
    if(!result||typeof result.tempFilePath!=='string'||!result.tempFilePath)continue;
    const size=await fileSize(fs,result.tempFilePath);
    smallest=Math.min(smallest,size);
    if(size<=MAX_IMAGE_BYTES)return {filePath:result.tempFilePath,size};
  }
  const suffix=Number.isFinite(smallest)?`（最小仍为 ${(smallest/1024/1024).toFixed(1)}MB）`:'';
  throw Error('图片自动压缩后仍超过 2MB'+suffix+'，请裁剪后重试');
}
function base64Bytes(value) {
  if(typeof value!=='string'||!value.length)return 0;
  const padding=value.endsWith('==')?2:(value.endsWith('=')?1:0);
  return Math.floor(value.length*3/4)-padding;
}
async function uploadImage(filePath,meta={}) {
  const fs=wx.getFileSystemManager();
  let prepared={filePath,size:await fileSize(fs,filePath)};
  if(prepared.size>MAX_IMAGE_BYTES)prepared=await compressToLimit(fs,filePath,meta);
  const base64=await callbackResult((resolve,reject)=>fs.readFile({filePath:prepared.filePath,encoding:'base64',success:r=>resolve(r.data),fail:reject}));
  const actualBytes=base64Bytes(base64);
  if(!actualBytes)throw Error('图片为空或无法读取');
  if(actualBytes>MAX_IMAGE_BYTES)throw Error('图片实际内容仍超过 2MB，已停止上传，请裁剪后重试');
  const parts=[];
  // 144KB 原始字节编码后约 192KB；连同 JSON 包装仍安全低于 256KB。
  // 2MB 图片最多 15 块，也不会超过服务端允许的 16 块。
  const CHUNK_CHARS=144*1024*4/3;
  let committed=false;
  try {
    for(let start=0;start<base64.length;start+=CHUNK_CHARS){
      const result=await request('restoreImageChunk',{base64:base64.slice(start,start+CHUNK_CHARS)});
      if(typeof result.fileID!=='string'||!result.fileID.startsWith('cloud://'))throw Error('图片分块上传失败');
      parts.push(result.fileID);
    }
    const result=await request('restoreImageCommit',{parts,size:actualBytes,sha256:digest.sha256Base64(base64)});
    if(typeof result.fileID!=='string'||!result.fileID.startsWith('cloud://'))throw Error('图片合并失败');
    committed=true;
    return result.fileID;
  } finally {
    if(!committed&&parts.length){try{await request('restoreImageCleanup',{parts});}catch(_){}}
  }
}
function getCached() { return noteCache.slice(); }
function role() { return isAdmin; }
function loaded() { return hasLoaded; }
module.exports = { request,loadNotes,getNote,saveNote,deleteNote,uploadImage,getCached,role,loaded };
