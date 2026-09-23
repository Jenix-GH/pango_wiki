import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import archiver from 'archiver'
import { conversationFileName, groupConversationRecords, imageExtension, renderConversationMarkdown } from '../conversationExport.mjs'

const rows = [
  {
    conversation_key: 'web_demo', session_id: 'web_demo', question_id: 1, userinfo_id: 7, user_name: '测试用户', platform: 'WEB',
    question: '第一行\n第二行', question_time: '2026-09-02 10:00:00', question_images: [{ filename: 'input.png', mime_type: 'image/png', data_base64: 'aW1hZ2U=' }],
    answer_content: '第一段<sup>[1]</sup>。\n\n| 参数 | 值 |\n|---|---|\n| A | B |', answer_time: '2026-09-02 10:00:03', answer_elapsed: 3,
    answer_media: [{ asset_id: 'figure-1', url: '/references/figures/one.png', caption: '时序图', citation_label: '[1]', page: 8, document_page_url: '/references/viewer?id=1&page=8' }],
    reference: { chunks: [{ citation_label: '[1]', display_name: 'PDS 用户指南', page_links: [{ page: 8, document_page_url: '/references/viewer?id=1&page=8' }] }] },
  },
  {
    conversation_key: 'web_demo', session_id: 'web_demo', question_id: 2, userinfo_id: 7, user_name: '测试用户', platform: 'WEB',
    question: '继续提问', question_time: '2026-09-02 10:01:00', question_images: [], answer_content: '', answer_media: [], reference: null,
  },
  {
    conversation_key: 'question:3', session_id: '', question_id: 3, userinfo_id: 8, platform: 'UNKNOWN',
    question: '旧记录', question_time: '2026-09-03 11:00:00', question_images: [], answer_content: '旧回答', answer_media: [], reference: { chunks: [] },
  },
]

const conversations = groupConversationRecords(rows)
assert.equal(conversations.length, 2)
assert.equal(conversations[0].conversation_key, 'question:3')
assert.equal(conversations[1].records.length, 2)
assert.match(conversationFileName(conversations[1], 1), /^0002_20260902-100000_WEB_web_demo\.md$/)
assert.equal(imageExtension('image/jpeg'), 'jpg')
assert.equal(imageExtension('', 'diagram.webp?version=2'), 'webp')

const requestedAssets = []
const markdown = await renderConversationMarkdown(conversations[1], {
  startDate: '2026-09-01',
  endDate: '2026-09-03',
  publicOrigin: 'https://aiapp.pangomicro.com',
  resolveAsset: async (media, context) => {
    requestedAssets.push({ media, context })
    return { relativePath: `../assets/0002/${context.kind}-${context.round}-${context.mediaIndex + 1}.png` }
  },
})

assert.equal(requestedAssets.length, 2)
assert.match(markdown, /## 第 1 轮[\s\S]*## 第 2 轮/)
assert.match(markdown, /> 第一行  \n> 第二行/)
assert.match(markdown, /第一段<sup>\[1\]<\/sup>。\n\n!\[时序图\]/)
assert.ok(markdown.indexOf('![时序图]') < markdown.indexOf('| 参数 | 值 |'))
assert.match(markdown, /### 参考资料[\s\S]*PDS 用户指南/)
assert.match(markdown, /该问题没有已保存的模型回答/)
assert.match(markdown, /\.\.\/assets\/0002\/question-1-1\.png/)

const zipChunks = []
const zipOutput = new PassThrough()
zipOutput.on('data', chunk => zipChunks.push(chunk))
const archive = archiver('zip')
archive.pipe(zipOutput)
archive.append(markdown, { name: 'sessions/example.md' })
const zipEnded = new Promise(resolve => zipOutput.on('end', resolve))
await archive.finalize()
await zipEnded
const zipBuffer = Buffer.concat(zipChunks)
assert.equal(zipBuffer.subarray(0, 2).toString(), 'PK')
assert.ok(zipBuffer.includes(Buffer.from('sessions/example.md')))

console.log('conversation export assertions passed')
