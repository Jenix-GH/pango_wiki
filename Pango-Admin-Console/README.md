# Pango 运营中控台

供内部管理员使用。控制台自带 Node 数据服务，直接读取 MySQL，不依赖 Java 管理接口；浏览器不会接触数据库账号或密码。所有数据接口都要求先使用固定管理员账号登录。

## 数据库账号建议

建议创建专用账号，只授予业务库的查询权限，以及反馈和 License 状态字段的更新权限。不要使用 MySQL `root`。

```sql
CREATE USER 'pango_console'@'控制台电脑IP' IDENTIFIED BY '替换为随机长密码';
GRANT SELECT ON agent_db.* TO 'pango_console'@'控制台电脑IP';
GRANT UPDATE (`status`, `processing_progress`, `uptime`) ON agent_db.dto_feedback TO 'pango_console'@'控制台电脑IP';
GRANT UPDATE (`status`, `uptime`) ON agent_db.dto_license_application TO 'pango_console'@'控制台电脑IP';
FLUSH PRIVILEGES;
```

请按照实际数据库名和控制台来源 IP 调整以上 SQL。

## 配置文件

复制示例配置：

```powershell
Copy-Item config/database.env.example config/database.env
```

然后编辑 `config/database.env`：

```text
PANGO_DB_HOST=数据库地址
PANGO_DB_PORT=3306
PANGO_DB_NAME=agent_db
PANGO_DB_USER=pango_console
PANGO_DB_PASSWORD=数据库密码
PANGO_PUBLIC_ORIGIN=https://aiapp.pangomicro.com
ADMIN_CONSOLE_HOST=127.0.0.1
ADMIN_CONSOLE_PORT=3100
ADMIN_CONSOLE_USER=pango_admin
ADMIN_CONSOLE_PASSWORD_HASH=使用下方脚本生成
ADMIN_CONSOLE_SESSION_HOURS=12
ADMIN_CONSOLE_COOKIE_SECURE=false
```

生成固定账号所需的随机密码和密码哈希：

```bash
node scripts/generate-admin-credentials.mjs pango_admin
```

将输出的 `ADMIN_CONSOLE_USER`、`ADMIN_CONSOLE_PASSWORD_HASH` 写入 `config/database.env`。脚本同时输出一次首次登录密码，请单独安全保存；配置文件中不保存明文密码。

`config/database.env` 已加入 `.gitignore`，不得强制提交。需要读取其他位置的文本文件时，可以执行：

```powershell
node server.mjs --config D:\secure\pango-console.env
```

## 开发运行

安装依赖并启动：

```powershell
npm install
npm run dev
```

浏览器打开 `http://127.0.0.1:3100`。`npm run dev` 会同时启动 Vite（3100）和本地数据库服务（3101）。
本地数据库服务会监听 `server.mjs` 的修改并自动重启；如果从旧版本升级后服务仍在运行，请先停止旧进程，再重新执行 `npm run dev`。

## 构建后运行

```powershell
npm run build
npm start
```

浏览器打开 `http://127.0.0.1:3100`。构建模式下由 `server.mjs` 同时托管静态页面和 `/local-api`。

## 上传并部署到服务器

仓库提供 Windows PowerShell 部署脚本。首次使用先创建本地部署配置：

```powershell
Copy-Item deploy/upload-admin-console.example.psd1 deploy/upload-admin-console.psd1
notepad deploy/upload-admin-console.psd1
```

填写 SSH 服务器、账号、管理后台远端目录和 PM2 进程名后，可以直接双击：

```text
deploy/upload-admin-console.cmd
```

