# GitHub Desktop：把完整源码推送到已创建的公开仓库

仓库：https://github.com/itspomme7/xiazhouqiji

> 仓库已经是 Public（公开）。请先确认没有个人密钥、管理员 OpenID、个人导出数据或私人照片再提交。不要误将整个备份 JSON 上传。

1. GitHub Desktop 登录 **itspomme7**。
2. File → Clone repository → URL，粘贴 https://github.com/itspomme7/xiazhouqiji.git，选择电脑保存位置并 Clone。
3. 解压本 ZIP，把解压后目录里的所有源码文件和文件夹（例如 `app.js`、`app.json`、`pages`、`assets`、`cloudfunctions`、`utils`、`tests`、`AGENTS.md`）复制进刚克隆的 `xiazhouqiji` 文件夹。不要覆盖 `.git` 文件夹，源 ZIP 不含 `.git`。
4. 回 GitHub Desktop，确认 Changes 里的改动都属于小程序源码。检查是否不包含 `project.private.config.json`、`.env`、个人 OpenID、密钥或笔记备份；有的话先移出并取消提交。
5. Summary 填 `chore: import Xiazhouqiji v1.0.0 source`，点击 Commit to main，再 Push origin。
6. 浏览器刷新 GitHub 仓库，能看到 `pages/`、`cloudfunctions/` 和 `tests/` 才代表源码上传完成。

之后 Codex 首先应读 `AGENTS.md`，完成只读代码审查；不自动改生产云数据库、部署云函数或发布版本。
