const assert=require('assert');
const Module=require('module');
const storage=new Map();
let definition=null;
let saveMode='offline';
let modalTitles=[];
let restoreConfirm=true;
const existingNote={id:'note_existing',title:'云端原题',category:'Java基础',createdAt:1,blocks:[{uid:'t1',type:'text',content:'云端原文'}]};
const cloud={
  loadNotes:async()=>({isAdmin:true}),role:()=>true,getNote:async()=>JSON.parse(JSON.stringify(existingNote)),
  saveNote:async()=>{if(saveMode==='offline')throw Error('模拟断网');return{id:'n_saved'};},uploadImage:async()=>''
};
global.wx={
  getStorageSync:key=>storage.has(key)?storage.get(key):'',setStorageSync:(key,value)=>storage.set(key,JSON.parse(JSON.stringify(value))),removeStorageSync:key=>storage.delete(key),
  showModal:options=>{modalTitles.push(options.title);const confirm=options.title==='发现未保存内容'?restoreConfirm:true;if(options.success)options.success({confirm,cancel:!confirm});},
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

  // 已有笔记：只打开不修改，退出和重进都不应创建暂存或弹恢复提示。
  modalTitles=[];storage.clear();
  editor=page();await editor.onLoad({id:existingNote.id});editor.onUnload();
  assert.strictEqual(storage.size,0,'已有笔记未修改退出不得生成暂存');
  editor=page();await editor.onLoad({id:existingNote.id});
  assert.strictEqual(modalTitles.filter(x=>x==='发现未保存内容').length,0,'未修改重进不得提示恢复');

  // 修改后退出可以恢复；恢复后即使不继续输入，仍属于待保存内容，应继续保留。
  editor.titleInput({detail:{value:'本机修改题目'}});editor.onUnload();
  assert.strictEqual(storage.size,1);
  editor=page();await editor.onLoad({id:existingNote.id});
  assert.strictEqual(editor.data.title,'本机修改题目');editor.onUnload();
  assert.strictEqual(storage.size,1,'恢复后未保存内容仍需保留');

  // 主动放弃后保持干净；无操作退出、再次进入不再反复提示。
  restoreConfirm=false;editor=page();await editor.onLoad({id:existingNote.id});editor.onUnload();
  assert.strictEqual(storage.size,0,'主动放弃必须清除暂存且不得重新生成');
  const promptsAfterDiscard=modalTitles.filter(x=>x==='发现未保存内容').length;
  editor=page();await editor.onLoad({id:existingNote.id});editor.onUnload();
  assert.strictEqual(modalTitles.filter(x=>x==='发现未保存内容').length,promptsAfterDiscard,'放弃后无新编辑不得再次提示');
  console.log('编辑器页面测试通过：未修改不提示、修改后恢复、恢复后保留、主动放弃不反复提示、断网与成功清理。');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