首次双击时，CMD 会自动复制配置模板并打开记事本；保存配置后再次双击即可上传部署，不需要传入参数。也可以从 PowerShell 执行底层脚本：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File deploy/upload-admin-console.ps1
```

脚本会先执行本地测试和构建，再上传源码压缩包。`config/`、`node_modules/`、`dist/`、`tests/`、`deploy/`、`.env*`、Python 缓存和日志不会进入源码压缩包；`deploy-admin-console.sh` 会作为本次远端部署入口单独上传。远端会在临时目录安装依赖、构建，并检查现有 PM2 工作目录。

随后复制服务器原 `config/` 到临时版本，检查 License 九张工作流表。缺表时先使用服务器上的 `mysqldump` 备份现有数据库，再仅补建缺失表；已有表缺必要字段、邮件唯一索引或不是 InnoDB 时停止，不擅自修改。备份失败或数据库账号没有建表权限时不会切换代码。MySQL `max_allowed_packet` 至少 16 MB。此脚本不执行 Java 个人中心的 ALTER 迁移，不修改申请数据或历史状态。

检查成功后只在新版本配置中设置 `LICENSE_DELIVERY_ENABLED=true`、`LICENSE_SEND_ENABLED=false`，其他配置保留。切换目录、重启配置指定的 PM2 进程，并核对实际网页及认证接口；检查失败恢复原代码及配置，新增数据库表保留。成功后也保留 `.pango-admin-backup-<发布编号>`（原工程及配置）；数据库备份存放在同级 `.pango-admin-database-backup-<发布编号>/database.sql`。备份包含私有数据，应按原服务器权限管理及备份策略保管，代码回退时不要直接恢复旧数据库覆盖新增业务数据。

每次运行此入口均为准备模式，不安装或变更 cron，不发送邮件。若服务器已经开启 `LICENSE_SEND_ENABLED=true`，脚本会停止，需由运维先暂停新发送任务并关闭该开关，再部署。本次不改原 license-notify 任务。具体说明见 [自动部署与回滚](deploy/README.md)。

服务器现有远端目录必须提前准备好 `config/database.env`，部署账号需要具备该目录父目录的创建、移动权限，并能执行 `node`、`npm`、`pm2`、`flock`，缺表时还需要 `mysqldump` 及数据库备份/建表权限。不支持 PM2 自定义 `--config`、API-only 或集群启动方式，遇到这些配置会停止并提示人工核对。只验证本地打包内容、不连接服务器时可增加 `-DryRun`；确需跳过本地测试和构建时可增加 `-SkipLocalChecks`。

## 安全边界

- 数据库配置只由本地 Node 服务从 `config/database.env` 读取，不得写入前端代码或提交到 Git。
- 固定管理员密码使用 PBKDF2-SHA256 哈希保存，不得把首次登录密码写入项目文件。
- 登录会话使用 `HttpOnly`、`SameSite=Strict` Cookie；Node进程重启后需要重新登录。
- 同一来源15分钟内连续登录失败5次会锁定15分钟。
- 仅本机访问时使用 `ADMIN_CONSOLE_HOST=127.0.0.1`。需要通过服务器IP访问时可设为 `0.0.0.0`，同时必须使用防火墙限制3100端口来源。
- `http://服务器IP:3100` 没有传输加密，账号密码可能在网络中被截获。多人长期使用应配置HTTPS；启用HTTPS代理后将 `ADMIN_CONSOLE_COOKIE_SECURE=true`。
- 控制台不再使用 `ADMIN_CONSOLE_KEY`，也不调用 `/admin/console/**`。
- 反馈详情中的 Markdown 会在浏览器端净化后渲染。
- 模型回复图片和参考资料链接通过 `PANGO_PUBLIC_ORIGIN` 补全；业务数据仍直接来自 MySQL。

## 统计口径

- 所选时间段用户访问量：按界面指定的起止日期（含首尾两天），对 `dto_analytics_event` 中 `page_view` 的 `visitor_id` 去重。
- 所选时间段提问量：按相同起止日期直接统计 `dto_question`，并通过 `session_id` 的 `web_`、`mini_` 前缀区分终端。
- 所选时段新用户注册：在所选起止日期内统计 `dto_userinfo.user_type='USER'` 的记录，访客账号不计入。
- 所选时段提问终端分布：统计所选起止日期内的 `dto_question`，并按 `session_id` 的 `web_`、`mini_` 前缀区分终端。
- 问答记录：按所选起止日期读取 `dto_question` 并按 `session_id` 组织会话；会话详情关联 `dto_answer`，还原用户问题、上传图片、Markdown 回答、模型图片及参考资料。没有会话标识的历史问题按单条独立会话展示。
- 问答记录导出：在问答记录页按当前起止日期生成 ZIP。压缩包中的 `README.md` 提供会话索引，`sessions/` 按每个会话保存完整 Markdown，`assets/` 保存用户上传图片和能够安全获取的同源模型配图；配图获取失败时 Markdown 会保留在线地址。
- 反馈问答复现：使用反馈快照渲染问题和回复，并按用户、会话、问题内容定位原回答的图片与参考资料；Markdown 换行和引用图片插入直接复用 Web 端共享逻辑。

## License 批量上传与自动发放

发信使用两套 SMTP 配置：`LICENSE_MAIL_ENV` 为平台邮箱，只向 `LICENSE_FAE_EMAIL` 发汇总；`LICENSE_FAE_MAIL_ENV` 为 FAE 邮箱，向客户发送 License 和拒绝说明。也可在“License 发放 → 邮件设置与测试”直接保存 FAE 邮箱与 SMTP 凭据，此时保存的同一地址同时用于接收平台通知和给客户发信，优先于文件配置。缺少 FAE 账号时不会用平台账号代发；已保存密码加密存储且不回显。页面支持编辑模板、插入变量、预览和单封测试发送。完整说明见 `deploy/mail-accounts.md`。

新增“License 发放”页面：支持 `new_pds_<12位MAC>.lic` 多文件上传、匹配异常处理、暂停/取消、发送记录及结果核查。每天北京时间 09:00 汇总待办给 FAE，20:00 自动逐封发送客户附件。

该功能默认关闭。先依次迁移 `database/20260923_license_delivery.sql` 、`database/20260923_license_workflow.sql` 、`database/20260924_license_manual_status.sql` 和 `database/20260928_license_cc.sql`，按 `config/database.env.example` 配置，再安装服务器计划任务。发送程序复用已有 SMTP `.env`；准备模式不发真实邮件。

完整上线、权限、定时任务、回退和测试说明见完整仓库的 `docs/license-delivery-deployment.md`。申请状态为待处理、处理中、已处理、已拒绝：FAE 邮件发送成功后进入处理中，文件上传并匹配后进入已处理。拒绝理由必填，说明邮件在 20:00 队列中发送。支持提交日期与申请状态组合筛选；业务状态和邮件发送结果分别记录。四状态也支持人工下拉设置，修改留痕；选择拒绝仍需填写理由。历史状态迁移请参考部署说明。

客户个人中心、两端登录要求和官网提交标记的升级步骤见 [`docs/license-portal-deployment.md`](../docs/license-portal-deployment.md)。需要额外执行一次 Java 目录中的增量迁移。
