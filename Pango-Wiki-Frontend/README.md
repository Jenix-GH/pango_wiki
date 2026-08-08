# Pango 智能问答与器件 Wiki Web 前端

本目录是 React 18、TypeScript 和 Vite 实现的统一 Web 客户端，包含智能问答、器件 Wiki、在线文档阅读、用户登录、License 申请和使用说明。业务接口由仓库中的 `agent_ai/` Java 服务提供；Wiki 目录、PDF 阅读器和文档资源由独立 Wiki 服务提供。

## 页面路由

- `/`：智能问答。支持登录/访客、历史会话、流式回答、图片提问、回答配图、参考资料、评价和反馈。
- `/login`：注册、登录、短信验证码及密码重置入口。
- `/docs`：响应式器件文档中心；桌面端使用目录栏和表格，移动端使用抽屉与卡片布局。
- `/docs/reader`：统一在线阅读外壳。桌面端保留站点顶部导航和“边看边问”，内部加载 Wiki 阅读器；小程序模式使用 `client=miniprogram`。
- `/license-application`：License 申请。
- `/user-guide`：读取部署目录中的 `/pango_huida_user_guide.md` 并显示使用说明。

## 智能问答

- 浏览器请求 `/dbServ/dialogue/stream-answer`，由 Java 后端完成用户校验、访客额度扣减和模型请求代理；前端不直接持有模型服务凭据。
- 页面首次进入或刷新会创建新的 `session_id`；主动新建会话也会生成新 ID；从历史记录进入时恢复对应会话 ID。
- 流式内容通过双缓冲队列平滑显示，支持进度帧、增量答案和最终结果帧。
- 问题和答案由 Java 流式代理统一持久化：问题在请求模型前写入，模型终帧返回后由 Java 汇总正文、参考资料 JSON 和 `answer_media` 并写入答案记录；正常完成的回答不再依赖前端额外保存成功。
- 参考资料跳转到 `/docs/reader`，保留回答生成时实际引用的文档及页码，不按文件名重新匹配最新版本。
- 回答图片仅接受同源 `/references/figures/` 地址；根据 `citation_label` 插入到正文对应 `<sup>...</sup>` 脚标之后，无法匹配时在答案末尾兜底显示。
- Markdown 渲染支持 GFM 表格、数学公式、原始 HTML、代码块，并统一处理标题/表格间距和引用脚标后的换行。
- 访客 50 次额度以 Java 后端原子扣减结果为准，前端显示剩余额度但不是安全边界。

## Wiki 能力

- 目录和文档列表来自 `/wiki/api/catalog`，前端不写死知识库、产品系列或文档类型。
- 支持递归目录、搜索、目录筛选、类型筛选、排序、当前版本、历史版本和文档详情。
- 支持后端返回的 `source_type`、`action_type`、`action_label` 和 `action_disabled`，以区分在线阅读、下载和不可用状态。
- 桌面端可在线阅读或下载可用文档；移动端优先保留在线阅读和文档信息。
- 在线阅读和下载只接受白名单中的同源 `/references/*` 路径，浏览器不保存 Wiki/RAGFlow/存储服务凭据。
- Wiki 在线阅读页保留统一 Banner 和“边看边问”浮窗。阅读器内部返回 `/docs` 时由外层路由接管，避免页面和 Banner 重复嵌套。
- 小程序通过 `/docs?client=miniprogram` 和 `/docs/reader?...&client=miniprogram` 复用 Web 页面，并通过 WebView 返回原生问答页。

## 访问统计

- Web 在路由变化后向 `/dbServ/analytics/track` 上报经过白名单校验的页面和业务事件。
- 当前事件包括页面访问、Wiki 访问、文档阅读/下载、参考资料打开、回答图片查看和使用说明查看。
- 请求使用当前登录用户或后端访客 Token；`userinfo_id` 和 `visitor_id` 由 Java 根据 Token 确定，前端不能指定。
- 提问提交、模型成功和模型失败由 Java 对话代理直接记录，避免只依赖浏览器上报。
- 统计数据保存在 `dto_analytics_event`，用户端不展示统计结果。内部查看和处理入口位于仓库根目录的 `Pango-Admin-Console/`。

## 目录结构

```text
src/
  api/          Java 业务接口、流式请求及类型
  components/   顶部栏、消息气泡、Markdown、Wiki 助手等复用组件
  contexts/     登录状态上下文
  hooks/        SSE/流式请求 Hooks
  pages/        路由页面
  utils/        引用 URL、媒体与通用工具
  wiki/         Wiki API、类型和目录/文档组件
```

