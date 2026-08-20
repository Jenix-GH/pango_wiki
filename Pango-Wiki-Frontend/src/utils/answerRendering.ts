export interface CitationMedia {
  citation_label?: string
}

export function normalizeMarkdownBlockSpacing(md: string): string {
  const lines = md.split(/\r?\n/)
  const fixed: string[] = []
  let inCodeFence = false

  for (let i = 0; i < lines.length; i++) {
    let current = lines[i]
    const currentTrimmed = current.trim()
    if (/^(```|~~~)/.test(currentTrimmed)) {
      inCodeFence = !inCodeFence
      fixed.push(current)
      continue
    }
    if (inCodeFence) {
      fixed.push(current)
      continue
    }
    current = current.replace(/^(\s{0,3}#{1,6})(?=[^\s#])/, '$1 ')
    const normalizedTrimmed = current.trim()
    const nextTrimmed = (lines[i + 1] ?? '').trim()
    const currentIsTable = normalizedTrimmed.startsWith('|')
    const previousIsTable = fixed.length > 0 && fixed[fixed.length - 1].trim().startsWith('|')
    const nextIsTable = nextTrimmed.startsWith('|')
    const currentIsHeading = /^#{1,6}(?:\s+|$)/.test(normalizedTrimmed)
    const currentIsEmphasisHeading = /^(\*{2,3}|_{2,3})\S(?:.*?\S)?\1(?:<sup\b[^>]*>.*?<\/sup>)?[：:]?$/.test(normalizedTrimmed)
    const currentStartsWithEmphasis = /^(\*{2,3}|_{2,3})\S.*?\1(?=<sup\b|[：:\s（(]|$)/.test(normalizedTrimmed)
    const currentIsThematicBreak = /^(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(normalizedTrimmed)
    const currentNeedsLeadingSpacing = currentIsTable || currentIsHeading || currentStartsWithEmphasis || currentIsThematicBreak
    const currentNeedsTrailingSpacing = currentIsTable || currentIsHeading || currentIsEmphasisHeading || currentIsThematicBreak
    if (currentNeedsLeadingSpacing && fixed.length > 0) {
      const previous = fixed[fixed.length - 1] ?? ''
      if (previous.trim() !== '' && !(currentIsTable && previousIsTable)) fixed.push('')
    }
    // Markdown folds a single newline inside a block into a space. Turn every
    // such soft break into a hard break while leaving blank lines and code
    // fences unchanged.
    const shouldForceHardBreak = i < lines.length - 1
      && normalizedTrimmed !== ''
      && nextTrimmed !== ''
    fixed.push(shouldForceHardBreak ? `${current.trimEnd()}  ` : current)
    if (currentNeedsTrailingSpacing && nextTrimmed !== '' && !(currentIsTable && nextIsTable)) fixed.push('')
  }
  return fixed.join('\n')
}

export function placeMediaAfterCitations<T extends CitationMedia>(content: string, media: T[]): Array<{ content: string; media: T[] }> {
  if (media.length === 0) return [{ content, media: [] }]
  const mediaByOffset = new Map<number, T[]>()
  const unplaced: T[] = []
  media.forEach(item => {
    const label = item.citation_label?.trim()
    const bracketLabel = label?.match(/\[[^\]]+\]/)?.[0]
    const candidates = [...new Set([label, bracketLabel].filter((value): value is string => Boolean(value)))]
    let matchIndex = -1
    let matchedLabel = ''
    for (const candidate of candidates) {
      matchIndex = content.indexOf(candidate)
      if (matchIndex >= 0) { matchedLabel = candidate; break }
    }
    if (matchIndex < 0) { unplaced.push(item); return }
    let insertionOffset = matchIndex + matchedLabel.length
    const openingSup = content.lastIndexOf('<sup', matchIndex)
    const closingSupBeforeLabel = content.lastIndexOf('</sup>', matchIndex)
    const closingSupAfterLabel = content.indexOf('</sup>', insertionOffset)
    if (openingSup > closingSupBeforeLabel && closingSupAfterLabel >= insertionOffset) {
      insertionOffset = closingSupAfterLabel + '</sup>'.length
      const trailingPunctuation = content.slice(insertionOffset).match(/^[ \t]*[。！？.!?；;：:]?/)
      insertionOffset += trailingPunctuation?.[0].length || 0
    }
    insertionOffset = moveInsertionAfterMarkdownTable(content, matchIndex, insertionOffset)
    mediaByOffset.set(insertionOffset, [...(mediaByOffset.get(insertionOffset) || []), item])
  })
  const sections: Array<{ content: string; media: T[] }> = []
  let contentOffset = 0
  ;[...mediaByOffset.keys()].sort((a, b) => a - b).forEach(insertionOffset => {
    sections.push({ content: content.slice(contentOffset, insertionOffset), media: mediaByOffset.get(insertionOffset) || [] })
    contentOffset = insertionOffset
  })
  const trailingContent = content.slice(contentOffset)
  if (trailingContent || unplaced.length || sections.length === 0) sections.push({ content: trailingContent, media: unplaced })
  return sections
}

function moveInsertionAfterMarkdownTable(content: string, matchIndex: number, fallbackOffset: number): number {
  const lineStart = content.lastIndexOf('\n', matchIndex - 1) + 1
  const lineEnd = content.indexOf('\n', matchIndex)
  const currentLineEnd = lineEnd < 0 ? content.length : lineEnd
  if (!content.slice(lineStart, currentLineEnd).trim().startsWith('|')) return fallbackOffset

  let tableEnd = currentLineEnd
  while (tableEnd < content.length) {
    const nextLineStart = tableEnd + 1
    const nextLineEndIndex = content.indexOf('\n', nextLineStart)
    const nextLineEnd = nextLineEndIndex < 0 ? content.length : nextLineEndIndex
    if (!content.slice(nextLineStart, nextLineEnd).trim().startsWith('|')) break
    tableEnd = nextLineEnd
  }
  return tableEnd
}
