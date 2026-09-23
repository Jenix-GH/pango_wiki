import { placeMediaAfterCitations } from './src/answerRendering.js'

const IMAGE_EXTENSIONS = new Map([
  ['image/avif', 'avif'],
  ['image/bmp', 'bmp'],
  ['image/gif', 'gif'],
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/svg+xml', 'svg'],
  ['image/webp', 'webp'],
])

export function groupConversationRecords(rows) {
  const grouped = new Map()
  rows.forEach(row => {
    const key = String(row.conversation_key || `question:${row.question_id}`)
    if (!grouped.has(key)) {
      grouped.set(key, {
        conversation_key: key,
        session_id: row.session_id || '',
        userinfo_id: row.userinfo_id,
        user_name: row.user_name || `用户#${row.userinfo_id || '—'}`,
        platform: row.platform || platformForSession(row.session_id),
        started_at: row.question_time,
        last_question_at: row.question_time,
        records: [],
      })
    }
    const conversation = grouped.get(key)
    conversation.records.push(row)
    conversation.last_question_at = row.question_time
  })
  return [...grouped.values()].sort((left, right) => String(right.last_question_at).localeCompare(String(left.last_question_at)))
}

export function conversationFileName(conversation, index) {
  const sequence = String(index + 1).padStart(4, '0')
  const timestamp = compactDateTime(conversation.started_at)
  const platform = safePathPart(conversation.platform || 'UNKNOWN', 16)
  const session = safePathPart(conversation.session_id || conversation.conversation_key || 'legacy', 56)
  return `${sequence}_${timestamp}_${platform}_${session}.md`
}

export async function renderConversationMarkdown(conversation, options) {
  const { startDate, endDate, publicOrigin, resolveAsset } = options
  const lines = [
    '# Pango慧答会话记录',
    '',
    `- 导出时间段：${startDate} 至 ${endDate}`,
    `- 会话标识：${plainMetadata(conversation.session_id || conversation.conversation_key)}`,
    `- 终端：${plainMetadata(conversation.platform || 'UNKNOWN')}`,
    `- 用户：${plainMetadata(conversation.user_name || `用户#${conversation.userinfo_id || '—'}`)}`,
    `- 会话开始：${displayDateTime(conversation.started_at)}`,
    `- 最近提问：${displayDateTime(conversation.last_question_at)}`,
    `- 问答轮数：${conversation.records.length}`,
    '',
    '---',
    '',
  ]

  for (let recordIndex = 0; recordIndex < conversation.records.length; recordIndex++) {
    const record = conversation.records[recordIndex]
    const round = recordIndex + 1
    lines.push(`## 第 ${round} 轮`, '')
    lines.push(`- 提问时间：${displayDateTime(record.question_time)}`)
    if (record.answer_time) lines.push(`- 回答时间：${displayDateTime(record.answer_time)}`)
    if (record.answer_elapsed !== null && record.answer_elapsed !== undefined && record.answer_elapsed !== '') {
      lines.push(`- 回答耗时：${plainMetadata(record.answer_elapsed)}`)
    }
    lines.push('', '### 用户提问', '', quotePlainText(record.question || '—'), '')

    const questionImages = Array.isArray(record.question_images) ? record.question_images : []
    if (questionImages.length) {
      lines.push('### 用户上传图片', '')
      for (let mediaIndex = 0; mediaIndex < questionImages.length; mediaIndex++) {
        const media = questionImages[mediaIndex]
        const exported = await resolveAsset(media, { kind: 'question', round, mediaIndex })
        lines.push(markdownImage(media, exported, `用户上传图片 ${mediaIndex + 1}`, publicOrigin), '')
      }
    }

    lines.push('### 模型回复', '')
    if (record.answer_content) {
      const answerMedia = Array.isArray(record.answer_media) ? record.answer_media : []
      const preparedMedia = []
      for (let mediaIndex = 0; mediaIndex < answerMedia.length; mediaIndex++) {
        const media = answerMedia[mediaIndex]
        preparedMedia.push({
          ...media,
          exportedAsset: await resolveAsset(media, { kind: 'answer', round, mediaIndex }),
        })
      }
      placeMediaAfterCitations(String(record.answer_content), preparedMedia).forEach(section => {
        if (section.content) lines.push(section.content, '')
        section.media.forEach((media, mediaIndex) => {
          lines.push(markdownImage(media, media.exportedAsset, `回答配图 ${mediaIndex + 1}`, publicOrigin), '')
          const sourceUrl = absoluteHttpUrl(media.document_page_url, publicOrigin)
          if (sourceUrl && media.page) lines.push(`[查看原文第 ${plainMetadata(media.page)} 页](${encodeMarkdownUrl(sourceUrl)})`, '')
        })
      })
    } else {
      lines.push('> 该问题没有已保存的模型回答。', '')
    }

    const referenceLines = renderReferences(record.reference, publicOrigin)
    if (referenceLines.length) lines.push('### 参考资料', '', ...referenceLines, '')
    if (round < conversation.records.length) lines.push('---', '')
  }

  return `${lines.join('\n').trimEnd()}\n`
}

