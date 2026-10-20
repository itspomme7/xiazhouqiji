const assert=require('assert');
const Module=require('module');
const storage=new Map();
let definition=null;
let saveMode='offline';
let modalTitles=[];
const cloud={
  loadNotes:async()=>({isAdmin:true}),role:()=>true,getNote:async()=>{throw Error('unused');},
  saveNote:async()=>{if(saveMode==='offline')throw Error('模拟断网');return{id:'n_saved'};},uploadImage:async()=>''
};
global.wx={
  getStorageSync:key=>storage.has(key)?storage.get(key):'',setStorageSync:(key,value)=>storage.set(key,JSON.parse(JSON.stringify(value))),removeStorageSync:key=>storage.delete(key),
  showModal:options=>{modalTitles.push(options.title);if(options.success)options.success({confirm:true,cancel:false});},
  showLoading(){},hideLoading(){},showToast(){},redirectTo(){},setNavigationBarTitle(){},navigateBack(){}
};
global.Page=value=>{definition=value;};
const originalRequire=Module.prototype.require;
Module.prototype.require=function(name){return name==='../../utils/cloudNotes'?cloud:originalRequire.apply(this,arguments);};
require('../pages/editor/editor');
Module.prototype.require=originalRequire;
function page(){
  const instance={...definition,data:JSON.parse(JSON.stringify(definition.data))};
  instance.setData=function(values){for(const [key,value] of Object.entries(values)){const match=/^blocks\[(\d+)\]\.(\w+)$/.exec(key);if(match)this.data.blocks[Number(match[1])][match[2]]=value;else this.data[key]=value;}};
  return instance;
}
async function run(){
  let editor=page();await editor.onLoad({});
  const requestId=editor.data.createRequestId;
  editor.titleInput({detail:{value:'断网前的标题'}});
  editor.changeBlock({currentTarget:{dataset:{index:0}},detail:{value:'未保存的长 Java 内容'}});
  editor.onUnload();
  assert(storage.size===1,'意外退出必须同步落下本机暂存');
  await editor.persist('draft');
  assert(modalTitles.includes('云端保存失败'));assert(storage.size===1,'断网保存失败不得清除暂存');
  editor=page();await editor.onLoad({});
  assert.strictEqual(editor.data.title,'断网前的标题');assert.strictEqual(editor.data.blocks[0].content,'未保存的长 Java 内容');
  assert.strictEqual(editor.data.createRequestId,requestId,'恢复后必须沿用同一个新建请求标识');
  saveMode='success';await editor.persist('draft');
  assert.strictEqual(storage.size,0,'收到云端成功响应后才清除暂存');
  console.log('编辑器页面测试通过：意外退出、恢复提示、断网保留、请求标识复用和成功后清理。');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
