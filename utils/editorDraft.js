// 编辑器本机临时草稿。只保存云文件 ID，不保存失效很快的本地图片预览路径。
const PREFIX='xz7_editor_draft_v1:';
function target(id){return id?'edit:'+id:'new';}
function storageKey(id){return PREFIX+target(id);}
function requestId(){return 'c'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,12)+'_'+Math.random().toString(36).slice(2,12);}
function cleanBlocks(blocks){
  return (Array.isArray(blocks)?blocks:[]).filter(b=>b&&['text','code','image'].includes(b.type)).map((b,i)=>({
    uid:/^[-\w]{1,60}$/.test(b.uid||'')?b.uid:'b'+i,
    type:b.type,
    content:String(b.content||'')
  }));
}
function meaningful(value){
  return Boolean(value&&(String(value.title||'').trim()||cleanBlocks(value.blocks).some(b=>b.type==='image'||b.content.trim())));
}
function save(value){
  if(!value||value.disabled)return false;
  const data={
    version:1,id:String(value.id||''),createRequestId:String(value.createRequestId||''),
    title:String(value.title||''),category:String(value.category||''),blocks:cleanBlocks(value.blocks),updatedAt:Date.now()
  };
  if(!meaningful(data)){clear(data.id);return false;}
  try{wx.setStorageSync(storageKey(data.id),data);return true;}catch(_){return false;}
}
function load(id){
  try{
    const data=wx.getStorageSync(storageKey(id));
    if(!data||data.version!==1||String(data.id||'')!==String(id||'')||!Array.isArray(data.blocks)||!meaningful(data))return null;
    if(!id&&!/^[A-Za-z0-9_-]{16,80}$/.test(data.createRequestId||''))return null;
    return {...data,blocks:cleanBlocks(data.blocks)};
  }catch(_){return null;}
}
function clear(id){try{wx.removeStorageSync(storageKey(id));}catch(_){} }
function confirmRestore(){
  return new Promise(resolve=>wx.showModal({
    title:'发现未保存内容',content:'是否恢复上次未保存的标题、正文和已上传截图？',
    confirmText:'恢复',cancelText:'放弃',success:r=>resolve(Boolean(r.confirm)),fail:()=>resolve(false)
  }));
}
module.exports={target,requestId,cleanBlocks,meaningful,save,load,clear,confirmRestore};
