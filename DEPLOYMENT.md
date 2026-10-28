# 用 Render 部署中国港湾账目核对平台

本项目提供 `render.yaml`。它会创建一个带访问密码的 Python Web Service，使用 Gunicorn 运行。需要由你在 Render 注册并连接 GitHub 才能真正上线；准备或推送部署文件不会自动创建网站。

## 网页操作步骤

1. 打开 https://dashboard.render.com/ ，使用 GitHub 注册/登录。按平台提示完成必要的账号验证。
2. 在 Render 允许连接你的 GitHub 仓库 `zhs990401/-`；可以只授权该仓库。
3. 在 Render 点击 **New + → Blueprint**，选择 `zhs990401/-`，分支选 **main**。Render 会读取仓库中的 `render.yaml`。
4. 按提示填写以下两项环境变量。它们是**你的网站访问账号与密码**，不是 GitHub 或 Render 的登录密码：

   | 变量名 | 填什么 |
   | --- | --- |
   | `APP_USERNAME` | 自己取一个访问用户名，不包含冒号 |
   | `APP_PASSWORD` | 自己设置至少 16 个字符的新密码，建议使用密码管理器生成 |

   密码只填在 Render 设置页，不要提交到 GitHub，也不要发到聊天里。没有这两个变量，线上入口会拒绝启动。

5. 检查创建页面中的服务与费用。配置指定 `plan: free`，免费档是否可用及具体限制以平台页面为准；不会由本项目配置自动选择付费档。点击平台显示的 **Apply / Deploy** 开始部署。
6. 服务显示 **Live** 后，打开 Render 提供的 **HTTPS 网站地址**。浏览器会弹出账号密码窗口，填写上面设置的 `APP_USERNAME` 和 `APP_PASSWORD`，即可使用核对网页。
7. 先点击各功能的“银行示例”“多项目示例”“现金流示例”完成核对和 Excel 报告下载，确认功能正常后再按你的数据管理要求使用实际账表。

免费服务可能闲置休眠，首次打开需要等待唤醒。新账号可能有额外验证步骤，具体以平台提示为准。遇到失败可提供错误文字或截图，截图里遮住密码、密钥、完整账号和实际财务明细。

## 如果没有找到 Blueprint

也可以点击 **New + → Web Service**，连接同一仓库，手动填写：

| 项目 | 配置 |
| --- | --- |
| Branch | `main` |
| Language / Runtime | Python 3 |
| Root Directory | 留空 |
| Build Command | `pip install --no-cache-dir -r requirements-deploy.txt` |
| Start Command | `gunicorn --config gunicorn.conf.py 'webapp:create_app()'` |
| Health Check Path | `/api/health` |
| Instance Type | 按平台页面选择可用免费档，或自行决定其他档位 |

在 **Environment** 中添加 `PYTHON_VERSION=3.12.14`、`APP_USERNAME` 和 `APP_PASSWORD`。端口由平台的 `PORT` 注入，不需要手动填写。

## 上线后的使用范围

- 当前是单个访问账号，浏览器使用 HTTP Basic 登录；应始终使用平台的 HTTPS 地址。它不是具有多人角色、审批和操作留痕的财务系统。
- 上线后，文件会经 HTTPS 上传到你的 Render 服务进程处理。程序不会将账表写入磁盘或数据库，也不会发送给其他分析服务；页面刷新后需要重新上传。下载的报告由你自行保存。
- 访问密码通过 Render 环境变量配置。修改后平台会重新启动服务；浏览器的旧登录凭据可能需要关闭窗口后重新输入。共用电脑上建议使用独立的无痕窗口，用完关闭全部相关无痕窗口。
- 每个进程同时处理一项财务请求，忙时会提示稍后重试。大文件可以按期间、项目或账户拆分；不要把免费实例当作批量多人并发服务。
- `/api/health` 公开返回服务健康状态，不返回财务数据；网页、静态资源、上传、核对和报告导出都要求登录。
- 更新 GitHub 代码后，按 Render 的自动部署或手动部署设置更新网站。不要把实际账表、网站密码或 `.env` 文件上传到仓库。

## 已验证与尚未验证

`tests/test_hosting.py` 验证访问保护、未登录拒绝、跨站请求拦截、文件大小限制、并发忙状态及实际核对接口。`scripts/hosting_smoke.py` 用临时且不打印的凭据启动真实 Gunicorn 命令，再运行完整浏览器测试。

当前本机部署命令的验证不等于 Render 已经部署成功。只有在你连接平台并创建服务后，才能验证实际 HTTPS 地址、平台构建、休眠唤醒及实际资源限制。
