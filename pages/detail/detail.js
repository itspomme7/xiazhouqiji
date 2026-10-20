const store = require('../../utils/store');
const cloud = require('../../utils/cloudNotes');

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function wrapLines(ctx, text, maxWidth, maxLines) {
  const result = [];
  const paragraphs = String(text || '').split('\n');
  for (const p of paragraphs) {
    let line = '';
    for (const char of p) {
      if (ctx.measureText(line + char).width > maxWidth && line) {
        result.push(line);
        line = char;
        if (result.length >= maxLines) return result;
      } else line += char;
    }
    result.push(line);
    if (result.length >= maxLines) return result;
  }
  return result;
}
// 这里只生成 Markdown 文本；图片仍存放在微信云存储，不能当作完整离线备份。
function noteToMarkdown(note) {
  let result = `# ${note.title}\n\n分类：${note.category}\n\n`;
  for (const block of note.blocks || []) {
    if (block.type === 'text') result += `${block.content}\n\n`;
    if (block.type === 'code') result += `\`\`\`java\n${block.content}\n\`\`\`\n\n`;
    if (block.type === 'image') result += `[云端学习截图：${block.content}]\n\n`;
  }
  return result;
}
// 逐行渲染代码：不能依赖一整段 text 的 white-space 属性来保留回车和缩进。
// NBSP 避免小程序文本组件在真机上折叠连续空格；原始内容保持不变用于复制。
const JAVA_TOKEN = /\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:public|private|protected|static|final|class|interface|enum|void|int|long|short|byte|double|float|boolean|char|String|new|return|if|else|for|while|switch|case|break|continue|true|false|null|this|super|extends|implements|try|catch|finally|throw|throws|import|package)\b|\b\d+(?:\.\d+)?\b/g;
function tokenKind(v) {
  if (v.startsWith('//')) return 'comment';
  if (v.startsWith('"') || v.startsWith("'")) return 'string';
  if (/^\d/.test(v)) return 'number';
  return 'keyword';
}
function decorateCodeLine(line, index) {
  const tokens = [];
  let last = 0;
  let match;
  JAVA_TOKEN.lastIndex = 0;
  while ((match = JAVA_TOKEN.exec(line)) !== null) {
    if (match.index > last) tokens.push({ kind:'plain', value:line.slice(last,match.index).replace(/ /g, '\u00a0') });
    tokens.push({ kind:tokenKind(match[0]), value:match[0].replace(/ /g, '\u00a0') });
    last = JAVA_TOKEN.lastIndex;
  }
  if (last < line.length) tokens.push({ kind:'plain', value:line.slice(last).replace(/ /g, '\u00a0') });
  if (!tokens.length) tokens.push({ kind:'plain', value:'\u00a0' });
  return { no: index + 1, tokens:tokens.map((t,i)=>({...t,key:i})) };
}
function prepareBlocks(blocks) {
  let imageIndex = 0;
  return (blocks || []).map(block => {
    if (block.type === 'code') {
      const normalized = String(block.content || '').replace(/\r\n?/g, '\n');
      const rawLines = normalized.split('\n').map(line => line.replace(/\t/g, '    '));
      const lines = rawLines.map(decorateCodeLine);
      // 给横向滚动区显式宽度，规避部分真机不支持 width:max-content 的情况。
      const columns = line => Array.from(line).reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? 2 : 1), 0);
      const longest = rawLines.reduce((length, line) => Math.max(length, columns(line)), 0);
      const codeWidth = Math.max(620, Math.min(8000, 105 + longest * 15));
      return { ...block, content: normalized, codeLines:lines, codeLineCount:lines.length, codeWidth };
    }
    if (block.type === 'image') return { ...block, imageIndex: ++imageIndex };
    return block;
  });
}