export function imageExtension(mimeType, fallbackName = '') {
  const normalized = String(mimeType || '').split(';')[0].trim().toLowerCase()
  if (IMAGE_EXTENSIONS.has(normalized)) return IMAGE_EXTENSIONS.get(normalized)
  const match = String(fallbackName).match(/\.([a-zA-Z0-9]{2,5})(?:[?#].*)?$/)
  return match ? match[1].toLowerCase() : 'bin'
}

export function absoluteHttpUrl(value, origin) {
  const candidate = String(value || '').trim()
  if (!candidate) return ''
  try {
    const url = new URL(candidate, origin)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : ''
  } catch {
    return ''
  }
}

function renderReferences(reference, publicOrigin) {
  const chunks = Array.isArray(reference?.chunks) ? reference.chunks : []
  return chunks.flatMap((chunk, index) => {
    const label = plainMetadata(chunk.citation_label || `[${index + 1}]`)
    const name = plainMetadata(chunk.display_name || chunk.document_name || chunk.title || '未命名文档')
    const documentUrl = absoluteHttpUrl(chunk.document_page_url || chunk.document_preview_url, publicOrigin)
    const heading = documentUrl
      ? `${index + 1}. **${label} ${name}** — [在线阅读](${encodeMarkdownUrl(documentUrl)})`
      : `${index + 1}. **${label} ${name}**`
    const pageLinks = Array.isArray(chunk.page_links) ? chunk.page_links : []
    const detail = pageLinks.flatMap(pageLink => {
      const pageUrl = absoluteHttpUrl(pageLink.document_page_url, publicOrigin)
      const pageText = `${plainMetadata(pageLink.citation_label || '')}${pageLink.citation_label ? ' ' : ''}第 ${plainMetadata(pageLink.page || '—')} 页`
      return [`   - ${pageUrl ? `[${pageText}](${encodeMarkdownUrl(pageUrl)})` : pageText}`]
    })
    if (!pageLinks.length && Array.isArray(chunk.pages) && chunk.pages.length) {
      detail.push(`   - 引用页：${chunk.pages.map(page => plainMetadata(page)).join('、')}`)
    } else if (!pageLinks.length && chunk.page !== null && chunk.page !== undefined) {
      detail.push(`   - 引用页：${plainMetadata(chunk.page)}`)
    }
    return [heading, ...detail]
  })
}

function markdownImage(media, exportedAsset, fallbackAlt, publicOrigin) {
  const alt = escapeMarkdownText(media?.caption || media?.filename || fallbackAlt)
  if (exportedAsset?.relativePath) return `![${alt}](${encodeMarkdownUrl(exportedAsset.relativePath)})${imageCaption(media)}`
  const onlineUrl = absoluteHttpUrl(media?.absoluteUrl || media?.absolute_url || media?.url || media?.image_url, publicOrigin)
  if (onlineUrl) return `![${alt}](${encodeMarkdownUrl(onlineUrl)})${imageCaption(media)}\n\n> 此图片未能写入压缩包，已保留在线地址。`
  return `> ${alt}未能写入压缩包，且没有可用的在线地址。`
}

function imageCaption(media) {
  const details = [media?.caption, media?.citation_label].filter(Boolean).map(value => escapeMarkdownText(plainMetadata(value)))
  return details.length ? `\n\n*${details.join(' · ')}*` : ''
}

function quotePlainText(value) {
  const lines = String(value).replace(/\r\n?/g, '\n').split('\n')
  return lines.map((line, index) => `> ${escapeMarkdownText(line)}${index < lines.length - 1 ? '  ' : ''}`).join('\n')
}

function escapeMarkdownText(value) {
  return String(value || '').replace(/([\\`*_[\]{}<>#+.!|()-])/g, '\\$1')
}

function plainMetadata(value) {
  return String(value ?? '—').replace(/[\r\n|]/g, ' ').trim() || '—'
}

function encodeMarkdownUrl(value) {
  return String(value).replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29')
}

function safePathPart(value, maxLength) {
  const safe = String(value || '').normalize('NFKC').replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^[_\.]+|[_\.]+$/g, '')
  return (safe || 'unknown').slice(0, maxLength)
}

function compactDateTime(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?/)
  return match ? `${match[1]}${match[2]}${match[3]}-${match[4] || '000000'}${match[5] || ''}${match[6] || ''}` : 'unknown-time'
}

function displayDateTime(value) {
  return value ? String(value).replace('T', ' ').slice(0, 19) : '—'
}

function platformForSession(sessionId) {
  const value = String(sessionId || '')
  if (value.startsWith('web_')) return 'WEB'
  if (value.startsWith('mini_')) return 'MINIPROGRAM'
  return 'UNKNOWN'
}
