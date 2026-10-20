const format=require('../../utils/store');
const cloud=require('../../utils/cloudNotes');
Page({
  data:{notes:[],isAdmin:false,loading:false,error:''},
  onShow(){this.refresh();},
  async refresh(){this.setData({loading:true,error:''});try {const result=await cloud.loadNotes();this.setData({isAdmin:result.isAdmin,notes:format.decoratedNotes(result.notes.slice(0,6))});}catch(e){this.setData({notes:[],isAdmin:false,error:e.message||'云端加载失败'});}finally{this.setData({loading:false});}},
  goSearch(){wx.navigateTo({url:'/pages/list/list?mode=all&focus=1'});},
  goFeature(e){wx.navigateTo({url:'/pages/list/list?mode='+e.currentTarget.dataset.mode});},
  goFavorites(){wx.redirectTo({url:'/pages/favorites/favorites'});},
  goAll(){wx.navigateTo({url:'/pages/list/list?mode=all'});},
  openNote(e){wx.navigateTo({url:'/pages/detail/detail?id='+encodeURIComponent(e.currentTarget.dataset.id)});}
});
