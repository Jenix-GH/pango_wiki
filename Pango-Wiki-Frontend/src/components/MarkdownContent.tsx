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
  const fixedContent = fixMarkdownTableSpacing(content)

  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
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

function fixMarkdownTableSpacing(md: string): string {
  const lines = md.split(/\r?\n/)
  const fixed: string[] = []
  let inCodeFence = false

  for (let i = 0; i < lines.length; i++) {
    const current = lines[i]
    const next = lines[i + 1] ?? ''
    const currentTrimmed = current.trim()
    const nextTrimmed = next.trim()

    if (/^(```|~~~)/.test(currentTrimmed)) {
      inCodeFence = !inCodeFence
      fixed.push(current)
      continue
    }

    const currentIsTable = !inCodeFence && currentTrimmed.startsWith('|')
    const nextIsTable = !inCodeFence && nextTrimmed.startsWith('|')

    // 普通文本与表格起始行之间补一个空行。
    if (currentIsTable && fixed.length > 0) {
      const previous = fixed[fixed.length - 1]
      if (previous.trim() !== '' && !previous.trim().startsWith('|')) fixed.push('')
    }

    fixed.push(current)

    // 表格结束行与后续文本之间也补一个空行。
    if (currentIsTable && !nextIsTable && nextTrimmed !== '') fixed.push('')
  }
  return fixed.join('\n')
}
