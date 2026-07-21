# Pango 智能问答 + 器件 Wiki 独立前端

`web-wiki-version/` 是从现有 `web-version/` 复制出来的独立集成版。原始智能问答前端、FastAPI 问答入口、Agent Runtime 和 RAGFlow 检索逻辑均不需要修改。

## 页面

- `/`：现有 Pango慧答。
- `/login`：现有登录页。
- `/wiki`：响应式 Wiki；目录和文档类型完全由独立 Wiki 后端返回，桌面浏览器与手机/小程序 WebView 共用同一页面。
- `/wiki/preview`：转到 `/wiki`，与 PDF 阅读器的“返回器件文档”链接兼容。

Wiki 默认按“知识库 + 文档身份”分组，只在主列表展示当前版本，其余版本收入“历史版本”。同版本同时存在正式 PDF 与 `clean_pages` 处理副本时，正式 PDF 优先作为当前文档。本页不提供“针对本文提问”。

## 新版 Wiki 能力

- 左侧为后端配置驱动的递归目录，不再把知识库或 UG/DS 写死在前端。
- 当前同时展示“器件文档”和“软件文档”；`soft` 知识库显示为“PDS 软件应用指南”。
- PDS 文档自动进入用户指南、参考手册、快速入门等子目录。
- 支持搜索、目录筛选、类型筛选、最近更新排序、当前/历史版本和文档详情。
- “刷新目录”会绕过前后端缓存，立即重新读取 RAGFlow 的启用状态和文档列表。
- 新增知识库、修改显示名称或增加多级目录时，只改后端 YAML，前端无需重新构建。
- 手机端取消 1080px 桌面画布：目录改为抽屉、筛选标签支持横向滑动、文档表格自动切换为单列卡片。
- 手机选择新目录后主内容自动回到顶部；在线阅读仍使用后端返回的原始 `viewer_url`。
- 小程序以 `/wiki?client=miniprogram` 进入时，“智能问答”自动切换为“返回慧答”，优先返回并保留原生问答会话，无法返回时降级到 `/pages/main/main`。

小程序侧接入方式、WebView 示例和验收步骤见 [`MINIPROGRAM_WIKI_INTEGRATION.md`](./MINIPROGRAM_WIKI_INTEGRATION.md)；服务器替换、发布验收和回滚步骤见 [`DEPLOY_MOBILE_MINIPROGRAM.md`](./DEPLOY_MOBILE_MINIPROGRAM.md)。

## 问答与 Wiki 联动

问答结束包中的 `reference.chunks[].page_links[].document_page_url` 会被原样使用：

- “Wiki阅读”优先打开后端返回的 Wiki 阅读器 URL。
- “引用页”按钮保留 `dataset_id` / `document_id` / `page` / `display_page`。
- 只有原始文档链接而没有页码时，进入 Wiki 阅读器第 1 页，而不是打开裸 PDF。
- 不根据文件名重新匹配“最新版”，避免历史回答的证据页错位。
- 浏览器不直连 RAGFlow，也不会获得 RAGFlow API Key。
- 用户界面统一展示为 Pango 官方文档，不暴露底层知识库实现名称。
- 问答接口保持原协议，前端通过双缓冲打字机做平滑伪流式呈现；完整回答显示后再挂载参考文档。

回答引用与 Wiki 主目录承担不同职责：主目录展示当前正式版本；回答中的引用始终打开生成该答案时实际检索到的文档与页码。这样不会把旧答案强行跳到新版后产生证据错位。

## 本地开发

1. 如需同时调试智能问答，先在仓库根目录启动现有问答 FastAPI：

   ```bash
   uvicorn src.main:app --host 127.0.0.1 --port 8000
   ```

2. 单独启动 Wiki 后端（默认 `8010`），再在本目录启动前端：

   ```bash
   cd ../wiki-backend
   uvicorn app.main:app --host 127.0.0.1 --port 8010

   cd ../web-wiki-version
   npm ci
   npm run dev
   ```

3. 访问 Vite 输出的本地地址，例如 `http://127.0.0.1:3000/wiki`。

Vite 将 `/chat` 代理到 `VITE_DEV_CHAT_BACKEND_ORIGIN`，把 `/wiki/api` 和 `/references` 代理到 `VITE_DEV_WIKI_BACKEND_ORIGIN`；前端路由 `/wiki` 不会被整体代理。这样本地开发也不会把 Wiki 服务混入智能问答后端。

## 生产分发规则

推荐前端和 API 保持同一域名，分发规则顺序如下：

```text
/chat/*       -> 现有智能问答服务
/dbServ/*     -> 现有业务服务
/wiki/api/*   -> Wiki 目录接口
/references/* -> PDF 阅读器与文档代理
其他路径       -> web-wiki-version/dist/index.html
```

`/wiki/api/*` 和 `/references/*` 必须放在 SPA fallback 之前。不要把整个 `/wiki/*` 都转发给 FastAPI，否则 `/wiki` 前端页会被覆盖。

## 构建

```bash
npm run build
```

产物位于本目录的 `dist/`，可单独发布和回滚；不需要覆盖原 `web-version/dist/`。

## 当前边界

- Wiki 已验收桌面端和手机端响应式布局；真实微信小程序 WebView 仍应在每次发布后做一次设备抽查。
- Wiki 目录由 `wiki-backend/config/wiki-datasets.yaml` 维护，前端不保存目录副本。
- 当前流式问答结果的参考文档可跳 Wiki。
- PDF 有章节书签时显示章节目录；没有书签时阅读器提供页码导航目录。
- 原业务数据库返回的历史问答记录不包含 `reference`，因此旧历史回答仍不显示参考文档；解决该点才需要另行扩展历史记录的数据契约。
