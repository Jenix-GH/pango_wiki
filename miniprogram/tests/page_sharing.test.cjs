// Run with: node --test miniprogram/tests/page_sharing.test.cjs
const assert = require('node:assert/strict')
const test = require('node:test')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('../../Pango-Wiki-Frontend/node_modules/typescript')

const origin = 'https://aiapp.pangomicro.com'
const reference = `${origin}/references/cloud/viewer?file=${encodeURIComponent('器件指南 V1.0.pdf')}&version=1#page=12`
const reader = `${origin}/docs/reader?client=miniprogram&url=${encodeURIComponent(reference)}`

function page(name, extraGlobalData = {}) {
  let definition
  const calls = { menus: [], navigation: [] }
  const app = { globalData: { qaHost: origin, referenceHost: origin, ...extraGlobalData } }
  const wx = {
    showShareMenu: options => calls.menus.push(options.menus),
    getStorageSync: () => undefined,
    request() {},
    navigateTo: options => calls.navigation.push(options.url),
    navigateBack: options => options.fail(),
    switchTab: options => calls.navigation.push(options.url),
  }
  const source = fs.readFileSync(path.join(__dirname, '../miniprogram/pages', name, `${name}.ts`), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  vm.runInNewContext(compiled, { exports: {}, wx, console, getApp: () => app, Page: value => { definition = value } })
  const instance = {
    ...definition,
    data: structuredClone(definition.data),
    setData(update) { Object.assign(this.data, update) },
  }
  return { instance, calls, app }
}

function sharedOptions(share) {
  return Object.fromEntries(new URLSearchParams(share.path.split('?')[1]))
}

test('catalog and License expose chat/timeline sharing with their own landing routes', () => {
  for (const name of ['wiki', 'license']) {
    const { instance: p, calls } = page(name)
    p.onLoad()
    assert.equal(calls.menus[0].join(','), 'shareAppMessage,shareTimeline')
    const share = p.onShareAppMessage()
    assert.equal(share.path, `/pages/${name}/${name}`)
    assert.ok(share.title)
    assert.equal(p.onShareTimeline().query, '')
  }
})

test('License shares a fixed image and no filled-in personal information', () => {
  const { instance: p } = page('license')
  Object.assign(p.data.form, { email: 'private@example.com', applicantName: '申请人', macAddress: 'AA-BB-CC-DD-EE-FF' })
  for (const share of [p.onShareAppMessage(), p.onShareTimeline()]) {
    assert.equal(share.imageUrl, '/images/pango-logo.png')
    assert.doesNotMatch(JSON.stringify(share), /private@example.com|申请人|AA-BB-CC-DD-EE-FF/)
  }
})

test('catalog document share opens the same version on a fresh client, including encoded URL and fragment', () => {
  const { instance: wiki, calls, app } = page('wiki')
  wiki.data.allGroups = [{ current: { key: 'doc-v1', title: '器件指南', version: 'V1.0', viewer_url: reference }, history: [] }]
  wiki.openDocument({ currentTarget: { dataset: { key: 'doc-v1' } } })
  const localOptions = Object.fromEntries(new URLSearchParams(calls.navigation[0].split('?')[1]))
  const { instance: sender, app: senderApp, calls: senderCalls } = page('reference-viewer', app.globalData)
  sender.onLoad(localOptions)
  assert.equal(senderApp.globalData._refViewerUrl, undefined)
  assert.equal(senderCalls.menus[0].join(','), 'shareAppMessage')
  const share = sender.onShareAppMessage()
  assert.equal(share.title, '器件指南 V1.0')
  assert.ok(share.path.startsWith('/pages/reference-viewer/reference-viewer?'))

  const { instance: recipient } = page('reference-viewer')
  recipient.onLoad(sharedOptions(share))
  assert.equal(recipient.data.viewerUrl, sender.data.viewerUrl)
  assert.equal(new URL(recipient.data.viewerUrl).searchParams.get('url'), reference)
  assert.equal(recipient.data.shareTitle, share.title)
  assert.equal(recipient.onShareAppMessage().path, share.path)
})

test('encoded query URLs and current WebView URLs survive sharing without repeated decoding', () => {
  const { instance: p } = page('reference-viewer')
  p.onLoad({ url: encodeURIComponent(reader), title: encodeURIComponent('器件指南 V1.0') })
  assert.equal(p.data.viewerUrl, reader)
  const current = `${reader}#page=20`
  const share = p.onShareAppMessage({ webViewUrl: current })
  const { instance: recipient } = page('reference-viewer')
  recipient.onLoad(sharedOptions(share))
  assert.equal(recipient.data.viewerUrl, current)
  // An unrelated WebView route must not replace the known document.
  assert.equal(sharedOptions(p.onShareAppMessage({ webViewUrl: `${origin}/login` })).url, reader)
})

test('invalid shared URLs never open a stale document or an unrelated host', () => {
  for (const url of ['', '%E0%A4%A', 'javascript:alert(1)', 'https://evil.example/docs/reader',
    `${origin}.evil.example/docs/reader`, `${origin}@evil.example/docs/reader`, `${origin}/login`]) {
    const { instance: p } = page('reference-viewer', { _refViewerUrl: reader })
    p.onLoad({ url })
    assert.equal(p.data.viewerUrl, '')
    assert.ok(p.data.errorMessage)
    assert.equal(p.onShareAppMessage().path, '/pages/wiki/wiki')
  }
})

test('load failures retain share/retry targets; shared entry can return to the catalog', () => {
  const { instance: p, calls } = page('reference-viewer')
  p.onLoad({ url: reader })
  p.handleViewerError({ detail: { errMsg: 'test network failure' } })
  assert.equal(p.data.viewerUrl, '')
  assert.equal(sharedOptions(p.onShareAppMessage()).url, reader)
  p.retry()
  assert.equal(p.data.viewerUrl, reader)
  p.goBack()
  assert.equal(calls.navigation[0], '/pages/wiki/wiki')
})
