Page({
  data: {
    wikiUrl: 'https://aiapp.pangomicro.com/docs?client=miniprogram',
  },

  handleWikiError(event: WechatMiniprogram.CustomEvent) {
    console.error('文档中心加载失败', event.detail)
  },
})
