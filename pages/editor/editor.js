const cloud=require('../../utils/cloudNotes');
const localDraft=require('../../utils/editorDraft');
function uid(){return 'b'+Date.now()+Math.floor(Math.random()*100000);}
Page({
 data:{id:'',createRequestId:'',isEditing:false,title:'',category:'Java基础',blocks:[],suggestions:['Java基础','条件判断','代码案例','学习截图','其他'],uploading:false,saving:false,allowEditing:false},
 async onLoad(options){
  try {
   await cloud.loadNotes();
   if(!cloud.role()) throw Error('只有管理员可以新增或修改笔记');
   this.setData({allowEditing:true});
   if(options.id){
    const n=await cloud.getNote(options.id);
    this.setData({id:n.id,isEditing:true,title:n.title,category:n.category,blocks:n.blocks,createdAt:n.createdAt});
    wx.setNavigationBarTitle({title:'编辑笔记'});
   } else this.setData({createRequestId:localDraft.requestId(),blocks:[{uid:uid(),type:'text',content:''}]});
   this._draftEnabled=true;
   this._draftDirty=false;
   const saved=localDraft.load(this.data.id);
   if(saved){
    if(await localDraft.confirmRestore()) {
     this.setData({title:saved.title,category:saved.category,blocks:saved.blocks,createRequestId:this.data.id?'':saved.createRequestId});
     this._draftDirty=true;
    } else {localDraft.clear(this.data.id);this._draftDirty=false;}
   }
  } catch(e){wx.showModal({title:'无法编辑',content:e.message||'云端权限验证失败',showCancel:false,success:()=>wx.navigateBack({delta:1})});}
 },
 scheduleDraft(){if(!this._draftEnabled)return;this._draftDirty=true;clearTimeout(this._draftTimer);this._draftTimer=setTimeout(()=>this.flushDraft(),450);},
 flushDraft(){
  if(!this._draftEnabled||!this._draftDirty)return;
  const saved=localDraft.save(this.data);
  if(!saved&&localDraft.meaningful(this.data)&&!this._draftWarningShown){this._draftWarningShown=true;wx.showToast({title:'本机暂存失败，请尽快复制内容',icon:'none'});}
 },
 onHide(){this.flushDraft();},
 onUnload(){clearTimeout(this._draftTimer);this.flushDraft();},
 titleInput(e){this.setData({title:e.detail.value});this.scheduleDraft();},categoryInput(e){this.setData({category:e.detail.value});this.scheduleDraft();},quickCategory(e){this.setData({category:e.currentTarget.dataset.value});this.scheduleDraft();},
 addText(){this.addBlock('text','');},addCode(){this.addBlock('code','');},addBlock(type,content,displayUrl){this.setData({blocks:[...this.data.blocks,{uid:uid(),type,content,displayUrl:displayUrl||''}]});this.scheduleDraft();},
 changeBlock(e){const index=Number(e.currentTarget.dataset.index);this.setData({[`blocks[${index}].content`]:e.detail.value});this.scheduleDraft();},
 switchBlockType(e){
  const index=Number(e.currentTarget.dataset.index);
  const current=this.data.blocks[index];
  if(!current || !['text','code'].includes(current.type)) return;
  const next=current.type==='text'?'code':'text';
  this.setData({[`blocks[${index}].type`]:next});
  this.scheduleDraft();
  wx.showToast({title:next==='code'?'已转为代码块':'已转为文字块',icon:'none'});
 },
 removeBlock(e){const index=Number(e.currentTarget.dataset.index);this.setData({blocks:this.data.blocks.filter((_,i)=>i!==index)});this.scheduleDraft();},
 addImage(){
  if(this.data.uploading||!this.data.allowEditing)return;
  wx.chooseMedia({count:9,mediaType:['image'],sourceType:['album','camera'],sizeType:['compressed'],success:async res=>{
   this.setData({uploading:true});wx.showLoading({title:'上传截图中'});
   let ok=0;
   for(const file of res.tempFiles||[]){
    try{const id=await cloud.uploadImage(file.tempFilePath,{width:file.width,height:file.height});this.addBlock('image',id,file.tempFilePath);ok++;}
    catch(e){wx.showModal({title:'图片上传失败',content:e.message||'请检查网络与云函数',showCancel:false});break;}
   }
   wx.hideLoading();this.setData({uploading:false});if(ok)wx.showToast({title:`已上传 ${ok} 张`,icon:'none'});
  },fail:e=>{if(!String(e.errMsg||'').includes('cancel'))wx.showToast({title:'图片选择失败',icon:'none'});}});
 },
 previewImage(e){wx.previewImage({urls:[e.currentTarget.dataset.src]});},
 cleanBlocks(){return this.data.blocks.filter(b=>b.type==='image'||String(b.content||'').trim()).map(b=>({uid:b.uid,type:b.type,content:b.content}));},
 valid(){if(!this.data.allowEditing||!cloud.role()){wx.showToast({title:'尚未验证管理员',icon:'none'});return false;}if(this.data.uploading||this.data.saving){wx.showToast({title:'请等待当前操作完成',icon:'none'});return false;}if(!this.data.title.trim()){wx.showToast({title:'先填写标题',icon:'none'});return false;}if(!this.cleanBlocks().length){wx.showToast({title:'请添加正文或图片',icon:'none'});return false;}return true;},
 async persist(status){
  if(!this.valid())return;
  this.flushDraft();
  this.setData({saving:true});wx.showLoading({title:'保存到云端'});
  const draftId=this.data.id;
  try {
   const n=await cloud.saveNote({id:this.data.id,createRequestId:this.data.id?'':this.data.createRequestId,title:this.data.title.trim(),category:this.data.category.trim()||'未分类',blocks:this.cleanBlocks(),status});
   this._draftEnabled=false;clearTimeout(this._draftTimer);localDraft.clear(draftId);
   this.setData({id:n.id,isEditing:true});wx.hideLoading();wx.showToast({title:status==='draft'?'云端草稿已保存':'云端发布成功'});setTimeout(()=>wx.redirectTo({url:'/pages/detail/detail?id='+encodeURIComponent(n.id)}),350);
  }
  catch(e){this.flushDraft();wx.hideLoading();wx.showModal({title:'云端保存失败',content:(e.message||'请检查网络后重试')+'。未保存内容仍保留在本机，可稍后重试。',showCancel:false});}
  finally{this.setData({saving:false});}
 },
 saveDraft(){this.persist('draft');},publishNote(){this.persist('published');},
 previewNote(){if(!this.valid())return;wx.showModal({title:'预览提示',content:'请先保存草稿，然后在笔记详情页检查排版。',showCancel:false});}
});
