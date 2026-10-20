const assert=require('assert');
const crypto=require('crypto');
const Module=require('module');
let user='owner';
const docs=new Map();
const storage=new Map();
const img=Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452','hex'),Buffer.alloc(1970000-16,0x4b)]);
const id='cloud://current/notes-images/source.png';
storage.set(id,img);
const mock={
  DYNAMIC_CURRENT_ENV:'current',init(){},
  database(){return{collection(){return {
    doc(docId){return{async get(){if(!docs.has(docId))throw Error('not found');return{data:{_id:docId,...docs.get(docId)}};},async set({data}){docs.set(docId,data);},async remove(){docs.delete(docId);}};},
    orderBy(){const q={skip(n){q.offset=n;return q;},limit(n){q.length=n;return q;},async get(){return {data:[...docs.entries()].map(([key,v])=>({_id:key,...v})).slice(q.offset||0,(q.offset||0)+(q.length||100))};}};return q;},
    where(filter){return {orderBy(){return this;},skip(){return this;},limit(){return this;},async get(){return {data:[...docs.values()].filter(n=>n.status===filter.status)};}};}
  };}};},
  getWXContext(){return {OPENID:user};},
  uploadFile:async ({cloudPath,fileContent})=>{const fileID='cloud://current/'+cloudPath;storage.set(fileID,Buffer.from(fileContent));return{fileID};},
  downloadFile:async ({fileID})=>{if(!storage.has(fileID))throw Error('missing image');return {fileContent:storage.get(fileID)};},
  deleteFile:async ({fileList})=>{fileList.forEach(id=>storage.delete(id));return {fileList};},
  getTempFileURL:async({fileList})=>({fileList:fileList.map(fileID=>({fileID,tempFileURL:'https://example.test/'+encodeURIComponent(fileID)}))})
};
const prev=Module.prototype.require;Module.prototype.require=function(name){return name==='wx-server-sdk'?mock:prev.apply(this,arguments);};
const api=require('../cloudfunctions/notesApi/index');Module.prototype.require=prev;
async function run(){
  process.env.ADMIN_OPENID='owner';
  docs.set('n1',{title:'私人截图',category:'Java',status:'draft',updatedAt:123,createdAt:100,blocks:[{uid:'a',type:'image',content:id}]});
  user='guest';
  for(const action of ['backupImage','restoreImageChunk','restoreImageCommit','restoreImageCleanup','restoreCheck','restoreNote']) {
    const r=await api.main({action,fileID:id,base64:'QUJD',parts:[],backupId:'backup_123456789',originalId:'n1'});
    assert.strictEqual(r.ok,false,'访客被拒绝 '+action);
  }
  user='owner';
  let r=await api.main({action:'backupImage',fileID:'cloud://current/notes-images/unknown.png'});
  assert.strictEqual(r.ok,false,'未引用图片不允许读取');
  r=await api.main({action:'backupImage',fileID:id});
  assert.strictEqual(r.ok,true);
  assert.strictEqual(r.size,img.length);
  assert(r.tempFileURL.startsWith('https://'));
  assert(!('base64' in r),'云函数不允许返回 Base64 原图');
  assert(JSON.stringify(r).length<2048,'响应必须远低于 1MB');
  const chunks=[];
  const encoded=img.toString('base64');
  for(let i=0;i<encoded.length;i+=262144){
    r=await api.main({action:'restoreImageChunk',base64:encoded.slice(i,i+262144)});
    assert.strictEqual(r.ok,true);
    chunks.push(r.fileID);
  }
  assert(chunks.length>=10 && chunks.length<=16);
  const sha=crypto.createHash('sha256').update(img).digest('hex');
  r=await api.main({action:'restoreImageCommit',parts:chunks,size:img.length,sha256:'0'.repeat(64)});
  assert.strictEqual(r.ok,false,'图片错误哈希必须被拒绝');
  r=await api.main({action:'restoreImageCommit',parts:chunks,size:img.length,sha256:sha});
  assert.strictEqual(r.ok,true);
  assert(storage.get(r.fileID).equals(img));
  assert(chunks.every(c=>!storage.has(c)),'分块应被清理');
  const pair={backupId:'backup_123456789',originalId:'n1'};
  r=await api.main({action:'restoreCheck',...pair});assert.strictEqual(r.exists,false);
  r=await api.main({action:'restoreNote',...pair,note:{title:'恢复',category:'Java',status:'draft',blocks:[{type:'text',content:'hi'}]}});
  assert.strictEqual(r.ok,true);
  const createdId=r.id;
  r=await api.main({action:'restoreNote',...pair,note:{title:'覆盖攻击',category:'Java',status:'published',blocks:[{type:'text',content:'bad'}]}});
  assert.strictEqual(r.skipped,true);assert.strictEqual(docs.get(createdId).status,'draft');
  r=await api.main({action:'restoreCheck',...pair});assert.strictEqual(r.exists,true);
  console.log('云函数测试通过：访客无法备份和分块上传、1.97MB 元信息小响应、分块 SHA256 校验、重复恢复不覆盖。');
}
run().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>delete process.env.ADMIN_OPENID);
