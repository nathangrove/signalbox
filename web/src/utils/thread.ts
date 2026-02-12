import { isValid, parse } from 'date-fns'

export function parseDateCandidate(input: string): Date | null {
  if (!input) return null
  const cleaned = String(input).replace(/\s+/g, ' ').trim()
  if (!cleaned) return null

  const formats = [
    "EEE, MMM d, yyyy 'at' h:mm a",
    "EEE, MMM d, yyyy 'at' h:mma",
    "EEE, MMM d, yyyy h:mm a",
    "EEE, MMM d, yyyy",
    "MMM d, yyyy 'at' h:mm a",
    "MMM d, yyyy, h:mm a",
    "M/d/yyyy, h:mm:ss a",
    "M/d/yyyy, h:mm a",
    "M/d/yy, h:mm a",
    'M/d/yyyy',
    'M/d/yy'
  ]

  for (const fmt of formats) {
    const d = parse(cleaned, fmt, new Date())
    if (isValid(d)) return d
  }

  const fallback = new Date(cleaned)
  if (!Number.isNaN(fallback.getTime())) return fallback
  return null
}

export function parseThreadHeader(raw?: string) {
  if (!raw) return { name: '', email: '', dateText: '' }
  let text = String(raw).replace(/^On\s+/i, '').replace(/\s*wrote:\s*$/i, '').trim()
  text = text.replace(/[\u00A0\u202F\u2007]/g, ' ').replace(/\s+/g, ' ').trim()

  const headerLabels = ['From', 'Sent', 'To', 'Subject', 'Cc', 'Date']
  const fieldRe = (label: string) => new RegExp(`${label}\\s*:\\s*([\\s\\S]*?)(?=(?:${headerLabels.join('|')})\\s*:|$)`, 'i')

  const extractField = (label: string) => {
    const match = text.match(fieldRe(label))
    return match ? match[1].trim() : ''
  }

  const parseNameEmail = (input: string) => {
    if (!input) return { name: '', email: '' }
    const emailMatch = input.match(/<\s*([^>\s]+@[^>\s]+)\s*>/)
    const email = emailMatch ? emailMatch[1] : (input.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/) || [])[1] || ''
    let name = input
    if (email) name = name.replace(email, '')
    name = name.replace(/[<>]/g, '').replace(/^[,;:\s]+|[,;:\s]+$/g, '').trim()
    if (!name) name = email
    return { name, email }
  }

  const fromField = extractField('From')
  const sentField = extractField('Sent') || extractField('Date')
  if (fromField || sentField) {
    const parsed = parseNameEmail(fromField)
    return {
      name: parsed.name || parsed.email || 'Unknown',
      email: parsed.email || '',
      dateText: sentField || ''
    }
  }

  let email = ''
  const emailMatch = text.match(/<\s*([^>\s]+@[^>\s]+)\s*>/)
  if (emailMatch) email = emailMatch[1]
  else {
    const bare = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/)
    if (bare) email = bare[1]
  }

  const tokens = text.split(/\s+/).filter(Boolean)
  const tokenCount = tokens.length
  const emailIndex = email ? tokens.findIndex(t => t.includes(email) || t.replace(/[<>]/g, '') === email) : -1

  let bestStart = -1
  let bestEnd = -1
  let bestCandidate = ''
  for (let start = 0; start < tokenCount; start += 1) {
    for (let end = start; end < Math.min(tokenCount, start + 12); end += 1) {
      const candidate = tokens.slice(start, end + 1).join(' ').replace(/^[,;:\s]+|[,;:\s]+$/g, '')
      if (!candidate) continue
      const d = parseDateCandidate(candidate)
      if (d) {
        if (bestCandidate.length < candidate.length) {
          bestCandidate = candidate
          bestStart = start
          bestEnd = end
        }
      }
    }
  }

  let dateText = ''
  let name = ''

  if (bestStart !== -1) {
    dateText = bestCandidate
    if (email && emailIndex !== -1) {
      if (emailIndex > bestEnd) {
        name = tokens.slice(bestEnd + 1, emailIndex).join(' ')
      } else if (emailIndex < bestStart) {
        name = tokens.slice(emailIndex + 1, bestStart).join(' ')
      } else {
        name = tokens.slice(bestEnd + 1).join(' ')
      }
    } else {
      name = tokens.slice(bestEnd + 1).join(' ')
    }
  } else {
    if (email && emailIndex !== -1) {
      name = tokens.slice(0, emailIndex).join(' ')
    } else {
      name = text
    }
  }

  name = (name || '').replace(/^[,;:\s]+|[,;:\s]+$/g, '').replace(/[<>]/g, '').trim()
  if (email && (!name || /\d/.test(name))) name = email
  if (!name) name = email || 'Unknown'

  return { name, email, dateText: dateText || '' }
}

