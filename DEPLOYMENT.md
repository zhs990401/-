# 用 Render 部署中国港湾账目核对平台

本项目提供 `render.yaml`，使用 Gunicorn 运行无需账号密码的公开网页。任何知道网址的人都可以打开并使用核对功能。部署文件不会自动创建网站。

## 首次部署

1. 登录 https://dashboard.render.com/ ，连接 GitHub 仓库 `zhs990401/-`。
2. 点击 **New → Blueprint**，选择仓库和 `main` 分支，Render 会读取 `render.yaml`。
3. 检查服务和费用后开始部署。配置指定 `plan: free`，可用性及限制以平台页面为准。
4. 状态变为 **Live** 后打开 Render 提供的 HTTPS 地址，直接使用，无需登录。

不需要设置 `APP_USERNAME` 或 `APP_PASSWORD`。旧服务即使保留这两个变量，新版本也不再使用它们；可以在 Render 的 Environment 页面删除。

## 已有网站更新

GitHub `main` 更新后，Render 自动部署（需开启自动部署）。也可在服务页面点击 **Manual Deploy → Deploy latest commit**。等待 **Live** 后刷新网页并重新导入账表。核对页面不是历史结果存储，更新后需要重新运行核对。

## 手动创建 Web Service

- Branch：`main`；Language / Runtime：Python 3；Root Directory：留空。
- Build Command：`pip install --no-cache-dir -r requirements-deploy.txt`
- Start Command：`gunicorn --config gunicorn.conf.py 'webapp:create_app()'`
- Health Check Path：`/api/health`
- 环境变量：`PYTHON_VERSION=3.12.14`。端口由 Render 的 `PORT` 注入。

## 处理与使用范围

上线后文件通过 HTTPS 上传到托管服务进程中处理。程序不将账表写入磁盘或数据库，也不发送到外部分析服务；下载的报告和工作包由使用者自行保管。没有用户账号、访问控制、历史账表查询或多用户角色。

每个进程同时处理一项财务请求，忙时返回稍后重试。保留请求大小限制、跨站请求拦截与禁止缓存响应。大文件可按期间、账户或项目拆分。免费实例可能休眠，首次打开需要等待唤醒。

## 验证

`.venv/bin/python -m unittest discover -s tests -v` 包含无账号启动、公开网页和模板、无需认证的实际核对请求、跨站请求拦截、大小限制和并发忙状态。

`.venv/bin/python scripts/hosting_smoke.py` 用实际 Gunicorn 命令在没有账号密码的情况下启动，再执行完整浏览器核对与导出回归。需要安装 Playwright 和 `/usr/bin/chromium`。

本地测试通过不代表 Render 已完成部署；应核对 Render 的提交号与 Live 状态。
