const assert=require('assert');
const crypto=require('crypto');
const header=Buffer.from('89504e470d0a1a0a0000000d49484452','hex');
const image=Buffer.concat([header,Buffer.alloc(1970000-header.length,0x37)]);
const boundaryImage=Buffer.concat([header,Buffer.alloc(2*1024*1024-header.length,0x38)]);
const largeScreenshot=Buffer.concat([header,Buffer.alloc(3*1024*1024-header.length,0x42)]);
const compressedScreenshot=Buffer.concat([header,Buffer.alloc(1900000-header.length,0x43)]);
const files=new Map([
  ['wxfile://photo.png',image],
  ['wxfile://two-megabytes.png',boundaryImage],
  ['wxfile://iphone-screenshot.png',largeScreenshot],
  ['wxfile://compressed-screenshot.jpg',compressedScreenshot],
  ['wxfile://still-too-large.jpg',largeScreenshot]
]);
let calls=[];
let failChunk=0;
let compressionMode='success';
let compressionCalls=[];
let expectedUpload=image;
global.wx={
  getFileSystemManager:()=>({
    getFileInfo:({filePath,success,fail})=>files.has(filePath)?success({size:files.get(filePath).length}):fail({errMsg:'not found'}),
    readFile:({filePath,encoding,success,fail})=>files.has(filePath)?success({data:encoding==='base64'?files.get(filePath).toString('base64'):files.get(filePath)}):fail({errMsg:'not found'})
  }),
  compressImage:options=>{
    compressionCalls.push(options);
    if(compressionMode==='fail')return options.fail({errMsg:'compressImage:fail mock'});
    options.success({tempFilePath:compressionMode==='oversize'?'wxfile://still-too-large.jpg':'wxfile://compressed-screenshot.jpg'});
  },
  cloud:{callFunction:async({data})=>{
    calls.push(data);
    assert(Buffer.byteLength(JSON.stringify(data),'utf8')<256*1024,'单次图片上传请求必须小于 256KB');
    if(data.action==='restoreImageChunk'){
      if(failChunk&&calls.filter(x=>x.action==='restoreImageChunk').length===failChunk)return{result:{ok:false,message:'模拟断网'}};
      return{result:{ok:true,fileID:'cloud://env/backup-staging/owner/'+calls.length+'.bin'}};
    }
    if(data.action==='restoreImageCommit'){
      assert.strictEqual(data.size,expectedUpload.length);
      assert.strictEqual(data.sha256,crypto.createHash('sha256').update(expectedUpload).digest('hex'));
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
  calls=[];compressionCalls=[];expectedUpload=boundaryImage;
  fileID=await cloud.uploadImage('wxfile://two-megabytes.png');
  assert.strictEqual(fileID,'cloud://env/notes-images/final.png');
  assert.strictEqual(compressionCalls.length,0,'恰好 2MB 的图片必须直接上传');
  assert(calls.every(x=>Buffer.byteLength(JSON.stringify(x),'utf8')<256*1024),'2MB 边界图片的每个请求必须低于 256KB');
  expectedUpload=image;
  calls=[];failChunk=2;
  await assert.rejects(()=>cloud.uploadImage('wxfile://photo.png'),/模拟断网/);
  const cleanup=calls.find(x=>x.action==='restoreImageCleanup');
  assert(cleanup&&cleanup.parts.length===1,'断网后应清理已经上传的暂存分块');
  calls=[];failChunk=0;compressionCalls=[];compressionMode='success';expectedUpload=compressedScreenshot;
  fileID=await cloud.uploadImage('wxfile://iphone-screenshot.png',{width:1179,height:2556});
  assert.strictEqual(fileID,'cloud://env/notes-images/final.png');
  assert.strictEqual(compressionCalls.length,1,'3MB 截图应先在手机端自动压缩');
  assert.strictEqual(compressionCalls[0].quality,92,'先使用高画质压缩以保持代码文字清晰');
  assert(calls.length>1&&calls.every(x=>Buffer.byteLength(JSON.stringify(x),'utf8')<256*1024),'压缩后的上传仍必须分块且低于 256KB 请求边界');
  const commit=calls.find(x=>x.action==='restoreImageCommit');
  assert(commit&&commit.size===compressedScreenshot.length,'服务端应校验压缩后文件的实际大小');

  calls=[];compressionCalls=[];compressionMode='fail';
  await assert.rejects(()=>cloud.uploadImage('wxfile://iphone-screenshot.png',{width:1179,height:2556}),/自动压缩失败/);
  assert.strictEqual(calls.length,0,'压缩失败不得发送任何云函数请求');

  calls=[];compressionCalls=[];compressionMode='oversize';
  await assert.rejects(()=>cloud.uploadImage('wxfile://iphone-screenshot.png',{width:1179,height:2556}),/自动压缩后仍超过 2MB/);
  assert.strictEqual(compressionCalls.length,6,'应逐步尝试质量和尺寸压缩');
  assert.strictEqual(calls.length,0,'压缩后仍超限不得发送任何云函数请求');
  console.log('日常图片上传测试通过：3MB 截图自动压缩、失败拦截、144KB 分块、SHA256、256KB 请求边界和断网清理。');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
