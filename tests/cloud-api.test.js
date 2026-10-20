const assert = require('assert');
const Module = require('module');
const path = require('path');
const dbRecords = new Map();
let currentOpenid = 'visitor-openid';
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
const sdk = { DYNAMIC_CURRENT_ENV:'current',init(){},database(){return {collection(){return collection;}};},getWXContext(){return {OPENID:currentOpenid};},getTempFileURL:async({fileList})=>({fileList:fileList.map(fileID=>({fileID,tempFileURL:'https://mock/'+fileID}))}),uploadFile:async({cloudPath})=>({fileID:'cloud://test-env/'+cloudPath})};
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
  result=await api.main({action:'delete',id:draftId});
  assert.strictEqual(result.ok,true,'管理员可以删除');
  delete process.env.ADMIN_OPENID;
  result=await api.main({action:'save',note:{title:'不允许',status:'draft',blocks:[]}});
  assert.strictEqual(result.ok,false,'没有 ADMIN_OPENID 时默认拒绝');
  console.log('云端 API 权限测试通过：访客只读公开、草稿隔离、禁上传/删除、管理员写入、未配置时默认拒绝。');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
