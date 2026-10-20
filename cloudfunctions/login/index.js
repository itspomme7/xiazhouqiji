// 第一步：微信云开发身份识别，尚不处理数据库写入。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async () => {
  // OPENID 仅来自微信云函数上下文，不相信小程序传来的用户 ID。
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, message: '未能取得微信身份，请使用正式 AppID 测试' };
  // 尚未在云函数中设置 ADMIN_OPENID 时，所有人都不是管理员。
  const configured = (process.env.ADMIN_OPENID || '').trim();
  const isAdmin = !!configured && OPENID === configured;
  return { ok: true, openid: OPENID, isAdmin, adminConfigured: !!configured };
};
