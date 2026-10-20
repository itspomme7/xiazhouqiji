const format=require('../../utils/store');
const cloud=require('../../utils/cloudNotes');
Page({
 data:{categories:[],notes:[],isAdmin:false,error:''},
 onShow(){this.refresh();},
 async refresh(){try{const {notes,isAdmin}=await cloud.loadNotes();const names=[...new Set(notes.map(n=>n.category||'未分类'))];this.setData({isAdmin,notes:format.decoratedNotes(notes.slice(0,6)),categories:names.map(name=>({name,count:notes.filter(n=>(n.category||'未分类')===name).length})),error:''});}catch(e){this.setData({isAdmin:false,error:e.message,notes:[],categories:[]});}},
 selectCategory(e){wx.navigateTo({url:'/pages/list/list?mode=category&category='+encodeURIComponent(e.currentTarget.dataset.name)});},
 goSearch(){wx.navigateTo({url:'/pages/list/list?mode=all&focus=1'});},
 openNote(e){wx.navigateTo({url:'/pages/detail/detail?id='+encodeURIComponent(e.currentTarget.dataset.id)});}
});