Page({
  data: {
    note: null,
    isFavorite: false,
    isAdmin: false,
    id: '',
    loading: true,
    loadError: '',
    imageCount: 0
  },
  onLoad(options) { this.setData({ id: options.id || '' }); },
  onShow() { this.refresh(); },
  async refresh() {
    // 重新验证权限时不沿用前一次可能含私人草稿的页面内容。
    this.setData({ loading: true, loadError: '', note: null, isAdmin: false });
    try {
      const note = await cloud.getNote(this.data.id);
      const isAdmin = cloud.role();
      const blocks = prepareBlocks(note.blocks);
      const imageCount = blocks.filter(b => b.type === 'image').length;
      store.recordHistory(note.id);
      this.setData({
        note: { ...store.decorate(note), blocks },
        isFavorite: store.isFavorite(note.id),
        isAdmin,
        imageCount,
        loading: false
      });
    } catch (error) {
      const raw = String(error.message || '');
      const safeMessage = /无权限|不存在|找不到/.test(raw)
        ? '笔记不存在，或当前微信账号没有查看权限'
        : '笔记暂时加载失败，请检查网络后重试';
      this.setData({ note: null, loading: false, loadError: safeMessage, isAdmin: false });
    }
  },
  previewImage(e) {
    if (!this.data.note) return;
    const current = e.currentTarget.dataset.src;
    const urls = this.data.note.blocks
      .filter(block => block.type === 'image')
      .map(block => block.displayUrl || block.content)
      .filter(Boolean);
    if (!urls.length) return;
    wx.previewImage({ current: current || urls[0], urls });
  },
  copyCode(e) {
    const index = Number(e.currentTarget.dataset.index);
    const part = this.data.note && this.data.note.blocks[index];
    const code = part && part.type === 'code' ? part.content : '';
    wx.setClipboardData({ data: code, success: () => wx.showToast({ title: '代码已复制', icon: 'none' }) });
  },
  copyMarkdown() {
    const note = this.data.note;
    if (!note) return;
    wx.setClipboardData({
      data: noteToMarkdown(note),
      success: () => wx.showToast({
        title: this.data.imageCount ? '已复制，图片仅保留云端引用' : 'Markdown 已复制',
        icon: 'none',
        duration: 2200
      })
    });
  },
  toggleFavorite() {
    if (!this.data.note) return;
    const isFavorite = store.toggleFavorite(this.data.id);
    this.setData({ isFavorite });
    wx.showToast({ title: isFavorite ? '已收藏' : '已取消收藏', icon: 'none' });
  },
  editNote() {
    if (!this.data.isAdmin || !this.data.note) return;
    wx.navigateTo({ url: '/pages/editor/editor?id=' + encodeURIComponent(this.data.id) });
  },
  deleteNote() {
    if (!this.data.isAdmin || !this.data.note) return;
    wx.showModal({
      title: '删除这篇云端笔记？',
      content: '删除后暂时无法恢复，请先备份重要内容。',
      success: async result => {
        if (!result.confirm) return;
        try {
          await cloud.deleteNote(this.data.id);
          wx.showToast({ title: '已删除' });
          setTimeout(() => wx.redirectTo({ url: '/pages/index/index' }), 350);
        } catch (error) {
          wx.showModal({ title: '删除失败', content: error.message || '云端操作失败', showCancel: false });
        }
      }
    });
  },
  exportCard() {
    const note = this.data.note;
    if (!note) return;
    wx.showLoading({ title: '生成知识卡片' });
    wx.createSelectorQuery().select('#posterCanvas').fields({ node: true, size: true }).exec(result => {
      const el = result && result[0];
      if (!el || !el.node) {
        wx.hideLoading(); wx.showToast({ title: '生成图片失败', icon: 'none' }); return;
      }
      const canvas = el.node;
      const ctx = canvas.getContext('2d');
      canvas.width = 750; canvas.height = 1080;
      ctx.fillStyle = '#f6f7f1'; ctx.fillRect(0, 0, 750, 1080);
      ctx.fillStyle = '#ecf2e9'; roundRect(ctx, 43, 43, 664, 990, 35); ctx.fill();
      ctx.fillStyle = '#fff'; roundRect(ctx, 60, 60, 630, 950, 24); ctx.fill();
      ctx.fillStyle = '#60896a'; ctx.font = 'bold 26px sans-serif'; ctx.fillText('下周七集 / 知识卡片', 94, 122);
      ctx.fillStyle = '#22563b'; ctx.font = '24px sans-serif'; ctx.fillText(note.category, 94, 183);
      ctx.fillStyle = '#1e3227'; ctx.font = 'bold 40px sans-serif';
      const title = wrapLines(ctx, note.title, 548, 3);
      title.forEach((line, i) => ctx.fillText(line, 94, 255 + i * 55));
      let y = 255 + title.length * 55 + 30;
      ctx.fillStyle = '#7d8b83'; ctx.font = '25px sans-serif';
      const bodyText = note.blocks.filter(b => b.type === 'text').map(b => b.content).join('\n').slice(0, 380);
      const lines = wrapLines(ctx, bodyText, 550, 13);
      lines.forEach((line, i) => ctx.fillText(line, 94, y + i * 43));
      y += lines.length * 43 + 48;
      const code = note.blocks.find(b => b.type === 'code');
      if (code && y < 750) {
        ctx.fillStyle = '#f1f4f2'; roundRect(ctx, 86, y - 12, 576, Math.min(240, 870 - y), 15); ctx.fill();
        ctx.fillStyle = '#436d52'; ctx.font = '21px monospace';
        wrapLines(ctx, code.content, 525, Math.max(0, Math.floor(Math.min(210, 850 - y) / 32)))
          .forEach((line, i) => ctx.fillText(line, 103, y + 24 + i * 32));
      }
      ctx.fillStyle = '#8b9b8b'; ctx.font = '22px sans-serif';
      ctx.fillText('由 下周七集 生成 · 个人知识分享', 94, 961);
      wx.canvasToTempFilePath({
        canvas, fileType: 'png', quality: 1,
        success: result => {
          wx.hideLoading();
          wx.saveImageToPhotosAlbum({
            filePath: result.tempFilePath,
            success: () => wx.showToast({ title: '已保存到相册' }),
            fail: () => wx.showModal({
              title: '图片已生成',
              content: '保存相册未完成，请检查微信的相册权限后重试。',
              showCancel: false
            })
          });
        },
        fail: () => { wx.hideLoading(); wx.showToast({ title: '导出失败', icon: 'none' }); }
      });
    });
  }
});
