# Pango 运营中控台

仅供内部管理员在本地运行，用于查看访问统计、事件明细、问题反馈和 License 申请，并更新反馈/申请状态。

## 启动

1. Java 后端设置随机管理密钥（至少 16 位）：

   ```powershell
   $env:ADMIN_CONSOLE_KEY='替换为随机长密钥'
   ```

2. 安装依赖并启动：

   ```bash
   npm install
   npm run dev
   ```

3. 打开 `http://127.0.0.1:3100`，在“连接设置”中填写同一管理密钥。

首次部署访问统计时，先对现有数据库执行：

```bash
mysql -u <user> -p <database> < ../agent_ai/database/migrations/20260804_add_analytics_event.sql
```

然后使用包含 `/analytics/track` 和 `/admin/console/**` 的最新 Java JAR 重启后端。现有 `/dbServ/` Nginx 代理可以直接承载管理接口，不需要额外新增公网 location。

默认通过 Vite 将 `/dbServ` 代理到 `https://aiapp.pangomicro.com`。联调其他服务器时可设置：

```powershell
$env:ADMIN_BACKEND_ORIGIN='http://127.0.0.1:8080'
npm run dev
```

管理密钥只保存在浏览器 `sessionStorage`，关闭该浏览器会话后需要重新输入。不要将密钥写入代码、README、`.env` 或提交到 Git。

## 后端接口

所有接口位于 `/admin/console/**`，并要求请求头：

```text
X-Admin-Key: <ADMIN_CONSOLE_KEY>
```

未配置密钥、密钥短于 16 位或请求密钥不匹配时，后端会拒绝访问。

## 数据与权限边界

- 控制台浏览器不会直接连接 MySQL，数据库凭据不会进入前端构建产物。
- 概览和事件明细来自 `dto_analytics_event`；反馈和 License 分别来自现有业务表。
- 控制台允许更新反馈及 License 状态，不提供删除记录或修改数据库结构的能力。
- `/references/`、`/references/figures/` 和 `/wiki/api/` 的负载均衡与控制台无关，也不需要模型会话粘性。
