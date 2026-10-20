const assert = require('assert');
const Module = require('module');
const path = require('path');
const dbRecords = new Map();
let currentOpenid = 'visitor-openid';
let tempUrlPadding = 0;
const collection = {
  where(filter) { return query(filter); },
  orderBy(field,dir) { return query(null).orderBy(field,dir); },
  doc(id) {
    return {
      get: async()=>{ if(!dbRecords.has(id)) throw Error('not found'); return {data:{_id:id,...dbRecords.get(id)}}; },
      set: async({data})=>{dbRecords.set(id,JSON.parse(JSON.stringify(data))); return {};},
      remove: async()=>{dbRecords.delete(id);return {};}
    };
  }
};
function query(filter) {
  const q={ filter, start:0, count:100,
    orderBy(){return q;},skip(skip){q.start=skip;return q;},limit(limit){q.count=limit;return q;},
    async get(){let list=[...dbRecords.entries()].map(([id,item])=>({_id:id,...item}));if(filter)list=list.filter(x=>Object.keys(filter).every(k=>x[k]===filter[k]));return {data:list.slice(q.start,q.start+q.count)};}
  };return q;
}
const sdk = { DYNAMIC_CURRENT_ENV:'current',init(){},database(){return {collection(){return collection;}};},getWXContext(){return {OPENID:currentOpenid};},getTempFileURL:async({fileList})=>({fileList:fileList.map(fileID=>({fileID,tempFileURL:'https://mock/'+('x'.repeat(tempUrlPadding))+fileID}))}),uploadFile:async({cloudPath})=>({fileID:'cloud://test-env/'+cloudPath})};
const originalRequire = Module.prototype.require;
Module.prototype.require = function(name){return name==='wx-server-sdk'?sdk:originalRequire.apply(this,arguments);};
const api = require('../cloudfunctions/notesApi/index');
Module.prototype.require = originalRequire;
async function run(){
  process.env.ADMIN_OPENID='my-openid';
  let result=await api.main({action:'save',note:{title:'禁止修改',category:'Java',status:'draft',blocks:[{type:'text',content:'hello'}]}});
  assert.strictEqual(result.ok,false,'访客不得写入');
  result=await api.main({action:'uploadImage',base64:'YWJj'});
  assert.strictEqual(result.ok,false,'访客不得上传');
  currentOpenid='my-openid';
  result=await api.main({action:'save',note:{title:'秘密草稿',category:'Java',status:'draft',blocks:[{uid:'u1',type:'text',content:'secret'}]}});
  assert.strictEqual(result.ok,true);
  const draftId=result.note.id;
  result=await api.main({action:'save',note:{title:'公开教程',category:'Java',status:'published',blocks:[{uid:'u2',type:'text',content:'public'}]}});
  assert.strictEqual(result.ok,true);
  const publicId=result.note.id;
  result=await api.main({action:'list'});
  assert.strictEqual(result.notes.length,2,'管理员可见草稿');
  currentOpenid='visitor-openid';
  result=await api.main({action:'list'});
  assert.deepStrictEqual(result.notes.map(n=>n.id),[publicId],'访客只见公开笔记');
  result=await api.main({action:'get',id:draftId});
  assert.strictEqual(result.ok,false,'访客不能通过 ID 读草稿');
  result=await api.main({action:'get',id:publicId});
  assert.strictEqual(result.ok,true,'访客可读公开笔记');
  result=await api.main({action:'delete',id:publicId});
  assert.strictEqual(result.ok,false,'访客不能删除');
  currentOpenid='my-openid';
  const largeBlocks=Array.from({length:60},(_,i)=>({uid:'large'+i,type:'text',content:'中'.repeat(25000)}));
  result=await api.main({action:'save',note:{title:'大中文笔记',category:'Java',status:'draft',blocks:largeBlocks}});
  assert.strictEqual(result.ok,true);assert(Buffer.byteLength(JSON.stringify(result),'utf8')<1024*1024,'保存响应不得返回完整大笔记');
  const largeId=result.note.id;
  let cursor=0,revision='',received=[];
  for(let page=0;page<20;page++){
    const part=await api.main({action:'get',id:largeId,cursor,...(revision?{revision}:{})});
    assert.strictEqual(part.ok,true);assert(Buffer.byteLength(JSON.stringify(part),'utf8')<1024*1024,'详情分块响应必须小于 1MB');
    if(!revision)revision=part.revision;
    received.push(...part.note.blocks);
    if(part.nextCursor===null){cursor=null;break;}
    cursor=part.nextCursor;
  }
  assert.strictEqual(cursor,null);assert.strictEqual(received.length,60);assert.strictEqual(received[59].content.length,25000);
  tempUrlPadding=20000;
  const imageBlocks=Array.from({length:60},(_,i)=>({uid:'img'+i,type:'image',content:`cloud://test-env/notes-images/${i}.png`}));
  result=await api.main({action:'save',note:{title:'六十张图片',category:'Java',status:'draft',blocks:imageBlocks}});
  const imageId=result.note.id;cursor=0;revision='';received=[];
  for(let page=0;page<5;page++){
    const part=await api.main({action:'get',id:imageId,cursor,...(revision?{revision}:{})});
    assert(Buffer.byteLength(JSON.stringify(part),'utf8')<1024*1024,'超长临时 URL 也必须分页到 1MB 以下');
    if(!revision)revision=part.revision;received.push(...part.note.blocks);
    if(part.nextCursor===null){cursor=null;break;}cursor=part.nextCursor;
  }
  tempUrlPadding=0;assert.strictEqual(cursor,null);assert.strictEqual(received.length,60);
  result=await api.main({action:'list'});
  assert(Buffer.byteLength(JSON.stringify(result),'utf8')<1024*1024,'列表摘要响应必须小于 1MB');
  assert(result.notes.every(n=>!('blocks' in n)),'列表不得返回完整正文块');
  result=await api.main({action:'delete',id:draftId});
  assert.strictEqual(result.ok,true,'管理员可以删除');
  delete process.env.ADMIN_OPENID;
  result=await api.main({action:'save',note:{title:'不允许',status:'draft',blocks:[]}});
  assert.strictEqual(result.ok,false,'没有 ADMIN_OPENID 时默认拒绝');
  console.log('云端 API 测试通过：访客隔离、摘要列表、大中文详情分块小于 1MB、管理员写入及默认拒绝。');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
