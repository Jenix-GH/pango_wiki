Page({
  data: {
    // Force the WebView to refresh index.html after a frontend deployment.
    // Hashed JS/CSS assets remain browser-cacheable.
    wikiUrl: `https://aiapp.pangomicro.com/docs?client=miniprogram&entry=${Date.now()}`,
  },

  handleWikiError(event: WechatMiniprogram.CustomEvent) {
    console.error('文档中心加载失败', event.detail)
  },
})
