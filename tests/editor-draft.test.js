const assert=require('assert');
const storage=new Map();
let modalResult={confirm:true};
let storageFails=false;
global.wx={
  getStorageSync:key=>storage.has(key)?storage.get(key):'',
  setStorageSync:(key,value)=>{if(storageFails)throw Error('storage full');storage.set(key,JSON.parse(JSON.stringify(value)));},
  removeStorageSync:key=>storage.delete(key),
  showModal:options=>options.success(modalResult)
};
const draft=require('../utils/editorDraft');
async function run(){
  const createRequestId=draft.requestId();
  assert(/^[A-Za-z0-9_-]{16,80}$/.test(createRequestId));
  const interrupted={id:'',createRequestId,title:'未保存的 Java 学习',category:'Java基础',blocks:[
    {uid:'code1',type:'code',content:'public class Main {}'},
    {uid:'img1',type:'image',content:'cloud://env/notes-images/a.png',displayUrl:'wxfile://tmp/expired.png'}
  ]};
  assert.strictEqual(draft.save(interrupted),true);
  // 模拟小程序意外退出后重新加载：请求标识与全部正文仍在，临时预览路径不进入持久化数据。
  const recovered=draft.load('');
  assert.strictEqual(recovered.createRequestId,createRequestId);
  assert.strictEqual(recovered.blocks[0].content,'public class Main {}');
  assert.strictEqual(recovered.blocks[1].content,'cloud://env/notes-images/a.png');
  assert(!('displayUrl' in recovered.blocks[1]));
  assert.strictEqual(await draft.confirmRestore(),true);
  modalResult={confirm:false};assert.strictEqual(await draft.confirmRestore(),false);
  draft.save({id:'note_1',title:'编辑中的另一篇',category:'其他',blocks:[{uid:'t',type:'text',content:'修改'}]});
  assert.strictEqual(draft.load('').title,'未保存的 Java 学习','新建和编辑暂存必须隔离');
  assert.strictEqual(draft.load('note_1').title,'编辑中的另一篇');
  draft.clear('');assert.strictEqual(draft.load(''),null);assert(draft.load('note_1'));
  draft.save({id:'empty',title:'',category:'Java基础',blocks:[{uid:'t',type:'text',content:''}]});
  assert.strictEqual(draft.load('empty'),null,'空白编辑器不应产生恢复提示');
  storageFails=true;assert.strictEqual(draft.save({id:'full',title:'需要保护',blocks:[{uid:'t',type:'text',content:'内容'}]}),false);
  console.log('编辑器本地暂存测试通过：意外退出恢复、新建/编辑隔离、图片云 ID 保留、放弃与清理。');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
