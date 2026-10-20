const store = require('./utils/store');
const CLOUD_ENV_ID = 'xiazhouqiji-d7ghp2ay97005e3b3';
App({
  onLaunch() {
    store.initialize();
    if (wx.cloud) {
      wx.cloud.init({ env: CLOUD_ENV_ID, traceUser: true });
    }
  },
  globalData: { version: '1.0.0', cloudEnvId: CLOUD_ENV_ID }
});
