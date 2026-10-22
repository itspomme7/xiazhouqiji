const cloud=require('../../utils/cloudNotes');
const localDraft=require('../../utils/editorDraft');
const markdown=require('../../utils/markdown');
function uid(){return 'b'+Date.now()+Math.floor(Math.random()*100000);}
Page({
 data:{id:'',createRequestId:'',isEditing:false,title:'',category:'Java基础',blocks:[],suggestions:['Java基础','条件判断','代码案例','学习截图','其他'],uploading:false,saving:false,allowEditing:false,showMarkdownImport:false,markdownInput:''},
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
 toggleMarkdownImport(){
  if(!this.data.allowEditing||this.data.uploading||this.data.saving)return;
  this.setData({showMarkdownImport:!this.data.showMarkdownImport});
 },
 markdownInput(e){this.setData({markdownInput:e.detail.value});},
 cancelMarkdownImport(){
  if(!String(this.data.markdownInput||'').trim()){this.setData({showMarkdownImport:false});return;}
  wx.showModal({title:'放弃这次导入？',content:'尚未导入的 Markdown 将被清空，笔记原有内容不会变化。',confirmText:'放弃',success:r=>{if(r.confirm)this.setData({showMarkdownImport:false,markdownInput:''});}});
 },
 importMarkdown(){
  if(!this.data.allowEditing||this.data.uploading||this.data.saving)return;
  let parsed;
  try{parsed=markdown.parseImport(this.data.markdownInput,{useFirstHeadingAsTitle:!String(this.data.title||'').trim()});}
  catch(e){wx.showModal({title:'Markdown 无法导入',content:e.message||'请检查格式',showCancel:false});return;}
  const existing=(this.data.blocks||[]).filter(b=>b&&(['image'].includes(b.type)||String(b.content||'').trim()));
  if(existing.length+parsed.blocks.length>60){wx.showModal({title:'内容块过多',content:'现有内容加上导入内容将超过 60 个内容块，请先拆分文章。',showCancel:false});return;}
  const s=parsed.stats;
  const parts=[`识别到 ${s.headings} 个标题、${s.lists} 个列表项、${s.codeBlocks} 个 Java 代码块。`];
  if(parsed.title)parts.push(`将使用“${parsed.title}”作为笔记标题。`);
  if(existing.length)parts.push(`导入内容将追加到现有 ${existing.length} 个内容块之后，不会覆盖。`);
  else parts.push('当前空白正文将替换为导入内容。');
  if(parsed.imageLinks.length)parts.push(`发现 ${parsed.imageLinks.length} 个 Markdown 图片链接：不会自动上传，将保留为文字，请稍后手动添加图片。`);
  wx.showModal({
   title:'确认导入 Markdown',content:parts.join('\n'),confirmText:existing.length?'追加导入':'确认导入',
   success:r=>{if(!r.confirm)return;
    const imported=parsed.blocks.map(b=>({uid:uid(),type:b.type,content:b.content}));
    this.setData({blocks:[...existing,...imported],title:String(this.data.title||'').trim()?this.data.title:(parsed.title||this.data.title),showMarkdownImport:false,markdownInput:''});
    this.scheduleDraft();
    wx.showToast({title:`已导入 ${imported.length} 个内容块`,icon:'none'});
   }
  });
 },
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
