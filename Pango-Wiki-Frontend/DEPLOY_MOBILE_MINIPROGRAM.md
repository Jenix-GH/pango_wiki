# Wiki 手机首页与小程序慧答联动部署指南

本包同时包含源码和已经构建好的 `dist/`。它只修改统一前端，不修改智能问答后端、Wiki 后端、RAGFlow 或 Nginx 的 API 转发规则。

## 一、这次改动的效果

- 普通浏览器访问 `https://aiapp.pangomicro.com/wiki`：显示“智能问答”，点击进入 Web 问答。
- 小程序 WebView 访问 `https://aiapp.pangomicro.com/wiki?client=miniprogram`：显示“返回慧答”。
- 用户从原生问答页进入 Wiki 后，点击“返回慧答”会优先返回原页面，保留已有聊天记录和输入状态。
- 用户通过分享或冷启动直接进入 Wiki、没有上一页可返回时，进入固定的原生页面 `/pages/main/main`。
- Wiki 手机首页、文档目录、在线阅读及 Web 端行为保持不变。

## 二、上传前端压缩包

以下命令在保存压缩包的电脑上执行，将 `<代理服务器IP>` 换成实际地址：

```bash
scp Pango-Wiki-Frontend-MobileHome-MiniProgramReturn-20260720.zip \
  root@<代理服务器IP>:/tmp/
```

本次只需要把前端包传到运行 `aiapp.pangomicro.com` 静态网页的代理服务器，不要传到 RAGFlow 服务器。

## 三、在代理服务器备份和替换

先确认 Nginx 当前静态站点目录。以下命令只查看配置：

```bash
nginx -T 2>/dev/null | grep -nE 'server_name aiapp\.pangomicro\.com|^[[:space:]]*root[[:space:]]'
```

把下面的 `<前端站点目录>` 替换为实际目录，例如 `/var/www/pango-aiapp`。不要直接照抄示例路径。

```bash
cd /tmp
unzip -oq Pango-Wiki-Frontend-MobileHome-MiniProgramReturn-20260720.zip

mkdir -p /opt/pango-frontend-backups
cp -a <前端站点目录> \
  /opt/pango-frontend-backups/aiapp-before-mini-return-$(date +%Y%m%d-%H%M%S)

cp -a /tmp/Pango-Wiki-Frontend/dist/. <前端站点目录>/
nginx -t
nginx -s reload
```

如果前端由宝塔、容器或 CI 发布，不要手工覆盖目录；将包内 `Pango-Wiki-Frontend/dist/` 作为新的静态产物交给现有发布流程即可。

这次没有新增 API 路径。已有下列转发保持原样：

```text
/chat/*       -> 智能问答后端
/wiki/api/*   -> Wiki 后端
/references/* -> Wiki 后端阅读器
其他路径       -> 前端 index.html
```

## 四、修改小程序入口

小程序侧必须使用带入口标记的 Wiki 地址：

```text
https://aiapp.pangomicro.com/wiki?client=miniprogram
```

并从原生问答页使用 `wx.navigateTo` 打开 Wiki 包装页：

```ts
openWiki() {
  wx.navigateTo({
    url: '/pages/wiki/wiki',
  })
}
```

不要使用 `redirectTo` 或 `reLaunch` 打开 Wiki，否则原来的问答页会被销毁，无法原路保留会话。

完整的 WebView 页面代码、`app.json` 配置和异常处理示例见 [`MINIPROGRAM_WIKI_INTEGRATION.md`](./MINIPROGRAM_WIKI_INTEGRATION.md)。修改小程序代码后仍需在微信开发者工具中重新上传并发布小程序版本。

## 五、发布后验收

先在代理服务器确认前端与接口：

```bash
curl -I https://aiapp.pangomicro.com/wiki
curl -I https://aiapp.pangomicro.com/wiki/api/catalog
curl -I 'https://aiapp.pangomicro.com/wiki?client=miniprogram'
```

然后分别验收：

1. PC 浏览器打开 `/wiki`，应显示“智能问答”，点击后进入 Web 问答。
2. 手机浏览器打开 `/wiki`，Wiki 首页可上下滑动、目录可展开，仍显示“智能问答”。
3. 小程序原生慧答页进入 Wiki，应显示“返回慧答”。
4. 点击“返回慧答”，应回到进入前的原生会话，消息和输入状态不丢失。
5. 从分享卡片或冷启动直接进入 Wiki 时，点击按钮应进入 `/pages/main/main`。
6. 打开任一文档，确认在线阅读、页码定位与章节目录正常。

如果界面仍是旧版本，先清理 CDN/静态缓存，再关闭并重新进入小程序。仅刷新 WebView 不一定会清掉微信缓存。

## 六、回滚

如果需要回滚，只恢复第三步生成的备份目录内容并重新加载 Nginx；Wiki 后端和智能问答后端均不需要回滚。
