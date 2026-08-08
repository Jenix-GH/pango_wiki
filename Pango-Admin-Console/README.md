# Pango 运营中控台

供内部管理员使用。控制台自带 Node 数据服务，直接读取 MySQL，不依赖 Java 管理接口；浏览器不会接触数据库账号或密码。所有数据接口都要求先使用固定管理员账号登录。

## 数据库账号建议

建议创建专用账号，只授予业务库的查询权限，以及反馈和 License 状态字段的更新权限。不要使用 MySQL `root`。

```sql
CREATE USER 'pango_console'@'控制台电脑IP' IDENTIFIED BY '替换为随机长密码';
GRANT SELECT ON agent_db.* TO 'pango_console'@'控制台电脑IP';
GRANT UPDATE (`status`, `uptime`) ON agent_db.dto_feedback TO 'pango_console'@'控制台电脑IP';
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
- 反馈问答复现：使用反馈快照渲染问题和回复，并按用户、会话、问题内容定位原回答的图片与参考资料；Markdown 换行和引用图片插入直接复用 Web 端共享逻辑。