export function formatThreadDate(input?: string) {
  if (!input) return ''
  const parsed = parseDateCandidate(input)
  if (parsed) return parsed.toLocaleString()
  const d = new Date(input)
  if (Number.isNaN(d.getTime())) return input
  return d.toLocaleString()
}

export function splitPlainThread(text: string) {
  if (!text) return []
  let cleaned = text.replace(/\r/g, '')
  cleaned = cleaned.replace(/[\u00A0\u202F\u2007]/g, ' ')
  const lines = cleaned.split('\n')
  const headerPatterns = [
    /^\s*On\b.*wrote:$/i,
    /^-{2,}\s*$/,
    /^-----Original Message-----$/i,
    /^From:\s.*$/i
  ]
  const isEmailLine = (ln: string) => /<\s*[^>\s]+@[^>\s]+\s*>/.test(ln) || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ln)
  const extractEmail = (ln: string) => {
    const match = ln.match(/<\s*([^>\s]+@[^>\s]+)\s*>/) || ln.match(/([^@\s]+@[^@\s]+\.[^@\s]+)/)
    return match ? match[1] : ''
  }
  const isDateLine = (ln: string) => !!parseDateCandidate(ln)
  const isLikelyNameLine = (ln: string) => !!ln && !isEmailLine(ln) && !isDateLine(ln) && ln.length <= 80

  const segments: Array<{ header?: string; body: string }> = []
  let currentLines: string[] = []
  let currentHeader: string | undefined = undefined

  const isHeader = (ln: string) => headerPatterns.some(p => p.test(ln.trim()))
  const detectHeaderBlock = (startIndex: number) => {
    const entries: Array<{ text: string; index: number }> = []
    let j = startIndex
    while (j < lines.length && entries.length < 4) {
      const t = lines[j].trim()
      if (t) entries.push({ text: t, index: j })
      j += 1
    }
    if (!entries.length) return null
    const dateEntry = entries.find(e => isDateLine(e.text))
    if (!dateEntry) return null
    const datePos = entries.indexOf(dateEntry)
    if (datePos > 2) return null
    const emailEntry = entries.find(e => isEmailLine(e.text))
    const nameEntry = entries.find(e => isLikelyNameLine(e.text) && e.text !== dateEntry.text)
    if (!emailEntry && !nameEntry) return null

    const email = emailEntry ? extractEmail(emailEntry.text) : ''
    const name = nameEntry ? nameEntry.text : ''
    const who = name || email || 'Unknown'
    const emailSuffix = email ? ` <${email}>` : ''
    const header = `On ${dateEntry.text} ${who}${name ? emailSuffix : email ? emailSuffix : ''} wrote:`
    return { header, endIndex: dateEntry.index }
  }

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]
    if (isHeader(ln)) {
      if (currentLines.length) {
        segments.push({ header: currentHeader, body: currentLines.join('\n').trim() })
      }
      currentHeader = ln.trim()
      currentLines = []
      continue
    }
    const block = detectHeaderBlock(i)
    if (block) {
      if (currentLines.length) {
        segments.push({ header: currentHeader, body: currentLines.join('\n').trim() })
      }
      currentHeader = block.header
      currentLines = []
      i = block.endIndex
      continue
    }
    currentLines.push(ln)
  }
  if (currentLines.length) segments.push({ header: currentHeader, body: currentLines.join('\n').trim() })
  return segments
}

