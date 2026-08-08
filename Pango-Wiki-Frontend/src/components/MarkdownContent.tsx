import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import 'katex/dist/katex.min.css'
import './MarkdownContent.css'
import { normalizeMarkdownBlockSpacing } from '../utils/answerRendering'

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
