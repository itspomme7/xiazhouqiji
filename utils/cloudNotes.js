// 云端读写工具：服务端才拥有 notes 集合读写权限。
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
async function uploadImage(filePath) {
  const fs=wx.getFileSystemManager();
  const info=await new Promise((resolve,reject)=>fs.getFileInfo({filePath,success:resolve,fail:reject}));
  if(info.size > 2*1024*1024) throw Error('单张图片不能超过 2MB，请先压缩');
  const base64 = await new Promise((resolve,reject)=>fs.readFile({filePath,encoding:'base64',success: r=>resolve(r.data),fail:reject}));
  return (await request('uploadImage',{base64})).fileID;
}
function getCached() { return noteCache.slice(); }
function role() { return isAdmin; }
function loaded() { return hasLoaded; }
module.exports = { request,loadNotes,getNote,saveNote,deleteNote,uploadImage,getCached,role,loaded };
