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
async function getNote(id) { return (await request('get',{id})).note; }
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
