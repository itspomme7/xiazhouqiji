Component({
  properties: {active: {type:String,value:'home'},isAdmin:{type:Boolean,value:false}},
  methods: {
    goHome(){this.jump('/pages/index/index');},
    goCategories(){this.jump('/pages/categories/categories');},
    goFavorites(){this.jump('/pages/favorites/favorites');},
    goMine(){this.jump('/pages/mine/mine');},
    goAdd(){wx.navigateTo({url:'/pages/editor/editor'});},
    jump(url){const pages=getCurrentPages();if(pages[pages.length-1].route===url.slice(1))return;wx.redirectTo({url});}
  }
});
