const store = require('../../utils/store');
const backup = require('../../utils/backup');
const cloud = require('../../utils/cloudNotes');
const cloudBackup = require('../../utils/cloudBackup');

// 「我的」正式页面：是否为管理员只以 notesApi 的云端返回值为准。
Page({
  data: {
    ready: false,
    isAdmin: false,
    count: 0,
    publishedCount: 0,
    favoriteCount: 0,
    historyCount: 0,
    draftCount: 0,
    showLegacyTools: false,
    notesError: '',
    backupBusy: false,
    backupProgress: ''
  },

  onShow() { this.refresh(); },

  async refresh() {
    // 切换微信身份或网络重连期间，不沿用之前的管理员界面。
    this.setData({ ready: false, isAdmin: false, notesError: '' });
    try {
      const result = await cloud.loadNotes();
      const notes = result.notes || [];
      const isAdmin = result.isAdmin === true;
      const visibleIds = new Set(notes.map(n => n.id));
      this.setData({
        ready: true,
        isAdmin,
        count: notes.length,
        publishedCount: notes.filter(n => n.status === 'published').length,
        draftCount: isAdmin ? notes.filter(n => n.status === 'draft').length : 0,
        favoriteCount: notes.filter(n => store.isFavorite(n.id)).length,
        historyCount: store.historyIds().filter(id => visibleIds.has(id)).length,
        notesError: '',
        showLegacyTools: isAdmin ? this.data.showLegacyTools : false
      });
    } catch (err) {
      this.setData({
        ready: true,
        isAdmin: false,
        count: 0,
        publishedCount: 0,
        draftCount: 0,
        favoriteCount: 0,
        historyCount: 0,
        showLegacyTools: false,
        notesError: '内容暂时无法加载，请检查网络后重试'
      });
    }
  },

  goFavorites() { wx.redirectTo({ url: '/pages/favorites/favorites' }); },
  goHistory() { wx.navigateTo({ url: '/pages/list/list?mode=history' }); },
  goDrafts() {
    if (!this.data.isAdmin) return;
    wx.navigateTo({ url: '/pages/list/list?mode=drafts' });
  },
  goPublished() {
    if (!this.data.isAdmin) return;
    wx.navigateTo({ url: '/pages/list/list?mode=published' });
  },
  goNew() {
    if (!this.data.isAdmin) return;
    wx.navigateTo({ url: '/pages/editor/editor' });
  },
  toggleLegacyTools() {
    if (!this.data.isAdmin) return;
    this.setData({ showLegacyTools: !this.data.showLegacyTools });
  },

  updateBackupProgress(v) {
    this.setData({backupProgress:v.label || ''});
  },
  async exportPortableCloudBackup() {
    if (!this.data.isAdmin || this.data.backupBusy) return;
    this.setData({backupBusy:true,backupProgress:'正在核对云端笔记'});
    try {
      const out = await cloudBackup.exportCloudBackup(p=>this.updateBackupProgress(p));
      this.setData({backupBusy:false,backupProgress:''});
      wx.showModal({
        title:'完整备份文件已生成',
        content:`共 ${out.noteCount} 篇笔记、${out.imageCount} 张原图。请务必将 JSON 文件转发到自己的文件传输助手并另存一份；该文件包含私人草稿。`,
        confirmText:'发送文件',
        cancelText:'稍后',
        success:r=>{if(r.confirm) {
          if (typeof wx.shareFileMessage === 'function') {
            wx.shareFileMessage({filePath:out.filePath,fileName:out.fileName,
              fail:e=>wx.showModal({title:'分享未完成',content:'文件已保存在本机小程序空间，请用 iPhone 微信再次尝试。',showCancel:false})});
          } else wx.showModal({title:'暂不支持分享',content:'请在真机微信中使用文件分享功能。',showCancel:false});
        }}
      });
    } catch(e) {
      this.setData({backupBusy:false,backupProgress:''});
      wx.showModal({title:'完整备份未完成',content:e.message||'请检查网络并重试',showCancel:false});
    }
  },
  importPortableCloudBackup() {
    if (!this.data.isAdmin || this.data.backupBusy) return;
    wx.chooseMessageFile({
      count:1,type:'file',extension:['json'],
      success:res=>{
        let doc;
        try {
          const file = res.tempFiles && res.tempFiles[0];
          if (!file) throw Error('尚未选择备份文件');
          doc=cloudBackup.inspectCloudBackup(file.path,file.size);
        } catch(e) {
          wx.showModal({title:'备份文件无法使用',content:e.message||'请重新选择',showCancel:false});
          return;
        }
        wx.showActionSheet({
          itemList:['安全恢复：全部作为私人草稿（推荐）','恢复原始状态（公开笔记仍公开）'],
          success:pick=>{
            const keepPublished=pick.tapIndex===1;
            wx.showModal({
              title:'确认恢复到云端',
              content:`将检查并恢复 ${doc.noteCount} 篇笔记及 ${doc.imageCount} 张原图。不会覆盖原笔记；重复导入同一份文件会跳过已恢复的笔记。${keepPublished?'注意：原公开笔记会立即对访客公开。':'恢复后的笔记均为私人草稿。'}中途中断可选同一份备份继续。`,
              confirmText:'开始恢复',
              success:r=>{if(r.confirm) this.performRestore(doc,keepPublished);}
            });
          }
        });
      },
      fail:e=>{if(!String(e.errMsg||'').includes('cancel'))wx.showToast({title:'无法选择备份文件',icon:'none'});}
    });
  },
  async performRestore(doc, keepPublished) {
    if (!this.data.isAdmin || this.data.backupBusy) return;
    this.setData({backupBusy:true,backupProgress:'准备恢复到云端'});
    try {
      const result=await cloudBackup.restoreCloudBackup(doc,keepPublished,p=>this.updateBackupProgress(p));
      this.setData({backupBusy:false,backupProgress:''});
      await this.refresh();
      wx.showModal({title:'恢复完成',content:`新增 ${result.created} 篇，跳过重复 ${result.skipped} 篇，未覆盖已有笔记。请打开草稿箱核对图片和代码。`,showCancel:false});
    } catch(e) {
      this.setData({backupBusy:false,backupProgress:''});
      const r=e.restoreResult||{};
      wx.showModal({title:'恢复中断',content:`${e.message||'发生错误'}。此前已完成 ${r.created||0} 篇、跳过 ${r.skipped||0} 篇。原有笔记未删除；可以用同一份 JSON 重试，已恢复的笔记会跳过。`,showCancel:false});
    }
  },

  // 目前仅导出文字与代码。图片是云文件引用，不是完整备份。
  async exportCloudMarkdown() {
    if (!this.data.isAdmin || this.data.backupBusy) return;
    this.setData({backupBusy:true,backupProgress:'正在读取云端笔记'});
    try {
      const summaries=cloud.getCached();
      const notes=[];
      for(let i=0;i<summaries.length;i++){
        this.setData({backupProgress:`正在读取第 ${i+1}/${summaries.length} 篇`});
        notes.push(await cloud.getNote(summaries[i].id));
      }
      const md = notes.map(n => `# ${n.title}\n\n分类：${n.category}｜状态：${n.status}\n\n` +
        (n.blocks || []).map(b => b.type === 'code' ? `\`\`\`java\n${b.content}\n\`\`\`\n` :
          b.type === 'image' ? `[云端图片引用：${b.content}]\n` : `${b.content}\n`).join('\n')).join('\n---\n\n');
      wx.setClipboardData({
        data: md || '暂无云端笔记',
        success: () => wx.showModal({title:'已复制 Markdown',content:'文字和代码已复制。图片仅保留云端引用，不包含图片文件，因此不能作为完整备份。',showCancel:false})
      });
    } catch(e) {
      wx.showModal({title:'Markdown 导出失败',content:e.message||'请检查网络后重试',showCancel:false});
    } finally {
      this.setData({backupBusy:false,backupProgress:''});
    }
  },

  exportMarkdown() { this.shareLegacyExport('markdown'); },
  exportCompleteBackup() { this.shareLegacyExport('backup'); },
  shareLegacyExport(kind) {
    if (!this.data.isAdmin) return;
    try {
      const file = backup.createExportFile(kind);
      if (typeof wx.shareFileMessage === 'function') {
        wx.shareFileMessage({
          filePath: file.filePath,
          fileName: file.fileName,
          success: () => wx.showToast({ title: '请妥善保存旧版文件', icon: 'none' }),
          fail: () => wx.showModal({
            title: '文件已生成',
            content: '模拟器可能不支持分享文件，请使用微信真机测试。\n文件名：' + file.fileName,
            showCancel: false
          })
        });
      } else {
        wx.showModal({ title: '请使用微信真机', content: '当前环境不支持文件转发。', showCancel: false });
      }
    } catch (err) {
      wx.showModal({ title: '本地导出失败', content: err.message || '请重试', showCancel: false });
    }
  },

  importBackup() {
    if (!this.data.isAdmin) return;
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['json'],
      success: res => {
        try {
          const file = res.tempFiles && res.tempFiles[0];
          if (!file) throw Error('没有选择文件');
          const notes = backup.inspectBackupFile(file.path, file.size);
          wx.showModal({
            title: '仅恢复旧版本地数据',
            content: `共 ${notes.length} 篇。恢复后只写入当前设备，不会上传云数据库。`,
            success: r => {
              if (!r.confirm) return;
              try {
                const out = backup.restoreNotes(notes);
                wx.showToast({ title: `本地恢复 ${out.imported} 篇`, icon: 'none' });
              } catch (err) {
                wx.showModal({ title: '恢复失败', content: err.message, showCancel: false });
              }
            }
          });
        } catch (err) {
          wx.showModal({ title: '无法导入', content: err.message || '读取失败', showCancel: false });
        }
      }
    });
  }
});
