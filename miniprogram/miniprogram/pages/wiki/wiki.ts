Page({
  data: {
    wikiUrl: 'https://aiapp.pangomicro.com/wiki?client=miniprogram',
  },

  handleWikiError(event: WechatMiniprogram.CustomEvent) {
    console.error('Wiki 加载失败', event.detail)
  },
})
