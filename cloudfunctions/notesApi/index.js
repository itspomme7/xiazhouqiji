// 下周七集 · 云端笔记 API
// 注意：只有该云函数使用云数据库的管理端权限；小程序端不可直接读写 notes。
const cloud = require('wx-server-sdk');
const crypto = require('crypto');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const NOTES = db.collection('notes');
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_STAGE_BYTES = 192 * 1024;
const MAX_IMAGE_PARTS = 16;
const LIST_PAGE_SIZE = 50;
const DETAIL_BLOCK_BUDGET = 512 * 1024;
const MAX_CLIENT_RESPONSE_BYTES = 900 * 1024;
const MAX_MANIFEST_NOTES = 500;
function stageOwner(openid) { return crypto.createHash('sha256').update(openid).digest('hex').slice(0,20); }
function stagedFileID(fileID,owner) {
  return typeof fileID === 'string' && fileID.startsWith('cloud://') &&
    fileID.includes('/backup-staging/' + owner + '/') && fileID.length <= 600;
}
async function removeStaging(ids) {
  try { if (ids.length) await cloud.deleteFile({fileList:ids}); }
  catch (e) { console.warn('staging cleanup failed',e.message); }
}


function verifyAdmin() {
  const { OPENID } = cloud.getWXContext();
  const configured = String(process.env.ADMIN_OPENID || '').trim();
  return { openid: OPENID || '', isAdmin: Boolean(configured && OPENID && configured === OPENID) };
}
function fail(msg) { return { ok: false, message: msg }; }
function text(v, limit) {
  if (typeof v !== 'string' || v.length > limit) throw Error('字段内容超出限制');
  return v;
}
function normalizeRecord(raw) {
  if (!raw || typeof raw !== 'object') throw Error('笔记格式不正确');
  const title = text(raw.title, 80).trim();
  const category = text(raw.category || '未分类', 30).trim() || '未分类';
  const status = raw.status;
  if (!title) throw Error('请填写标题');
  if (!['draft', 'published'].includes(status)) throw Error('笔记状态不正确');
  if (!Array.isArray(raw.blocks) || !raw.blocks.length || raw.blocks.length > 60) throw Error('内容块数量不正确');
  const blocks = raw.blocks.map((b, i) => {
    if (!b || !['text', 'code', 'image'].includes(b.type)) throw Error('不支持的内容格式');
    const content = text(b.content, b.type === 'image' ? 500 : 25000);
    if (!content.trim()) throw Error('内容块不能为空');
    if (b.type === 'image' && !/^cloud:\/\//.test(content)) throw Error('请先上传图片到云存储');
    return { uid: /^[-\w]{1,60}$/.test(b.uid || '') ? b.uid : `b${i}`, type: b.type, content };
  });
  return { title, category, status, blocks };
}
function validId(id) { return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id); }
function truncateUtf8(value, maxBytes) {
  const text = String(value || '');
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  let out = '';
  let size = 0;
  for (const char of text) {
    const bytes = Buffer.byteLength(char, 'utf8');
    if (size + bytes > maxBytes) break;
    out += char;
    size += bytes;
  }
  return out;
}
function noteId(note) { return String(note && (note._id || note.id) || ''); }
function noteCore(note) {
  return {
    id: noteId(note), title:note.title, category:note.category, status:note.status,
    createdAt:note.createdAt, updatedAt:note.updatedAt,
    blocks:(note.blocks || []).map(b=>({uid:b.uid,type:b.type,content:b.content}))
  };
}
function noteRevision(note) {
  return crypto.createHash('sha256').update(JSON.stringify(noteCore(note))).digest('hex');
}
function manifestRevision(note) {
  if(typeof note._backupRevision==='string'&&/^[0-9a-f]{64}$/.test(note._backupRevision)) return note._backupRevision;
  // 兼容旧数据；所有正式写入 API 都会同步更新 updatedAt，并从本版本起写入 _backupRevision。
  const legacy={id:noteId(note),title:note.title,category:note.category,status:note.status,createdAt:note.createdAt,updatedAt:note.updatedAt};
  return crypto.createHash('sha256').update(JSON.stringify(legacy)).digest('hex');
}
function searchPreview(blocks,maxBytes) {
  let out='';
  for(const block of blocks) {
    if(!block||block.type==='image') continue;
    const separator=out?'\n':'';
    const used=Buffer.byteLength(out,'utf8')+Buffer.byteLength(separator,'utf8');
    if(used>=maxBytes) break;
    const part=truncateUtf8(String(block.content||''),maxBytes-used);
    out+=separator+part;
    if(Buffer.byteLength(part,'utf8')<Buffer.byteLength(String(block.content||''),'utf8')) break;
  }
  return out;
}
function summaryRecord(note) {
  const blocks = Array.isArray(note.blocks) ? note.blocks : [];
  const first = blocks.find(b=>b && b.type === 'text') || blocks.find(b=>b && b.type === 'code');
  const plain=first?String(first.content||'').replace(/\s+/g,' '):'图文记录';
  return {
    id:noteId(note), title:String(note.title || ''), category:String(note.category || '未分类'),
    status:note.status, createdAt:note.createdAt, updatedAt:note.updatedAt,
    summary:plain.length>60?plain.slice(0,60)+'…':plain,
    searchText:searchPreview(blocks,3000),
    hasImage:blocks.some(b=>b && b.type === 'image'),
    hasCode:blocks.some(b=>b && b.type === 'code')
  };
}
function sliceBlocks(note, cursor) {
  const blocks = Array.isArray(note.blocks) ? note.blocks : [];
  const start = Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0;
  if (start > blocks.length) throw Error('内容分页位置无效');
  const selected = [];
  let index = start;
  while (index < blocks.length) {
    const block = blocks[index];
    const candidate = [...selected, block];
    if (selected.length && Buffer.byteLength(JSON.stringify(candidate), 'utf8') > DETAIL_BLOCK_BUDGET) break;
    if (!selected.length && Buffer.byteLength(JSON.stringify(candidate), 'utf8') > DETAIL_BLOCK_BUDGET) {
      throw Error('单个内容块超过详情传输限制');
    }
    selected.push(block);
    index++;
  }
  return { blocks:selected, nextCursor:index < blocks.length ? index : null };
}
async function hydrateBlocks(blocks) {
  const fileIDs = Array.from(new Set((blocks || [])
    .filter(b=>b && b.type === 'image' && /^cloud:\/\//.test(b.content)).map(b=>b.content)));
  if (!fileIDs.length) return blocks;
  const mapped = new Map();
  for (let start=0; start<fileIDs.length; start+=50) {
    try {
      const urls = await cloud.getTempFileURL({ fileList:fileIDs.slice(start,start+50) });
      (urls.fileList || []).forEach(f=>mapped.set(f.fileID, f.tempFileURL || ''));
    } catch (_) { /* 当前批次保持空 URL，调用方可显示加载失败 */ }
  }
  return blocks.map(b=>b.type === 'image' ? {...b,displayUrl:mapped.get(b.content) || ''} : b);
}
function responseBytes(value){return Buffer.byteLength(JSON.stringify(value),'utf8');}
function fitDetailResponse(base,blocks,start,nextCursor) {
  const fitted=blocks.slice();
  let next=nextCursor;
  let result={...base,nextCursor:next,note:{...base.note,blocks:fitted}};
  while(responseBytes(result)>MAX_CLIENT_RESPONSE_BYTES&&fitted.length>1){
    fitted.pop();next=start+fitted.length;
    result={...base,nextCursor:next,note:{...base.note,blocks:fitted}};
  }
  if(responseBytes(result)>MAX_CLIENT_RESPONSE_BYTES) throw Error('单个内容块的响应超过小程序传输限制');
  return result;
}
function manifestHash(entries) {
  return crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}
async function collectManifest(source) {
  const entries = [];
  for (let page=0; page<=Math.ceil(MAX_MANIFEST_NOTES/100); page++) {
    const query=source.collection('notes').orderBy('_id','asc').field({_id:true,_backupRevision:true,title:true,category:true,status:true,createdAt:true,updatedAt:true});
    const {data=[]}=await query.skip(page*100).limit(100).get();
    for (const note of data) {
      entries.push({id:noteId(note),revision:manifestRevision(note)});
      if (entries.length>MAX_MANIFEST_NOTES) throw Error('超过 500 篇，请分批导出；没有生成不完整备份');
    }
    if (data.length<100) break;
  }
  entries.sort((a,b)=>a.id.localeCompare(b.id));
  return {entries,hash:manifestHash(entries)};
}
async function readConsistentManifest() {
  if (typeof db.runTransaction !== 'function') throw Error('当前云数据库 SDK 不支持事务快照，已停止备份');
  return db.runTransaction(transaction=>collectManifest(transaction));
}
function errorText(error) {
  return [error && error.code,error && error.errCode,error && error.message,error && error.errMsg,String(error || '')].join(' ');
}
function isDocumentNotFound(error) {
  const raw=errorText(error);
  return /DOCUMENT_NOT_FOUND/i.test(raw) || /document with _id .+ does not exist/i.test(raw) || /\bdocument not found\b/i.test(raw) || /^\s*not found\s*$/i.test(String(error && error.message || error || ''));
}
function detectImage(buf) {
  if (buf.length >= 8 && buf.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (buf.length >= 3 && buf[0] === 255 && buf[1] === 216 && buf[2] === 255) return 'jpg';
  if (buf.length >= 6 && ['GIF87a','GIF89a'].includes(buf.subarray(0,6).toString('ascii'))) return 'gif';
  if (buf.length >= 12 && buf.toString('ascii',0,4)==='RIFF' && buf.toString('ascii',8,12)==='WEBP') return 'webp';
  throw Error('仅支持 PNG、JPG、GIF、WEBP 图片');
}
// 恢复时用备份 ID + 原笔记 ID 生成固定新 ID；不覆盖现存原笔记。
function restoreKey(backupId, originalId) {
  if (typeof backupId !== 'string' || !/^[A-Za-z0-9_-]{12,90}$/.test(backupId) ||
      typeof originalId !== 'string' || !/^[A-Za-z0-9_-]{1,90}$/.test(originalId)) {
    throw Error('备份来源标识不正确');
  }
  return crypto.createHash('sha256').update(backupId + '|' + originalId).digest('hex').slice(0,32);
}
exports.main = async (event = {}) => {
  const { openid, isAdmin } = verifyAdmin();
  if (!openid) return fail('微信身份识别失败，请重新登录');
  const action = event.action;
  try {
    if (action === 'list') {
      const page = Math.max(0, Math.min(100, Number(event.page)||0));
      const query = isAdmin ? NOTES : NOTES.where({ status: 'published' });
      // UI 列表只返回有严格上限的摘要，正文和图片 URL 由详情分页接口读取。
      const { data = [] } = await query.orderBy('updatedAt','desc').skip(page * LIST_PAGE_SIZE).limit(LIST_PAGE_SIZE).get();
      const result={ok:true,isAdmin,notes:data.map(summaryRecord),hasMore:data.length===LIST_PAGE_SIZE};
      if(responseBytes(result)>MAX_CLIENT_RESPONSE_BYTES) throw Error('笔记摘要响应超过安全限制');
      return result;
    }
    if (action === 'get') {
      if (!validId(event.id)) return fail('笔记 ID 无效');
      let note;
      try { note = (await NOTES.doc(event.id).get()).data; }
      catch(e) { if (isDocumentNotFound(e)) return fail('笔记不存在'); throw e; }
      if (!note || (!isAdmin && note.status !== 'published')) return fail('笔记不存在或无权限');
      const revision=noteRevision(note);
      if (event.revision !== undefined && event.revision !== revision) return fail('笔记读取期间发生变化，请重新加载');
      const cursor=Number(event.cursor)||0;
      const chunk=sliceBlocks(note,cursor);
      const blocks=await hydrateBlocks(chunk.blocks);
      return fitDetailResponse({ok:true,isAdmin,revision,note:{
        id:noteId(note),title:note.title,category:note.category,status:note.status,
        createdAt:note.createdAt,updatedAt:note.updatedAt
      }},blocks,cursor,chunk.nextCursor);
    }
    // 以下操作只认云端 OPENID，与前端按钮/参数无关。
    if (!isAdmin) return fail('没有管理员权限');
    if (action === 'save') {
      const clean = normalizeRecord(event.note);
      const id = event.note && event.note.id;
      const now = Date.now();
      let docId = id;
      let createdAt = now;
      if (id) {
        if (!validId(id)) return fail('笔记 ID 无效');
        try { const old = (await NOTES.doc(id).get()).data; if (old) createdAt = old.createdAt || now; } catch(e) { return fail('原笔记不存在'); }
      } else docId = `n${now}_${crypto.randomBytes(6).toString('hex')}`;
      const record = { ...clean, createdAt, updatedAt: now, _backupRevision:crypto.randomBytes(32).toString('hex') };
      await NOTES.doc(docId).set({ data: record });
      return { ok: true, note: summaryRecord({ _id:docId, ...record }) };
    }
    if (action === 'delete') {
      if (!validId(event.id)) return fail('笔记 ID 无效');
      await NOTES.doc(event.id).remove();
      // 不立即删除图片：可能被其他笔记引用，后续做素材管理与回收站。
      return { ok: true };
    }
    // 管理员专用：逐张获取原图字节用于可离线恢复的备份。
    // 不将全库的图片合成一个大响应，避免云函数响应体限制。
    if (action === 'backupImage') {
      const fileID = event.fileID;
      if (typeof fileID !== 'string' || fileID.length > 500 || !fileID.startsWith('cloud://')) return fail('云图片 ID 无效');
      // 只允许读取当前数据库内正在引用的图片，避免成为通用云存储读取接口。
      // 管理员云数据库行数有限，按页扫描；达到上限仍未匹配则默认拒绝。
      let referenced = false;
      for (let page = 0; page < 50 && !referenced; page++) {
        const { data = [] } = await NOTES.orderBy('updatedAt','desc').skip(page * 100).limit(100).get();
        referenced = data.some(n => (n.blocks || []).some(b => b.type === 'image' && b.content === fileID));
        if (data.length < 100) break;
      }
      if (!referenced) return fail('图片不属于当前笔记库');
      const response = await cloud.downloadFile({ fileID });
      const body = response.fileContent;
      if (!body || !body.length || body.length > MAX_IMAGE_BYTES) return fail('图片为空或超过 2MB');
      const ext = detectImage(body);
      // 单次 callFunction 响应 <= 1MB：只返回短期下载地址和校验信息，绝不返回原图 Base64。
      const urlResult = await cloud.getTempFileURL({ fileList:[fileID] });
      const item = (urlResult.fileList || []).find(f=>f.fileID===fileID);
      if (!item || !item.tempFileURL || item.status === -1) return fail('无法取得原图临时下载地址');
      return { ok: true, fileID, ext, size: body.length,
        sha256: crypto.createHash('sha256').update(body).digest('hex'), tempFileURL:item.tempFileURL };
    }
    if (action === 'backupManifestStart') {
      const manifest=await readConsistentManifest();
      if (!manifest.entries.length) return fail('当前云端没有笔记可以备份');
      const result={ok:true,entries:manifest.entries,manifestHash:manifest.hash,noteCount:manifest.entries.length};
      if(responseBytes(result)>MAX_CLIENT_RESPONSE_BYTES) throw Error('备份清单响应超过安全限制');
      return result;
    }
    if (action === 'backupNote') {
      if(!validId(event.id)||typeof event.revision!=='string'||!/^[0-9a-f]{64}$/.test(event.revision)) return fail('备份笔记参数无效');
      let note;
      try {note=(await NOTES.doc(event.id).get()).data;}
      catch(e){if(isDocumentNotFound(e)) return fail('备份期间有笔记被删除，请重新开始');throw e;}
      if(!note||manifestRevision(note)!==event.revision) return fail('备份期间有笔记发生变化，请重新开始');
      const contentRevision=noteRevision(note);
      if(event.contentRevision!==undefined&&event.contentRevision!==contentRevision) return fail('备份笔记分页期间发生变化，请重新开始');
      const chunk=sliceBlocks(note,Number(event.cursor)||0);
      return {ok:true,revision:event.revision,contentRevision,nextCursor:chunk.nextCursor,note:{
        id:noteId(note),title:note.title,category:note.category,status:note.status,
        createdAt:note.createdAt,updatedAt:note.updatedAt,blocks:chunk.blocks
      }};
    }
    if (action === 'backupManifestVerify') {
      if(typeof event.manifestHash!=='string'||!/^[0-9a-f]{64}$/.test(event.manifestHash)||
          !Number.isSafeInteger(event.noteCount)||event.noteCount<1||event.noteCount>MAX_MANIFEST_NOTES) return fail('备份清单校验参数无效');
      const current=await readConsistentManifest();
      if(current.entries.length!==event.noteCount||current.hash!==event.manifestHash) return fail('备份期间笔记库发生变化，未生成文件，请重新开始');
      return {ok:true,verified:true};
    }
    // 云端恢复时按 192KB 分块提交，规避小程序云函数传输体积上限。
    if (action === 'restoreImageChunk') {
      const base64=event.base64;
      if (typeof base64 !== 'string' || !base64.length || base64.length > Math.ceil(MAX_STAGE_BYTES*4/3) ||
          base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return fail('图片分块大小或编码不正确');
      const bytes=Buffer.from(base64,'base64');
      if (!bytes.length || bytes.length > MAX_STAGE_BYTES) return fail('图片分块超限');
      const prefix='backup-staging/'+stageOwner(openid)+'/';
      const cloudPath=prefix+crypto.randomBytes(16).toString('hex')+'.bin';
      const result=await cloud.uploadFile({cloudPath,fileContent:bytes});
      return {ok:true,fileID:result.fileID};
    }
    if (action === 'restoreImageCommit') {
      const ids=event.parts;
      const expectedSize=event.size;
      const expectedSha=event.sha256;
      const owner=stageOwner(openid);
      if (!Array.isArray(ids) || !ids.length || ids.length > MAX_IMAGE_PARTS ||
          new Set(ids).size !== ids.length || !ids.every(id=>stagedFileID(id,owner)) ||
          !Number.isSafeInteger(expectedSize) || expectedSize < 1 || expectedSize > MAX_IMAGE_BYTES ||
          typeof expectedSha !== 'string' || !/^[0-9a-f]{64}$/.test(expectedSha)) return fail('图片合并参数不正确');
      const buffers=[];
      let total=0;
      // 分批并发，避免 10 多个分块串行下载使云函数执行超时。
      for(let start=0;start<ids.length;start+=4) {
        const group=ids.slice(start,start+4);
        const fetched=await Promise.all(group.map(id=>cloud.downloadFile({fileID:id})));
        for(const response of fetched) {
          const body=response.fileContent;
          if (!body || !body.length || body.length>MAX_STAGE_BYTES) return fail('图片分块丢失或超限');
          total+=body.length;
          if(total>MAX_IMAGE_BYTES) return fail('图片合并超限');
          buffers.push(body);
        }
      }
      if(total!==expectedSize) return fail('恢复图片大小校验失败');
      const data=Buffer.concat(buffers);
      if(crypto.createHash('sha256').update(data).digest('hex')!==expectedSha) return fail('恢复图片 SHA256 校验失败');
      const ext=detectImage(data);
      const result=await cloud.uploadFile({cloudPath:`notes-images/${crypto.randomBytes(16).toString('hex')}.${ext}`,fileContent:data});
      // 合并成功后删除云端中间分块，失败时保留分块供排查（客户端尝试清理）。
      await removeStaging(ids);
      return {ok:true,fileID:result.fileID};
    }
    if (action === 'restoreImageCleanup') {
      const ids=event.parts;
      if(!Array.isArray(ids)||ids.length>MAX_IMAGE_PARTS||!ids.every(id=>stagedFileID(id,stageOwner(openid)))) return fail('清理参数不正确');
      await removeStaging(ids);
      return {ok:true};
    }
    // 相同备份再次恢复时，可先查询笔记是否已经恢复，避免重复上传图片。
    if (action === 'restoreCheck') {
      const key = restoreKey(event.backupId, event.originalId);
      const id = 'r' + key;
      try {
        const res = await NOTES.doc(id).get();
        if (res.data) {
          if (res.data.restoreKey === key) return { ok: true, exists: true, id };
          return fail('恢复记录 ID 冲突，请停止操作');
        }
      } catch (e) { if (!isDocumentNotFound(e)) throw e; }
      return { ok: true, exists: false, id };
    }
    if (action === 'restoreNote') {
      const key = restoreKey(event.backupId, event.originalId);
      const id = 'r' + key;
      const clean = normalizeRecord(event.note);
      const times = event.times || {};
      const createdAt = Number.isSafeInteger(times.createdAt) && times.createdAt > 0 ? times.createdAt : Date.now();
      const updatedAt = Number.isSafeInteger(times.updatedAt) && times.updatedAt > 0 ? times.updatedAt : createdAt;
      const backupRevision=crypto.randomBytes(32).toString('hex');
      if(typeof db.runTransaction!=='function') throw Error('当前云数据库 SDK 不支持原子恢复，已停止写入');
      const outcome=await db.runTransaction(async transaction=>{
        const ref=transaction.collection('notes').doc(id);
        let existing=null;
        try {existing=(await ref.get()).data;}
        catch(e){if(!isDocumentNotFound(e)) throw e;}
        if(existing) return existing.restoreKey===key ? {skipped:true} : {conflict:true};
        await ref.set({data:{...clean,createdAt,updatedAt,restoreKey:key,_backupRevision:backupRevision}});
        return {skipped:false};
      });
      if(outcome.conflict) return fail('目标记录 ID 被占用，未覆盖原数据');
      return {ok:true,id,skipped:outcome.skipped===true};
    }
    if (action === 'uploadImage') {
      const base64 = event.base64;
      if (typeof base64 !== 'string' || base64.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 16 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return fail('图片编码错误或超过 2MB');
      const data = Buffer.from(base64,'base64');
      if (!data.length || data.length > MAX_IMAGE_BYTES) return fail('单张图片不能超过 2MB');
      const ext = detectImage(data);
      if (event.sha256 !== undefined && (typeof event.sha256 !== 'string' ||
          !/^[0-9a-f]{64}$/.test(event.sha256) ||
          crypto.createHash('sha256').update(data).digest('hex') !== event.sha256)) {
        return fail('图片校验未通过，未上传');
      }
      const cloudPath = `notes-images/${crypto.randomBytes(16).toString('hex')}.${ext}`;
      const result = await cloud.uploadFile({ cloudPath, fileContent:data });
      return { ok: true, fileID:result.fileID };
    }
    return fail('未知的操作类型');
  } catch(e) {
    console.error('notesApi error', action, e);
    return fail(String(e.message||'云端处理失败').slice(0,160));
  }
};
