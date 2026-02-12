export function stripTrackingPixels(html: string): string {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    const images = Array.from(doc.querySelectorAll('img'))

    images.forEach(img => {
      const widthAttr = img.getAttribute('width')
      const heightAttr = img.getAttribute('height')
      const style = img.getAttribute('style') || ''
      const src = (img.getAttribute('src') || '').toLowerCase()

      const width = widthAttr ? Number(widthAttr) : null
      const height = heightAttr ? Number(heightAttr) : null

      const isTiny = (width !== null && width <= 1) || (height !== null && height <= 1)
      const styleTiny = /width\s*:\s*1px|height\s*:\s*1px|display\s*:\s*none/.test(style.toLowerCase())
      const srcLooksLikePixel = /pixel|tracking|open\.gif|\/open\b|\/track\b|\/tracking\b/.test(src)
      const dataGif = src.startsWith('data:image/gif')

      if (isTiny || styleTiny || srcLooksLikePixel || dataGif) {
        img.remove()
      }
    })

    return doc.body.innerHTML
  } catch (_) {
    return html
  }
}

export function plainTextToHtml(text: string) {
  try {
    const dec = (() => {
      const d = document.createElement('div')
      d.innerHTML = text || ''
      return d.textContent || d.innerText || ''
    })()
    const esc = String(dec)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    const parts = esc.split('\n').map(p => `<div>${p}</div>`).join('')
    return `<blockquote style="margin:0 0 8px 0;padding-left:12px;border-left:3px solid rgba(0,0,0,0.08);">${parts}</blockquote>`
  } catch (_) {
    return `<blockquote>${String(text).replace(/</g,'&lt;')}</blockquote>`
  }
}

export function htmlToPlainText(html: string) {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    const blockTags = new Set(['p', 'div', 'br', 'li', 'blockquote', 'tr', 'table', 'header', 'footer', 'section'])
    const out: string[] = []

    function walk(node: Node) {
      if (node.nodeType === Node.TEXT_NODE) {
        out.push((node as Text).textContent || '')
        return
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return
      const el = node as HTMLElement
      const tag = el.tagName.toLowerCase()
      if (tag === 'br') {
        out.push('\n')
        return
      }
      const isBlock = blockTags.has(tag)
      if (isBlock) out.push('\n')
      for (const child of Array.from(el.childNodes)) walk(child)
      if (isBlock) out.push('\n')
    }

    walk(doc.body)
    return out.join('').replace(/\u00A0/g, ' ').replace(/\n{3,}/g, '\n\n').replace(/\s+$/g, '').trim()
  } catch (_) {
    return html.replace(/<[^>]+>/g, '')
  }
}

export function htmlQuote(html: string, meta: any, formatDate: (i?: any)=>string, formatFrom: (h:any)=>string) {
  try {
    const cleaned = stripTrackingPixels(html || '')
    const parser = new DOMParser()
    const doc = parser.parseFromString(cleaned, 'text/html')

    const wrapper = document.createElement('div')
    const header = document.createElement('div')
    header.style.marginBottom = '8px'
    header.style.color = 'rgba(0,0,0,0.6)'
    header.textContent = `On ${formatDate(meta?.internalDate)} ${formatFrom(meta?.fromHeader)} wrote:`

    const block = document.createElement('blockquote')
    block.style.margin = '0'
    block.style.paddingLeft = '12px'
    block.style.borderLeft = '3px solid rgba(0,0,0,0.08)'

    Array.from(doc.body.childNodes).forEach(n => block.appendChild(n.cloneNode(true)))

    wrapper.appendChild(header)
    wrapper.appendChild(block)
    return wrapper.innerHTML
  } catch (_) {
    return `<blockquote>${String(html)}</blockquote>`
  }
}

export function buildQuotedOriginalHTML(msg: any, formatDate: (i?: any)=>string, formatFrom: (h:any)=>string) {
  if (!msg) return ''
  try {
    if (msg.html) return htmlQuote(msg.html, msg, formatDate, formatFrom)
    const header = `<div style="margin-bottom:8px;color:rgba(0,0,0,0.6)">On ${formatDate(msg.internalDate)} ${formatFrom(msg.fromHeader)} wrote:</div>`
    return header + plainTextToHtml(msg.text || msg.body || '')
  } catch (_) {
    return plainTextToHtml(msg.text || msg.body || '')
  }
}

export function blockRemoteImages(html: string): { html: string; blockedCount: number } {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    const images = Array.from(doc.querySelectorAll('img'))
    let blocked = 0

    images.forEach(img => {
      const src = (img.getAttribute('src') || '').trim()
      const isRemote = /^https?:\/\//i.test(src)
      if (isRemote) {
        img.setAttribute('data-remote-src', src)
        img.removeAttribute('src')
        img.setAttribute('alt', img.getAttribute('alt') || 'Remote image blocked')
        img.setAttribute('style', `${img.getAttribute('style') || ''}; opacity:0.6; border:1px dashed #c0c0c0; min-height:12px;`)
        blocked += 1
      }
    })

    return { html: doc.body.innerHTML, blockedCount: blocked }
  } catch (_) {
    return { html, blockedCount: 0 }
  }
}

export default { stripTrackingPixels, plainTextToHtml, htmlToPlainText, htmlQuote, buildQuotedOriginalHTML, blockRemoteImages }
