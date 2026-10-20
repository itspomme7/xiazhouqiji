const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const crypto=require('crypto');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xz7-backup-'));
// 模拟用户遇到的 1.97MB 原图，检验不会让单次 callFunction 返回图片 Base64。
const image=Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452','hex'),Buffer.alloc(1970000-16,0x2a)]);
const originalID='cloud://env/notes-images/image.png';
const notes=[{id:'n_demo_1',title:'Java 学习笔记',category:'Java基础',status:'draft',createdAt:100,updatedAt:200,
  blocks:[{uid:'a1',type:'code',content:'public class Main {\n    int n=1;\n}'},{uid:'a2',type:'image',content:originalID}]}];
const cloud=require('../utils/cloudNotes');
const uploadedParts=new Map();const calls=[];const restored=new Set();let isAdmin=true;
cloud.loadNotes=async()=>({isAdmin,notes});cloud.role=()=>isAdmin;
const digest=crypto.createHash('sha256').update(image).digest('hex');
cloud.request=async(action,params)=>{
  calls.push({action,params});
  if(!isAdmin)throw Error('没有管理员权限');
  if(action==='backupImage')return {ok:true,fileID:params.fileID,ext:'png',size:image.length,sha256:digest,tempFileURL:'https://example.test/photo'};
  if(action==='restoreCheck')return {exists:restored.has(params.originalId)};
  if(action==='restoreImageChunk'){
    assert(params.base64.length <= 262144,'分块必须小于 256KiB Base64');
    const id='cloud://env/backup-staging/owner/'+uploadedParts.size+'.bin';
    uploadedParts.set(id,Buffer.from(params.base64,'base64'));
    return {fileID:id};
  }
  if(action==='restoreImageCommit'){
    const body=Buffer.concat(params.parts.map(id=>uploadedParts.get(id)));
    assert.strictEqual(body.length,params.size);
    assert.strictEqual(crypto.createHash('sha256').update(body).digest('hex'),params.sha256);
    assert(body.equals(image),'分块合并的完整 1.97MB 图像字节不一致');
    return {fileID:'cloud://env/notes-images/restored.png'};
  }
  if(action==='restoreImageCleanup')return {ok:true};
  if(action==='restoreNote'){restored.add(params.originalId);return{skipped:false,id:'restored1'};}
  throw Error('unexpected action '+action);
};
const tempImage=path.join(dir,'wx-temp-download.png');fs.writeFileSync(tempImage,image);
global.wx={
  env:{USER_DATA_PATH:dir},
  cloud:{downloadFile({fileID,success}){assert.strictEqual(fileID,originalID);success({tempFilePath:tempImage});}},
  getFileSystemManager:()=>({
    statSync:filePath=>fs.statSync(filePath),
    readFileSync:(filePath,enc)=>fs.readFileSync(filePath,enc),
    writeFileSync:(filePath,data,enc)=>fs.writeFileSync(filePath,data,enc),
    unlinkSync:filePath=>fs.unlinkSync(filePath)
  })
};
const bk=require('../utils/cloudBackup');
async function run(){
  const result=await bk.exportCloudBackup();
  assert.strictEqual(result.noteCount,1);assert.strictEqual(result.imageCount,1);
  assert(result.bytes>image.length && result.bytes<24*1024*1024);
  const raw=fs.readFileSync(result.filePath,'utf8');
  const backup=bk.inspectCloudBackup(result.filePath,fs.statSync(result.filePath).size);
  assert.strictEqual(backup.imageCount,1);
  assert.strictEqual(backup.publishedCount,0);
  assert.strictEqual(backup.imagesById.get(originalID).base64,image.toString('base64'));
  const restoredResult=await bk.restoreCloudBackup(backup,false);
  assert.strictEqual(restoredResult.created,1);
  const again=await bk.restoreCloudBackup(backup,false);
  assert.strictEqual(again.created,0);assert.strictEqual(again.skipped,1);
  assert.strictEqual(calls.filter(x=>x.action==='restoreImageCommit').length,1);
  assert(calls.filter(x=>x.action==='restoreImageChunk').length>=10,'2MB 图片应该分多个小包');
  assert.strictEqual(calls.filter(x=>x.action==='uploadImage').length,0,'不能再整图发 callFunction');
  assert.strictEqual(calls.find(x=>x.action==='restoreNote').params.note.blocks[1].content,'cloud://env/notes-images/restored.png');
  assert.strictEqual(calls.find(x=>x.action==='restoreNote').params.note.status,'draft');
  let evil=JSON.parse(raw);evil.images=[];
  fs.writeFileSync(path.join(dir,'bad.json'),JSON.stringify(evil));
  assert.throws(()=>bk.inspectCloudBackup(path.join(dir,'bad.json')),/缺少图片/);
  evil=JSON.parse(raw);evil.images[0].base64='Rk9P';
  fs.writeFileSync(path.join(dir,'bad2.json'),JSON.stringify(evil));
  assert.throws(()=>bk.inspectCloudBackup(path.join(dir,'bad2.json')),/图片格式|图片字节|图片格式或大小/);
  isAdmin=false;
  await assert.rejects(()=>bk.exportCloudBackup(),/管理员/);
  await assert.rejects(()=>bk.restoreCloudBackup(backup,false),/管理员/);
  console.log('云备份测试通过：1.97MB 原图本地下载、含原图 JSON、分块上传和合并、恢复去重、草稿保护、访客拒绝。');
}
run().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>fs.rmSync(dir,{recursive:true,force:true}));
