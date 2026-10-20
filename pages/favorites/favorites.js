const format=require('../../utils/store');
const cloud=require('../../utils/cloudNotes');
Page({data:{notes:[],isAdmin:false,error:''},onShow(){this.refresh();},async refresh(){try{const {notes,isAdmin}=await cloud.loadNotes();this.setData({notes:format.decoratedNotes(notes.filter(n=>format.isFavorite(n.id))),isAdmin,error:''});}catch(e){this.setData({notes:[],isAdmin:false,error:e.message});}},openNote(e){wx.navigateTo({url:'/pages/detail/detail?id='+encodeURIComponent(e.currentTarget.dataset.id)});}});
