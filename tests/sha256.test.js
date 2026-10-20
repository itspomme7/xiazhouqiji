const assert=require('assert');
const crypto=require('crypto');
const sha=require('../utils/sha256');
for(const input of [Buffer.alloc(0),Buffer.from('abc'),Buffer.from('下周七集'),crypto.randomBytes(2*1024*1024)]) {
  const expected=crypto.createHash('sha256').update(input).digest('hex');
  assert.strictEqual(sha.sha256Bytes(input),expected);
  if(input.length)assert.strictEqual(sha.sha256Base64(input.toString('base64')),expected);
}
assert.throws(()=>sha.sha256Base64('%%%'),/不完整/);
for(const text of ['', 'ASCII text', '大中文笔记：下周七集', 'emoji 🚀🍎']) {
  assert.strictEqual(sha.sha256Text(text),crypto.createHash('sha256').update(text,'utf8').digest('hex'));
}
console.log('SHA256 测试通过：空内容、ASCII、中文和 2MB 二进制均与 Node crypto 一致。');
