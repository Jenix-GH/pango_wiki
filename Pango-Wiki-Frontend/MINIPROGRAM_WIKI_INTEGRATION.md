# 小程序 Wiki 与原生慧答联动操作指南

本版本已经在 Wiki 网页端实现双入口导航：

- 普通浏览器访问 `/wiki`：顶部按钮显示“智能问答”，进入 Web 问答。
- 小程序 WebView 访问 `/wiki?client=miniprogram`：顶部按钮显示“返回慧答”，优先返回原生问答页并保留会话；没有可返回页面时，重新打开 `/pages/main/main`。

智能问答后端、Wiki 后端、RAGFlow 和 Nginx 转发均不需要修改。

## 一、已有 Wiki WebView 页面时

只需要把 WebView 地址改成：

```text
https://aiapp.pangomicro.com/wiki?client=miniprogram
```

并确保从原生问答页使用 `wx.navigateTo` 打开 Wiki 页面，不要使用 `redirectTo` 或 `reLaunch`：

```ts
wx.navigateTo({
  url: '/pages/wiki/wiki',
})
```

这样用户点击 Wiki 中的“返回慧答”时，`navigateBack` 会恢复原来的问答页面、聊天记录和输入状态。

## 二、尚未建立 Wiki WebView 页面时

### 1. 在 `app.json` 的 `pages` 中加入

```json
"pages/wiki/wiki"
```

### 2. 新建 `pages/wiki/wiki.ts`

```ts
const WIKI_URL = 'https://aiapp.pangomicro.com/wiki?client=miniprogram'

Page({
  data: {
    wikiUrl: WIKI_URL,
  },

  handleWikiError(event: WechatMiniprogram.CustomEvent) {
    console.error('Wiki WebView 加载失败', event.detail)
  },
})
```

### 3. 新建 `pages/wiki/wiki.wxml`

```xml
<web-view src="{{wikiUrl}}" binderror="handleWikiError" />
```

### 4. 新建 `pages/wiki/wiki.json`

```json
{
  "navigationBarTitleText": "Pango 器件 Wiki"
}
```

### 5. 从原生问答页的 Wiki 按钮进入

```ts
openWiki() {
  wx.navigateTo({
    url: '/pages/wiki/wiki',
  })
}
```

## 三、验收步骤

1. 浏览器打开 `https://aiapp.pangomicro.com/wiki`，按钮应为“智能问答”，点击进入 Web 问答。
2. 小程序从原生慧答页打开 Wiki，按钮应为“返回慧答”。
3. 点击“返回慧答”，应回到刚才的原生会话，聊天记录和输入状态不丢失。
4. 通过分享或冷启动直接进入 Wiki 时，点击“返回慧答”应进入 `/pages/main/main`。
5. 文档目录、在线阅读和目录刷新功能应保持正常。

## 四、注意事项

- `aiapp.pangomicro.com` 必须在小程序后台的业务域名白名单中；当前 Wiki 已能打开时通常已经配置。
- 不要从 URL 接收任意小程序返回路径。本版本固定只回到 `/pages/main/main`，避免非预期页面跳转。
- 如果小程序仍然打开不带参数的旧地址，环境特征识别会尽量兼容，但正式发布仍应明确添加 `client=miniprogram`。
- 小程序代码修改后需要重新上传并发布小程序版本；仅替换服务器前端文件不会改变旧小程序中的 WebView 地址。
