const format=require('../../utils/store');
const cloud=require('../../utils/cloudNotes');
Page({
 data:{mode:'all',filter:'all',title:'全部内容',category:'',notes:[],keyword:'',focus:false,error:''},
 onLoad(options){const mode=options.mode||'all';const names={all:'全部内容',notes:'学习笔记',images:'学习截图',code:'代码案例',drafts:'草稿箱',published:'已发布内容',history:'最近浏览',category:'分类内容'};this.setData({mode,filter:['notes','images','code'].includes(mode)?mode:'all',title:names[mode]||'全部内容',category:decodeURIComponent(options.category||''),focus:options.focus==='1'});},
 onShow(){this.refresh();},
 async refresh(){try{await cloud.loadNotes();this.setData({error:''});this.update();}catch(e){this.setData({error:e.message,notes:[]});}},
 update(){const {mode,filter,category,keyword}=this.data;let notes=cloud.getCached();if(mode==='history'){const ids=format.historyIds();notes=ids.map(id=>notes.find(n=>n.id===id)).filter(Boolean);}if(mode==='drafts')notes=notes.filter(n=>n.status==='draft');if(mode==='published')notes=notes.filter(n=>n.status==='published');if(mode==='category')notes=notes.filter(n=>n.category===category);if(filter==='images')notes=notes.filter(n=>n.hasImage||(n.blocks||[]).some(b=>b.type==='image'));if(filter==='code')notes=notes.filter(n=>n.hasCode||(n.blocks||[]).some(b=>b.type==='code'));if(keyword.trim()){const k=keyword.toLowerCase().trim();notes=notes.filter(n=>[n.title,n.category,n.summary,n.searchText].join(' ').toLowerCase().includes(k));}this.setData({notes:format.decoratedNotes(notes)});},
 onInput(e){this.setData({keyword:e.detail.value});this.update();},
 setFilter(e){this.setData({filter:e.currentTarget.dataset.filter});this.update();},
 openNote(e){wx.navigateTo({url:'/pages/detail/detail?id='+encodeURIComponent(e.currentTarget.dataset.id)});}
});
