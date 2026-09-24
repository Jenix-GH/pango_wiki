# License 个人中心与登录要求（2026-09-24）

本次改动包含 Web、小程序、Java 后台及管理后台。源码尚未部署到生产环境，不会自动执行迁移或发送邮件。

## 用户行为

- Web、小程序均需登录才能提交申请；小程序通过现有 `/wx/getPhone` 手机号授权建立账户。
- 未登录时可先填写，点击提交引导登录，返回后保留填写内容。Web 跨登录页草稿放在当前标签页的 sessionStorage，最长保留 1 小时，恢复时移除；小程序保留原申请页实例。
- 新增“是否已在官网提交”。选择“是”显示“正在加急处理中，请勿重复提交”，仍允许提交，保存布尔标记。
- 两端个人中心/设置增加“我的 License 申请”，申请页另有快捷入口。显示本人申请、时间、软件版本、授权信息、MAC、官网标记、四种状态和拒绝理由，支持翻页、刷新、下载。
- 文件匹配成功后即允许本人下载，不必等晚间邮件。手动设为“已处理”但没有文件，不显示下载按钮。
- 下载不改变申请或邮件状态，不影响原有每日 09:00 汇总和 22:00 发放任务。
- 小程序先下载二进制到本地，然后由用户点击“保存 / 转发文件”；手机端通过微信文件分享导出。代码不把 `.lic` 当作可预览文档。旧版本不支持时提示升级或使用 Web。

## 数据和权限

`dto_license_application` 新增：

- `official_submitted`：新申请由两端提交 true/false；旧申请为 NULL，显示“未记录”。
- `owner_verified`：默认 0，只有服务端认证后的新申请写入 1。提交时忽略前端提供的用户 ID，由登录凭证确定 `userinfo_id`。
- `idx_license_owner`：本人申请分页查询索引。

旧申请不会删除、更换 ID、重置状态或更改文件/邮件关联。由于旧接口允许客户端自行传用户 ID，历史记录不直接开放给个人中心。本次不提供自动认领或后台关联界面；如需补关联，必须另行核实身份和原申请记录，不能仅按用户自行填写的邮箱/手机号批量认领。

客户下载校验：本人且归属已认证、状态不是拒绝、有效文件唯一、文件名和 MAC 相符、匹配时申请快照仍一致、无新增文件/申请歧义、长度和 SHA-256 完整性通过。文件处于冲突、未匹配、暂停、发送中、待核查、取消或重复状态时不开放。人工核实选定的匹配可处理同 MAC 多条申请。

## 接口

接口均位于 `/dbServ/license/application`，要求 `Authorization: Bearer <用户 token>`；访客或过期凭证返回 HTTP 401。

- `POST /submit`：原字段 + 必填 `officialSubmitted`，服务器设置归属和初始状态。
- `GET /mine?page=1`：每页 20 条，返回 `records,total,page,pageSize`；记录包含 `canDownload,filename,rejectionReason`。
- `GET /{申请ID}/download`：返回附件二进制，不存在/无权限返回 404，损坏返回 409。禁止缓存，不暴露管理后台 Cookie 接口或数据库存储路径。

## 已有服务器升级顺序

1. 备份现有数据库和四个模块的当前版本，保留生产配置。
2. 若尚未安装 License 发放功能，先按 `docs/license-delivery-deployment.md` 完成管理后台的三个增量迁移。它们创建发放/邮件/拒绝等表，不要对已有数据库重跑 `agent_ai/database/schema.sql`。
3. **仅执行一次** `agent_ai/database/migrations/20260924_license_portal.sql`。这是 ALTER TABLE 增量迁移，不清空旧数据。新装数据库若已执行含新字段的 schema.sql，不再执行这份 ALTER。
4. 确保 Java 数据库账户对申请表有 SELECT/INSERT 权限，对 `dto_license_file`、`dto_license_mail`、`dto_license_rejection` 有 SELECT 权限；无需给客户开放管理后台。
5. 从 `agent_ai` 执行 `mvn clean package -Pprod`，用服务器现有配置发布 Java 后台。源码包不含生产凭证，不能用本地测试配置覆盖服务器配置。
6. 从 `Pango-Wiki-Frontend` 执行 `npm ci && npm run build`，发布 `dist`。Nginx 的 SPA 路由回退应覆盖 `/my-licenses`，`/dbServ/license/application/*` 转发给 Java 后台。
7. 从 `Pango-Admin-Console` 执行 `npm ci && npm run build` 并重启；申请表新增“官网已提交”列。现有定时任务和发送开关保持不变。
8. 在微信开发者工具打开 `miniprogram`，编译/预览、真机验收、审核发布。新页面已注册在 app.json。仍使用现有 baseHost；文件使用带 Bearer 的二进制 wx.request，需确保该 HTTPS 主机在 request 合法域名中。

后端先上线会拒绝旧版匿名申请，以及未提交新官网标记字段的旧客户端请求。安排两端协同上线；小程序审核期间应明确维护提示，避免让用户以为申请已提交。不要为了兼容旧版恢复匿名提交或信任客户端用户 ID。

## 验证

- Web：`npm run build`；本地模拟接口验证游客登录、草稿恢复、官网“是”仍提交、本人记录、下载、空状态和错误提示。
- Java：`mvn clean package -Pdev` 包含 Controller/认证测试。`LICENSE_MYSQL_TEST=1 mvn package -Pdev` 另启用专用 MySQL 集成测试，只连接 `host.docker.internal:13316/pango_license_test`，会清理该测试库的 License 数据；不得对生产执行。
- MySQL 集成测试前按管理后台 `LICENSE_MYSQL_TEST=1 npm run test:delivery:mysql` 建立专用测试表（其固定连接 127.0.0.1:13316 测试库）。
- 小程序：Web 依赖安装后在仓库根执行 `node --test miniprogram/tests/license_portal.test.cjs`，用模拟 wx API 检查登录拦截、官网标记、状态列表和下载错误隔离。原有全项目 TypeScript 存在错误，本次修改文件的独立类型检查通过。
- 必须真机验收：手机号授权/首次注册、授权取消、返回表单、账户切换、`.lic` 下载后转发到文件传输助手并在电脑保存。当前环境没有微信开发者工具，未进行这部分真实微信链路验证。

源码包是在现有仓库上的覆盖更新包，不是可单独启动的新项目；解压到临时目录，对照四个模块路径更新源代码并分别构建，不要覆盖服务器私有配置文件。