export function splitHtmlThread(html: string) {
  if (!html) return []
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    const body = doc.body
    const normalize = (s: string) => s.replace(/[\u00A0\u202F\u2007]/g, ' ').trim()
    const headerRe = /^\s*On\b.*wrote:\s*$/i
    const originalMessageRe = /^-+\s*Original Message\s*-+$/i
    const headerLabels = ['From', 'Sent', 'To', 'Subject', 'Cc', 'Date']
    const headerLabelRe = new RegExp(`\\b(${headerLabels.join('|')})\\s*:\\s*`, 'gi')

    const isHeaderText = (raw: string) => {
      const text = normalize(raw)
      if (!text) return false
      if (headerRe.test(text)) return true
      if (originalMessageRe.test(text)) return true
      const matches = text.match(headerLabelRe)
      if (matches && matches.length >= 2) return true
      return false
    }

    const segments: Array<{ header?: string; bodyHtml: string }> = []
    let currentNodes: Node[] = []
    let currentHeader: string | undefined = undefined

    const flushCurrent = () => {
      if (!currentNodes.length) return
      const container = doc.createElement('div')
      currentNodes.forEach(n => container.appendChild(n.cloneNode(true)))
      const htmlOut = container.innerHTML.trim()
      if (htmlOut) segments.push({ header: currentHeader, bodyHtml: htmlOut })
      currentNodes = []
    }

    const pushInnerParts = (innerParts: Array<{ header?: string; bodyHtml: string }>, inheritedHeader?: string) => {
      if (!innerParts.length) return
      const merged = innerParts.map(p => ({ ...p }))
      if (inheritedHeader && !merged[0].header) merged[0].header = inheritedHeader
      merged.forEach(p => segments.push({ header: p.header, bodyHtml: p.bodyHtml }))
    }

    const children = Array.from(body.childNodes)
    for (const node of children) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement
        const text = normalize(el.textContent || '')

        if (el.classList.contains('gmail_quote_container') || el.classList.contains('gmail_quote')) {
          flushCurrent()
          const headerEl = el.querySelector('.gmail_attr') as HTMLElement | null
          const headerText = headerEl ? normalize(headerEl.textContent || '') : undefined
          if (headerText && isHeaderText(headerText)) currentHeader = headerText

          const quoteEl = el.querySelector('blockquote') as HTMLElement | null
          if (quoteEl) {
            const innerParts = splitHtmlThread(quoteEl.innerHTML)
            if (innerParts.length) {
              pushInnerParts(innerParts, currentHeader)
              currentHeader = undefined
            } else {
              segments.push({ header: currentHeader, bodyHtml: quoteEl.outerHTML })
              currentHeader = undefined
            }
          } else {
            segments.push({ header: currentHeader, bodyHtml: el.innerHTML })
            currentHeader = undefined
          }
          continue
        }

        if (el.tagName.toLowerCase() === 'blockquote') {
          flushCurrent()
          const innerParts = splitHtmlThread(el.innerHTML)
          if (innerParts.length) {
            pushInnerParts(innerParts, currentHeader)
            currentHeader = undefined
          } else {
            segments.push({ header: currentHeader, bodyHtml: el.outerHTML })
            currentHeader = undefined
          }
          continue
        }

        if (text && isHeaderText(text)) {
          flushCurrent()
          currentHeader = text
          continue
        }
      } else if (node.nodeType === Node.TEXT_NODE) {
        const text = normalize(node.textContent || '')
        if (text && isHeaderText(text)) {
          flushCurrent()
          currentHeader = text
          continue
        }
      }

      currentNodes.push(node)
    }

    flushCurrent()
    return segments
  } catch (_) {
    return []
  }
}

export function buildThreadItemsFromPlain(text: string, fallback: { name: string; email?: string; dateText?: string }) {
  const parts = splitPlainThread(text)
  if (!parts || !parts.length) return []
  return parts.map((p, idx) => {
    const headerInfo = p.header ? parseThreadHeader(p.header) : { name: fallback.name, email: fallback.email || '', dateText: fallback.dateText || '' }
    return {
      id: `${idx}-${headerInfo.email || headerInfo.name}`,
      header: p.header,
      name: headerInfo.name,
      email: headerInfo.email,
      dateText: headerInfo.dateText,
      bodyText: p.body,
      bodyHtml: undefined as string | undefined
    }
  })
}

export function buildThreadItemsFromHtml(html: string, fallback: { name: string; email?: string; dateText?: string }) {
  const parts = splitHtmlThread(html)
  if (!parts || !parts.length) return []
  return parts.map((p, idx) => {
    const headerInfo = p.header ? parseThreadHeader(p.header) : { name: fallback.name, email: fallback.email || '', dateText: fallback.dateText || '' }
    return {
      id: `${idx}-${headerInfo.email || headerInfo.name}`,
      header: p.header,
      name: headerInfo.name,
      email: headerInfo.email,
      dateText: headerInfo.dateText,
      bodyText: undefined as string | undefined,
      bodyHtml: p.bodyHtml
    }
  })
}

export default { parseDateCandidate, parseThreadHeader, formatThreadDate, splitPlainThread, splitHtmlThread, buildThreadItemsFromPlain, buildThreadItemsFromHtml }
