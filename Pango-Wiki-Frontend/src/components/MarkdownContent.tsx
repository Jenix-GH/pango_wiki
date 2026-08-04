import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import 'katex/dist/katex.min.css'
import './MarkdownContent.css'

interface Props {
  content: string
}

export default function MarkdownContent({ content }: Props) {
  const fixedContent = normalizeMarkdownBlockSpacing(content)

  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[[remarkGfm, { singleTilde: false }], remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeRaw]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
          ),
          code: ({ className, children, ...props }) => {
            const isInline = !className
            if (isInline) {
              return <code className="inline-code" {...props}>{children}</code>
            }
            return (
              <pre className="code-block">
                <code className={className} {...props}>{children}</code>
              </pre>
            )
          },
        }}
      >
        {fixedContent}
      </ReactMarkdown>
    </div>
  )
}

function normalizeMarkdownBlockSpacing(md: string): string {
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

    // CommonMark requires a space after the # sequence. Accept headings such as
    // "###标题" from the backend by converting them to "### 标题".
    current = current.replace(/^(\s{0,3}#{1,6})(?=[^\s#])/, '$1 ')

    const normalizedTrimmed = current.trim()
    const nextTrimmed = (lines[i + 1] ?? '').trim()
    const currentIsTable = normalizedTrimmed.startsWith('|')
    const previousIsTable = fixed.length > 0
      && fixed[fixed.length - 1].trim().startsWith('|')
    const nextIsTable = nextTrimmed.startsWith('|')
    const currentIsHeading = /^#{1,6}(?:\s+|$)/.test(normalizedTrimmed)
    // Treat bold section labels followed by a citation, for example
    // "**存储接口性能**<sup>[2]</sup>", as standalone block headings too.
    // Without blank lines CommonMark renders the source newline as a space.
    const currentIsEmphasisHeading = /^(\*{2,3}|_{2,3})\S(?:.*?\S)?\1(?:<sup\b[^>]*>.*?<\/sup>)?[：:]?$/.test(normalizedTrimmed)
    const currentStartsWithEmphasis = /^(\*{2,3}|_{2,3})\S.*?\1(?=<sup\b|[：:\s（(]|$)/.test(normalizedTrimmed)
    const currentIsThematicBreak = /^(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(normalizedTrimmed)
    const currentNeedsLeadingSpacing = currentIsTable
      || currentIsHeading
      || currentStartsWithEmphasis
      || currentIsThematicBreak
    const currentNeedsTrailingSpacing = currentIsTable
      || currentIsHeading
      || currentIsEmphasisHeading
      || currentIsThematicBreak

    if (currentNeedsLeadingSpacing && fixed.length > 0) {
      const previous = fixed[fixed.length - 1] ?? ''
      if (previous.trim() !== '' && !(currentIsTable && previousIsTable)) fixed.push('')
    }

    fixed.push(current)

    if (
      currentNeedsTrailingSpacing
      && nextTrimmed !== ''
      && !(currentIsTable && nextIsTable)
    ) fixed.push('')
  }

  return fixed.join('\n')
}
