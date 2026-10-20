const assert=require('assert');
const crypto=require('crypto');
const image=Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452','hex'),Buffer.alloc(1970000-16,0x37)]);
let calls=[];
let failChunk=0;
global.wx={
  getFileSystemManager:()=>({
    getFileInfo:({success})=>success({size:image.length}),
    readFile:({encoding,success})=>success({data:encoding==='base64'?image.toString('base64'):image})
  }),
  cloud:{callFunction:async({data})=>{
    calls.push(data);
    assert(Buffer.byteLength(JSON.stringify(data),'utf8')<1024*1024,'单次图片上传请求必须小于 1MB');
    if(data.action==='restoreImageChunk'){
      if(failChunk&&calls.filter(x=>x.action==='restoreImageChunk').length===failChunk)return{result:{ok:false,message:'模拟断网'}};
      return{result:{ok:true,fileID:'cloud://env/backup-staging/owner/'+calls.length+'.bin'}};
    }
    if(data.action==='restoreImageCommit'){
      assert.strictEqual(data.size,image.length);
      assert.strictEqual(data.sha256,crypto.createHash('sha256').update(image).digest('hex'));
      return{result:{ok:true,fileID:'cloud://env/notes-images/final.png'}};
    }
    if(data.action==='restoreImageCleanup')return{result:{ok:true}};
    throw Error('unexpected '+data.action);
  }}
};
const cloud=require('../utils/cloudNotes');
async function run(){
  let fileID=await cloud.uploadImage('wxfile://photo.png');
  assert.strictEqual(fileID,'cloud://env/notes-images/final.png');
  assert(calls.filter(x=>x.action==='restoreImageChunk').length>=10,'接近 2MB 的图片必须分块');
  assert.strictEqual(calls.filter(x=>x.action==='uploadImage').length,0,'不得再将整张 Base64 图片发送给云函数');
  calls=[];failChunk=2;
  await assert.rejects(()=>cloud.uploadImage('wxfile://photo.png'),/模拟断网/);
  const cleanup=calls.find(x=>x.action==='restoreImageCleanup');
  assert(cleanup&&cleanup.parts.length===1,'断网后应清理已经上传的暂存分块');
  console.log('日常图片上传测试通过：192KB 分块、SHA256、1MB 请求边界和断网清理。');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
