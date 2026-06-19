import type { ReactNode } from 'react'
import { useToolConfig } from '../hooks/useToolConfig'

/**
 * Renders a tool's `config.instructions` as a tidy help/callout block.
 * Supports light markdown: `## headings`, `- bullets`, `**bold**`, `_italic_`,
 * `` `code` ``, and blank-line-separated paragraphs. Shown by the shell above
 * each tool — tool components don't render this themselves.
 */
export function ToolInstructions({ toolId }: { toolId: string }) {
  const { config, loading, error } = useToolConfig(toolId)

  // Stay quiet while loading or if anything goes wrong / there's nothing to show
  // — instructions are supplemental, never blocking.
  if (loading || error || !config) return null
  const text = (config.instructions ?? '').trim()
  if (!text) return null

  return (
    <div className="tool-instructions card" role="note">
      {renderMarkdown(text)}
    </div>
  )
}

/** Parse a small, safe subset of markdown into React nodes. */
function renderMarkdown(src: string): ReactNode {
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let para: string[] = []
  let list: string[] = []
  let key = 0

  const flushPara = () => {
    if (para.length) {
      blocks.push(<p key={key++}>{renderInline(para.join(' '))}</p>)
      para = []
    }
  }
  const flushList = () => {
    if (list.length) {
      blocks.push(
        <ul key={key++}>
          {list.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ul>,
      )
      list = []
    }
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    const bullet = /^[-*]\s+(.*)$/.exec(line)
    if (heading) {
      flushPara()
      flushList()
      const level = heading[1].length
      const content = renderInline(heading[2])
      if (level <= 2) blocks.push(<h3 key={key++}>{content}</h3>)
      else blocks.push(<h4 key={key++}>{content}</h4>)
    } else if (bullet) {
      flushPara()
      list.push(bullet[1])
    } else if (line.trim() === '') {
      flushPara()
      flushList()
    } else {
      flushList()
      para.push(line.trim())
    }
  }
  flushPara()
  flushList()
  return blocks
}

/** Inline formatting: **bold**, _italic_, `code`. */
function renderInline(text: string): ReactNode[] {
  const tokens = text.split(/(\*\*[^*]+\*\*|_[^_]+_|`[^`]+`)/g)
  return tokens.map((tok, i) => {
    if (/^\*\*[^*]+\*\*$/.test(tok)) return <strong key={i}>{tok.slice(2, -2)}</strong>
    if (/^_[^_]+_$/.test(tok)) return <em key={i}>{tok.slice(1, -1)}</em>
    if (/^`[^`]+`$/.test(tok))
      return (
        <code key={i} className="inline">
          {tok.slice(1, -1)}
        </code>
      )
    return <span key={i}>{tok}</span>
  })
}