## 本地开发

安装依赖并启动 Vite：

```bash
npm ci
npm run dev
```

默认访问地址为 `http://127.0.0.1:3000`。开发代理的默认目标是 `https://aiapp.pangomicro.com`，可通过环境变量覆盖：

- `VITE_DEV_BACKEND_ORIGIN`：旧的统一开发目标，作为聊天和 Wiki 目标的回退值。
- `VITE_DEV_CHAT_BACKEND_ORIGIN`：`/chat` 和 `/api/ragflow` 的开发代理目标。
- `VITE_DEV_WIKI_BACKEND_ORIGIN`：`/wiki/api` 和 `/references` 的开发代理目标。
- `VITE_CHAT_BASE_URL`、`VITE_CHAT_API_URL`：旧聊天接口兼容配置；当前主问答请求使用 `/dbServ/dialogue/stream-answer`。
- `VITE_DB_BASE_URL`：Java 业务接口前缀，默认 `/dbServ`。
- `VITE_WIKI_CATALOG_URL`：Wiki 目录接口，默认 `/wiki/api/catalog`。
- `VITE_REFERENCE_ORIGIN`：参考文档和回答图片的允许来源；为空时要求与页面同源。

如需调试本仓库 Java 后端，请在 `../agent_ai` 中准备 `application-dev.yml` 所引用的环境变量，然后运行：

```bash
mvn spring-boot:run -Pdev
```

独立 Wiki 服务不在本仓库中；本地联调时将 `VITE_DEV_WIKI_BACKEND_ORIGIN` 指向可用的 Wiki 服务。

## 构建与发布

```bash
npm run build
```

该命令先执行 TypeScript 检查，再由 Vite 生成 `dist/`。生产环境应将 SPA 静态资源与接口部署在同一 HTTPS 域名下，并确保 Nginx 的精确接口 location 位于 SPA fallback 之前：

```text
/dbServ/*     -> Java 业务服务（含鉴权、额度、历史和模型代理）
/wiki/api/*   -> Wiki 目录服务
/references/* -> PDF 阅读器、文档与回答图片服务
其他路径       -> Pango-Wiki-Frontend/dist/index.html
```

Java 服务向模型服务发起请求时会根据已校验的 JSON `session_id` 设置 `X-Session-Id`。若部署多个模型实例，可使用 `agent_ai/deploy/nginx-chat-upstream.conf` 中的一致性哈希示例保证同一会话落到同一实例。回答图片相关代理示例见 `agent_ai/deploy/nginx-answer-media.conf`。

只有模型对话上游需要基于 `X-Session-Id` 保持会话粘性。`/wiki/api/`、普通 `/references/` 和 `/references/figures/` 可以使用轮询或 `least_conn`；前提是 Wiki 实例使用一致的数据源，图片实例使用共享存储或已经同步相同文件。浏览器图片请求不会自动携带 `X-Session-Id`，因此不能依靠对话粘性寻找仅存在于单台模型机器上的图片。

发布访问统计前，现有数据库需执行 `agent_ai/database/migrations/20260804_add_analytics_event.sql`。Java 服务还可配置 `ADMIN_CONSOLE_KEY`，供本地管理控制台通过 `/dbServ/admin/console/**` 查询统计、反馈和 License 申请；该密钥不得进入用户端前端代码。

## 发布检查

- 执行 `npm run build`。
- 验证问答刷新后创建新会话、历史会话恢复、访客额度和 SSE 流式输出。
- 验证回答引用、回答图片、图片放大和指定页在线阅读。
- 验证在线阅读返回后不会嵌套第二个 Banner。
- 验证 Wiki 桌面端、移动端及真实微信 WebView。
- 新增域名或路径时同步检查 Nginx、HTTPS、CORS/CSP 和微信业务域名/下载域名配置。
- 验证 `dto_analytics_event` 能写入 Web、小程序和 Java 自动记录的事件；管理接口必须拒绝缺失或错误的 `X-Admin-Key`。

## 系统边界

- 本仓库包含 Web、小程序、本地管理控制台和 Java 业务后端；模型服务及独立 Wiki 服务不在本仓库中。
- 数据库初始化和增量脚本位于 `agent_ai/database/`。已部署数据库应按顺序执行迁移脚本，不应重复执行或修改已执行的迁移。
- 服务端是鉴权和访客额度的最终安全边界；客户端限制仅用于交互提示。
