const assert=require('assert');
const crypto=require('crypto');
const Module=require('module');
let user='owner';
const docs=new Map();
const storage=new Map();
let failNextTransactionRead=false;
let transactionTail=Promise.resolve();
let transactionQueryAttempts=0;
let manifestQueryGets=0;
let mutateAfterManifestQueryGet=0;
let manifestMutation=null;
const img=Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452','hex'),Buffer.alloc(1970000-16,0x4b)]);
const id='cloud://current/notes-images/source.png';
storage.set(id,img);
function query(filter) {
  const q={offset:0,length:100,sortField:'',sortDir:'asc',
    orderBy(field,dir){q.sortField=field;q.sortDir=dir;return q;},field(){return q;},skip(n){q.offset=n;return q;},limit(n){q.length=n;return q;},
    async get(){let list=[...docs.entries()].map(([key,v])=>({_id:key,...v}));if(filter)list=list.filter(n=>Object.keys(filter).every(k=>filter[k]&&filter[k].$gt!==undefined?n[k]>filter[k].$gt:n[k]===filter[k]));if(q.sortField)list.sort((a,b)=>String(a[q.sortField]).localeCompare(String(b[q.sortField]))*(q.sortDir==='desc'?-1:1));const data=list.slice(q.offset,q.offset+q.length);manifestQueryGets++;if(mutateAfterManifestQueryGet===manifestQueryGets&&manifestMutation)manifestMutation();return{data};}};
  return q;
}
function collection(transaction=false) {
  return {doc(docId){return{
    async get(){if(transaction&&failNextTransactionRead&&docId.startsWith('r')){failNextTransactionRead=false;throw Error('DATABASE_TIMEOUT');}if(!docs.has(docId))throw Error(`document with _id ${docId} does not exist`);return{data:{_id:docId,...docs.get(docId)}};},
    async set({data}){docs.set(docId,JSON.parse(JSON.stringify(data)));return{};},async remove(){docs.delete(docId);}
  };},orderBy(field,dir){if(transaction){transactionQueryAttempts++;throw Error('TRANSACTION_QUERY_NOT_SUPPORTED');}return query(null).orderBy(field,dir);},where(filter){if(transaction){transactionQueryAttempts++;throw Error('TRANSACTION_QUERY_NOT_SUPPORTED');}return query(filter);}};
}
const database={command:{gt(value){return{$gt:value};}},collection(){return collection(false);},runTransaction(callback){const job=transactionTail.then(()=>callback({collection(){return collection(true);}}));transactionTail=job.catch(()=>{});return job;}};
const mock={
  DYNAMIC_CURRENT_ENV:'current',init(){},database(){return database;},getWXContext(){return{OPENID:user};},
  uploadFile:async({cloudPath,fileContent})=>{const fileID='cloud://current/'+cloudPath;storage.set(fileID,Buffer.from(fileContent));return{fileID};},
  downloadFile:async({fileID})=>{if(!storage.has(fileID))throw Error('missing image');return{fileContent:storage.get(fileID)};},
  deleteFile:async({fileList})=>{fileList.forEach(fileID=>storage.delete(fileID));return{fileList};},
  getTempFileURL:async({fileList})=>({fileList:fileList.map(fileID=>({fileID,tempFileURL:'https://example.test/'+encodeURIComponent(fileID)}))})
};
const prev=Module.prototype.require;Module.prototype.require=function(name){return name==='wx-server-sdk'?mock:prev.apply(this,arguments);};
const api=require('../cloudfunctions/notesApi/index');Module.prototype.require=prev;
const notePayload=(title,status='draft')=>({title,category:'Java',status,blocks:[{type:'text',content:title}]});
const contentDigest=value=>crypto.createHash('sha256').update(value).digest('hex');
async function run(){
  process.env.ADMIN_OPENID='owner';
  docs.set('n1',{title:'私人截图',category:'Java',status:'draft',updatedAt:123,createdAt:100,blocks:[{uid:'a',type:'image',content:id}]});
  user='guest';
  for(const action of ['backupImage','backupManifestStart','backupNote','backupManifestVerify','restoreImageChunk','restoreImageCommit','restoreImageCleanup','restoreCheck','restoreNote']){
    const result=await api.main({action,fileID:id,base64:'QUJD',parts:[],backupId:'backup_123456789',originalId:'n1'});assert.strictEqual(result.ok,false,'访客被拒绝 '+action);
  }
  user='owner';
  let r=await api.main({action:'backupManifestStart'});
  assert.strictEqual(r.ok,true);assert.strictEqual(r.noteCount,1);assert.strictEqual(r.entries[0].id,'n1');assert(JSON.stringify(r).length<10000);
  assert.strictEqual(transactionQueryAttempts,0,'manifest 不得在事务中执行集合查询');
  const originalManifest=r;
  r=await api.main({action:'backupNote',id:'n1',revision:originalManifest.entries[0].revision,cursor:0});
  assert.strictEqual(r.ok,true);assert(/^[0-9a-f]{64}$/.test(r.contentRevision));
  docs.get('n1').updatedAt=124;
  r=await api.main({action:'backupManifestVerify',manifestHash:originalManifest.manifestHash,noteCount:1});assert.strictEqual(r.ok,false,'备份期间修改必须被发现');
  docs.get('n1').updatedAt=123;
  for(let i=0;i<101;i++)docs.set(`page_${String(i).padStart(3,'0')}`,{title:`分页${i}`,category:'测试',status:'draft',createdAt:i,updatedAt:i,blocks:[{uid:'a',type:'text',content:String(i)}]});
  manifestQueryGets=0;mutateAfterManifestQueryGet=2;manifestMutation=()=>{docs.get('page_050').updatedAt=999;};
  r=await api.main({action:'backupManifestStart'});assert.strictEqual(r.ok,false,'游标分页期间修改必须使双扫描失败');
  mutateAfterManifestQueryGet=0;manifestMutation=null;for(let i=0;i<101;i++)docs.delete(`page_${String(i).padStart(3,'0')}`);
  r=await api.main({action:'backupImage',fileID:'cloud://current/notes-images/unknown.png'});assert.strictEqual(r.ok,false);
  r=await api.main({action:'backupImage',fileID:id});assert.strictEqual(r.ok,true);assert.strictEqual(r.size,img.length);assert(!('base64' in r));assert(JSON.stringify(r).length<2048);
  const chunks=[];const encoded=img.toString('base64');
  for(let i=0;i<encoded.length;i+=262144){r=await api.main({action:'restoreImageChunk',base64:encoded.slice(i,i+262144)});assert.strictEqual(r.ok,true);chunks.push(r.fileID);}
  const sha=crypto.createHash('sha256').update(img).digest('hex');
  r=await api.main({action:'restoreImageCommit',parts:chunks,size:img.length,sha256:'0'.repeat(64)});assert.strictEqual(r.ok,false);
  r=await api.main({action:'restoreImageCommit',parts:chunks,size:img.length,sha256:sha});assert.strictEqual(r.ok,true);assert(storage.get(r.fileID).equals(img));assert(chunks.every(c=>!storage.has(c)));
  const pair={backupId:'backup_123456789',originalId:'n1'};
  const originalDigest=contentDigest('原始备份内容');
  r=await api.main({action:'restoreCheck',...pair,contentDigest:originalDigest});assert.strictEqual(r.exists,false);
  r=await api.main({action:'restoreNote',...pair,contentDigest:originalDigest,note:notePayload('恢复')});assert.strictEqual(r.ok,true);const createdId=r.id;
  r=await api.main({action:'restoreNote',...pair,contentDigest:originalDigest,note:notePayload('恢复')});assert.strictEqual(r.skipped,true);
  r=await api.main({action:'restoreNote',...pair,contentDigest:contentDigest('被篡改的备份内容'),note:notePayload('覆盖攻击','published')});assert.strictEqual(r.ok,false);assert.strictEqual(docs.get(createdId).status,'draft');
  failNextTransactionRead=true;
  r=await api.main({action:'restoreNote',...pair,contentDigest:originalDigest,note:notePayload('读取失败后不得覆盖','published')});assert.strictEqual(r.ok,false);assert.strictEqual(docs.get(createdId).title,'恢复');
  const legacy={backupId:'backup_legacy_12345',originalId:'old'};const legacyKey=contentDigest(legacy.backupId+'|'+legacy.originalId).slice(0,32);docs.set('r'+legacyKey,{restoreKey:legacyKey,...notePayload('旧恢复记录')});
  r=await api.main({action:'restoreCheck',...legacy,contentDigest:contentDigest('旧内容')});assert.strictEqual(r.ok,false,'缺少摘要的旧恢复记录必须保守失败');
  const concurrent={backupId:'backup_concurrent_123',originalId:'n2'};
  const concurrentDigest=contentDigest('并发相同原始内容');
  const results=await Promise.all([api.main({action:'restoreNote',...concurrent,contentDigest:concurrentDigest,note:notePayload('并发一')}),api.main({action:'restoreNote',...concurrent,contentDigest:concurrentDigest,note:notePayload('并发一')})]);
  assert.strictEqual(results.filter(x=>x.ok&&!x.skipped).length,1);assert.strictEqual(results.filter(x=>x.ok&&x.skipped).length,1);assert.strictEqual(docs.get(results[0].id).title,'并发一');
  console.log('云函数测试通过：小响应、无事务集合查询、游标清单变动拒绝、图片分块校验、内容摘要冲突、读取失败中止、并发恢复不覆盖。');
}
run().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>delete process.env.ADMIN_OPENID);
