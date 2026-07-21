export const copyToClipboard = async (content: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(content)
    return true
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = content
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const success = document.execCommand('copy')
    document.body.removeChild(textarea)
    return success
  }
}

export const extractText = (node: unknown): string => {
  if (typeof node === 'string') return node
  if (node && typeof node === 'object' && 'text' in node) return (node as { text: string }).text
  if (node && typeof node === 'object' && 'children' in node) {
    return (node as { children: unknown[] }).children.map(extractText).join('')
  }
  return ''
}
