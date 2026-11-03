import type { ReactNode } from 'react'

/**
 * Small Markdown subset for AI replies: headings, lists, quotes, fenced code,
 * **bold**, *italic*, `code`. Builds React elements only (no HTML injection).
 * ponytail: no tables/links; add a Markdown library if replies need them.
 */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  const lines = text.replaceAll('\r\n', '\n').split('\n')
  let index = 0
  while (index < lines.length) {
    const line = lines[index]!
    const fence = /^\s*```(\w*)/.exec(line)
    if (fence) {
      const body: string[] = []
      index++
      while (index < lines.length && !/^\s*```/.test(lines[index]!))
        body.push(lines[index++]!)
      index++
      blocks.push(<pre key={blocks.length}>{body.join('\n')}</pre>)
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      blocks.push(
        <p key={blocks.length} className="md-heading">
          {inline(heading[2]!)}
        </p>,
      )
      index++
      continue
    }
    const item = /^\s*([-*+]|\d+[.)])\s+/
    if (item.test(line)) {
      const ordered = /^\s*\d/.test(line)
      const items: ReactNode[] = []
      while (index < lines.length && item.test(lines[index]!)) {
        items.push(
          <li key={items.length}>{inline(lines[index]!.replace(item, ''))}</li>,
        )
        index++
      }
      blocks.push(
        ordered ? (
          <ol key={blocks.length}>{items}</ol>
        ) : (
          <ul key={blocks.length}>{items}</ul>
        ),
      )
      continue
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = []
      while (index < lines.length && /^\s*>/.test(lines[index]!))
        quote.push(lines[index++]!.replace(/^\s*>\s?/, ''))
      blocks.push(
        <blockquote key={blocks.length}>{inline(quote.join(' '))}</blockquote>,
      )
      continue
    }
    if (!line.trim()) {
      index++
      continue
    }
    // A paragraph runs until a blank line or another block starts.
    const paragraph: string[] = []
    while (
      index < lines.length &&
      lines[index]!.trim() &&
      !/^\s*(```|#{1,6}\s|[-*+]\s|\d+[.)]\s|>)/.test(lines[index]!)
    )
      paragraph.push(lines[index++]!)
    blocks.push(<p key={blocks.length}>{inline(paragraph.join('\n'))}</p>)
  }
  return <div className="markdown">{blocks}</div>
}

function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*/g
  let last = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    const key = parts.length
    if (match[1] !== undefined) parts.push(<code key={key}>{match[1]}</code>)
    else if (match[2] !== undefined)
      parts.push(<strong key={key}>{match[2]}</strong>)
    else parts.push(<em key={key}>{match[3]}</em>)
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}
