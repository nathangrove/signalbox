import React, { useEffect, useMemo, useRef, useState } from 'react'
import ReactQuill from 'react-quill'
import 'react-quill/dist/quill.snow.css'
import { archiveCategoryAll, archiveCategoryAllByAccount, enqueueMessageAi, getAccounts, getMailboxes, getMessage, getMessages, getMessagesByAccount, markCategoryReadAll, markCategoryReadAllByAccount, markMessageRead, markMessageUnread, setMessageArchived, syncAccount, downloadAttachment, sendMessage, updateMessageLabels } from '../api'
import { initSocket } from '../socket'
import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import Select from '@mui/material/Select'
import List from '@mui/material/List'
import ListSubheader from '@mui/material/ListSubheader'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import Divider from '@mui/material/Divider'
import CircularProgress from '@mui/material/CircularProgress'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import Avatar from '@mui/material/Avatar'
import ArchiveIcon from '@mui/icons-material/Archive'
import UnarchiveIcon from '@mui/icons-material/Unarchive'
import LaunchIcon from '@mui/icons-material/Launch'
import Tooltip from '@mui/material/Tooltip'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Fab from '@mui/material/Fab'
import SendIcon from '@mui/icons-material/Send'
import CloseIcon from '@mui/icons-material/Close'
import ReplyIcon from '@mui/icons-material/Reply'
import { isValid, parse } from 'date-fns'

function categoryColor(category?: string | null) {
  switch ((category || '').toLowerCase()) {
    case 'promotions': return 'warning'
    case 'updates': return 'success'
    case 'social': return 'info'
    case 'other': return 'secondary'
    case 'newsletters': return 'primary'
    case 'primary': return 'default'
    default: return 'default'
  }
}
import TextField from '@mui/material/TextField'

function formatFrom(fromHeader: any): string {
  const list = Array.isArray(fromHeader) ? fromHeader : []
  if (!list.length) return 'Unknown sender'
  const first = list[0]
  return first.name ? `${first.name} <${first.address}>` : first.address
}

function formatRecipients(toHeader: any): string {
  try {
    if (!toHeader) return ''
    const list = Array.isArray(toHeader) ? toHeader : (typeof toHeader === 'string' ? [toHeader] : [])
    const parts = list.map((t: any) => {
      if (!t) return ''
      if (typeof t === 'string') return t
      return t.name ? `${t.name} <${t.address}>` : (t.address || '')
    }).filter(Boolean)
    if (!parts.length) return ''
    const joined = parts.join(', ')
    return joined.length > 80 ? joined.slice(0, 77) + '...' : joined
  } catch (_) {
    return ''
  }
}

function formatRecipientsElements(toHeader: any) {
  try {
    const list = Array.isArray(toHeader) ? toHeader : (typeof toHeader === 'string' ? [{ address: toHeader }] : [])
    const nodes = list.map((t: any, idx: number) => {
      const email = typeof t === 'string' ? t : (t.address || '')
      const name = typeof t === 'string' ? '' : (t.name || '')
      const display = name ? name : email
      return (
        <React.Fragment key={idx}>
          <Tooltip title={email} arrow>
            <span style={{ fontWeight: 500 }}>{display}</span>
          </Tooltip>
          {idx < list.length - 1 ? ', ' : ''}
        </React.Fragment>
      )
    })
    return <>{nodes}</>
  } catch (_) {
    return null
  }
}

function getSenderAddress(fromHeader: any): string | null {
  const list = Array.isArray(fromHeader) ? fromHeader : []
  if (!list.length) return null
  const first = list[0]
  return first.address || null
}

function formatDate(input?: string | Date | null) {
  if (!input) return ''
  const d = new Date(input)
  return d.toLocaleString()
}

function timeAgo(input?: string | Date | null) {
  if (!input) return ''
  const then = new Date(input)
  const now = new Date()
  const diffSec = Math.floor((now.getTime() - then.getTime()) / 1000)
  if (diffSec < 10) return 'just now'
  if (diffSec < 60) return `${diffSec} seconds ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`
  // fallback to date for older
  return then.toLocaleString()
}

function stripTrackingPixels(html: string): string {
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

function plainTextToHtml(text: string) {
  try {
    // decode any existing HTML entities, then escape and convert newlines to <br>
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

function htmlQuote(html: string, meta: any) {
  try {
    // sanitize minimal tracking pixels and then wrap original HTML in a blockquote
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

    // move children from parsed body into blockquote
    Array.from(doc.body.childNodes).forEach(n => block.appendChild(n.cloneNode(true)))

    wrapper.appendChild(header)
    wrapper.appendChild(block)
    return wrapper.innerHTML
  } catch (_) {
    return `<blockquote>${String(html)}</blockquote>`
  }
}

function buildQuotedOriginalHTML(msg: any) {
  if (!msg) return ''
  try {
    if (msg.html) return htmlQuote(msg.html, msg)
    // plain text fallback: include header and plainTextToHtml-wrapped body
    const header = `<div style="margin-bottom:8px;color:rgba(0,0,0,0.6)">On ${formatDate(msg.internalDate)} ${formatFrom(msg.fromHeader)} wrote:</div>`
    return header + plainTextToHtml(msg.text || msg.body || '')
  } catch (_) {
    return plainTextToHtml(msg.text || msg.body || '')
  }
}

function splitPlainThread(text: string) {
  if (!text) return []
  let cleaned = text.replace(/\r/g, '')
  // normalize common non-breaking spaces and similar unicode whitespace
  cleaned = cleaned.replace(/[\u00A0\u202F\u2007]/g, ' ')
  const lines = cleaned.split('\n')
  const headerPatterns = [
    /^\s*On\b.*wrote:$/i,
    /^-{2,}\s*$/,
    /^-----Original Message-----$/i,
    /^From:\s.*$/i
  ]

  const segments: Array<{ header?: string; body: string }> = []
  let currentLines: string[] = []
  let currentHeader: string | undefined = undefined

  const isHeader = (ln: string) => headerPatterns.some(p => p.test(ln.trim()))

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
    currentLines.push(ln)
  }
  if (currentLines.length) segments.push({ header: currentHeader, body: currentLines.join('\n').trim() })
  return segments
}

function splitHtmlThread(html: string) {
  if (!html) return []
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    const body = doc.body
    const headerRe = /^\s*On\b.*wrote:\s*$/i
    const normalize = (s: string) => s.replace(/[\u00A0\u202F\u2007]/g, ' ').trim()

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

    const children = Array.from(body.childNodes)
    for (const node of children) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement
        const text = normalize(el.textContent || '')

        // Gmail quote container: header in .gmail_attr and quoted body in blockquote
        if (el.classList.contains('gmail_quote_container') || el.classList.contains('gmail_quote')) {
          flushCurrent()
          const headerEl = el.querySelector('.gmail_attr') as HTMLElement | null
          const headerText = headerEl ? normalize(headerEl.textContent || '') : undefined
          if (headerText && headerRe.test(headerText)) currentHeader = headerText

          const quoteEl = el.querySelector('blockquote') as HTMLElement | null
          if (quoteEl) {
            const innerParts = splitHtmlThread(quoteEl.innerHTML)
            if (innerParts.length) {
              segments.push({ header: currentHeader, bodyHtml: innerParts[0].bodyHtml })
              for (let i = 1; i < innerParts.length; i += 1) {
                segments.push({ header: innerParts[i].header, bodyHtml: innerParts[i].bodyHtml })
              }
              currentHeader = undefined
            } else {
              segments.push({ header: currentHeader, bodyHtml: quoteEl.outerHTML })
              currentHeader = undefined
            }
          } else {
            // fallback: use container html
            segments.push({ header: currentHeader, bodyHtml: el.innerHTML })
            currentHeader = undefined
          }
          continue
        }

        if (el.tagName.toLowerCase() === 'blockquote') {
          flushCurrent()
          const innerParts = splitHtmlThread(el.innerHTML)
          if (innerParts.length) {
            segments.push({ header: currentHeader, bodyHtml: innerParts[0].bodyHtml })
            for (let i = 1; i < innerParts.length; i += 1) {
              segments.push({ header: innerParts[i].header, bodyHtml: innerParts[i].bodyHtml })
            }
            currentHeader = undefined
          } else {
            segments.push({ header: currentHeader, bodyHtml: el.outerHTML })
            currentHeader = undefined
          }
          continue
        }

        if (text && headerRe.test(text)) {
          flushCurrent()
          currentHeader = text
          continue
        }
      } else if (node.nodeType === Node.TEXT_NODE) {
        const text = normalize(node.textContent || '')
        if (text && headerRe.test(text)) {
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

function parseDateCandidate(input: string): Date | null {
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

function parseThreadHeader(raw?: string) {
  if (!raw) return { name: '', email: '', dateText: '' }
  // strip common wrappers
  let text = String(raw).replace(/^On\s+/i, '').replace(/\s*wrote:\s*$/i, '').trim()
  text = text.replace(/[\u00A0\u202F\u2007]/g, ' ').replace(/\s+/g, ' ').trim()

  // extract email if present
  let email = ''
  const emailMatch = text.match(/<\s*([^>\s]+@[^>\s]+)\s*>/)
  if (emailMatch) email = emailMatch[1]
  else {
    const bare = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/)
    if (bare) email = bare[1]
  }

  // tokenise by whitespace so we can locate date/name positions
  const tokens = text.split(/\s+/).filter(Boolean)
  const tokenCount = tokens.length
  const emailIndex = email ? tokens.findIndex(t => t.includes(email) || t.replace(/[<>]/g, '') === email) : -1

  // sliding window: find the longest contiguous token span that parses to a Date
  let bestStart = -1
  let bestEnd = -1
  let bestCandidate = ''
  for (let start = 0; start < tokenCount; start += 1) {
    for (let end = start; end < Math.min(tokenCount, start + 12); end += 1) {
      const candidate = tokens.slice(start, end + 1).join(' ').replace(/^[,;:\s]+|[,;:\s]+$/g, '')
      if (!candidate) continue
      const d = parseDateCandidate(candidate)
      if (d) {
        // prefer longer (more specific) matches
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
    // heuristics to pick a name nearby the date and/or email
    if (email && emailIndex !== -1) {
      if (emailIndex > bestEnd) {
        name = tokens.slice(bestEnd + 1, emailIndex).join(' ')
      } else if (emailIndex < bestStart) {
        name = tokens.slice(emailIndex + 1, bestStart).join(' ')
      } else {
        name = tokens.slice(bestEnd + 1).join(' ')
      }
    } else {
      // no email: take what's after the date (common pattern)
      name = tokens.slice(bestEnd + 1).join(' ')
    }
  } else {
    // no date found: try to pull a name around an email or use the whole text
    if (email && emailIndex !== -1) {
      // tokens before the email are commonly the name
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

function formatThreadDate(input?: string) {
  if (!input) return ''
  const parsed = parseDateCandidate(input)
  if (parsed) return parsed.toLocaleString()
  const d = new Date(input)
  if (Number.isNaN(d.getTime())) return input
  return d.toLocaleString()
}

function buildThreadItemsFromPlain(text: string, fallback: { name: string; email?: string; dateText?: string }) {
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

function buildThreadItemsFromHtml(html: string, fallback: { name: string; email?: string; dateText?: string }) {
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

function blockRemoteImages(html: string): { html: string; blockedCount: number } {
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

function loadPrefs<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : fallback
  } catch (_) {
    return fallback
  }
}

function savePrefs<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value))
}

export default function Mail(){
  const [accounts, setAccounts] = useState<any[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [mailboxes, setMailboxes] = useState<any[]>([])
  const [messages, setMessages] = useState<any[]>([])
  const [selectedMailbox, setSelectedMailbox] = useState<any | null>(null)
  const [selectedMessage, setSelectedMessage] = useState<any | null>(null)
  const [messageDetail, setMessageDetail] = useState<any | null>(null)
  const [loadingBoxes, setLoadingBoxes] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [loadingMessage, setLoadingMessage] = useState(false)
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const pageSize = 50
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const [allowImagesForMessage, setAllowImagesForMessage] = useState<Record<string, boolean>>({})
  const [allowImagesForSender, setAllowImagesForSender] = useState<Record<string, boolean>>({})
  const [syncing, setSyncing] = useState(false)
  const [aiProcessing, setAiProcessing] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ mouseX: number; mouseY: number; id: string } | null>(null)
  const contextMessage = useMemo(() => contextMenu ? messages.find(m => m.id === contextMenu.id) ?? null : null, [contextMenu, messages])
  const [categoryMenu, setCategoryMenu] = useState<{ mouseX: number; mouseY: number; mailboxId?: string; accountId?: string; category: string } | null>(null)
  const [openMessageRequest, setOpenMessageRequest] = useState<{ messageId: string; mailboxId?: string } | null>(null)

  useEffect(() => {
    (async()=>{
      const accs = await getAccounts()
      const list = Array.isArray(accs) ? accs : []
      setAccounts(list)
      if (list.length) setSelectedAccountId(list[0].id || null)
    })()
  },[])

  useEffect(() => {
    (async()=>{
      setLoadingBoxes(true)
      try{
        const data = await getMailboxes()
        setMailboxes(Array.isArray(data) ? data : [])
        // mailbox selection deferred to initial route sync effect so we can prefer
        // a mailbox matching the selected account when available
      } finally {
        setLoadingBoxes(false)
      }
    })()
  },[])

  // Routing helpers: /mail/:mailboxId/:category
  function parseRoute() {
    try {
      const parts = window.location.pathname.split('/').filter(Boolean)
      // expecting ['mail', mailboxId, category?]
      if (parts[0] !== 'mail') return { mailboxId: null, category: null }
      const mailboxId = parts[1] || null
      const category = parts[2] && parts[2] !== 'all' ? decodeURIComponent(parts[2]) : null
      return { mailboxId, category }
    } catch (_) { return { mailboxId: null, category: null } }
  }

  function buildRoute(mailboxId?: string | null, category?: string | null) {
    const mb = mailboxId ? encodeURIComponent(String(mailboxId)) : ''
    const cat = category ? encodeURIComponent(String(category)) : 'all'
    let path = '/mail'
    if (mb) path += `/${mb}`
    else return path
    path += `/${cat}`
    return path
  }

  function replaceRoute(mailboxId?: string | null, category?: string | null) {
    const path = buildRoute(mailboxId, category)
    try { window.history.pushState({}, '', path) } catch (_) { window.location.hash = path }
  }

  // initial route sync when mailboxes are loaded; prefer selected account's mailbox
  useEffect(() => {
    if (!mailboxes || !mailboxes.length) return
    const { mailboxId, category } = parseRoute()
    if (mailboxId) {
      const mb = mailboxes.find(b => b.id === mailboxId)
      if (mb) setSelectedMailbox(mb)
    } else if (selectedAccountId) {
      const mb = mailboxes.find(b => b.accountId === selectedAccountId)
      if (mb) setSelectedMailbox(mb)
      else setSelectedMailbox(mailboxes[0])
    } else {
      setSelectedMailbox(mailboxes[0])
    }
    // do not default to a category; respect route or leave null for all
    setSelectedCategory(category || null)
  }, [mailboxes, selectedAccountId])

  // handle browser back/forward
  useEffect(() => {
    const onPop = () => {
      const { mailboxId, category } = parseRoute()
      if (mailboxId && mailboxes && mailboxes.length) {
        const mb = mailboxes.find(b => b.id === mailboxId)
        if (mb) setSelectedMailbox(mb)
      }
      setSelectedCategory(category)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [mailboxes])

  useEffect(() => {
    if (!selectedMailbox) return
    setMessages([])
    setOffset(0)
    setHasMore(true)
    ;(async()=>{
      setLoadingMessages(true)
      try{
        const accountId = selectedMailbox.accountId
        const data = accountId ? await getMessagesByAccount(accountId, pageSize, 0, debouncedSearch, selectedCategory || undefined) : []
        const list = Array.isArray(data) ? data : []
        setMessages(list)
        // do not auto-select a message when a folder is first selected — leave preview empty
        setSelectedMessage(null)
        setMessageDetail(null)
        setOffset(list.length)
        setHasMore(list.length === pageSize)
      } finally {
        setLoadingMessages(false)
      }
    })()
  },[selectedMailbox?.id, debouncedSearch, selectedCategory])

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => window.clearTimeout(handle)
  }, [search])

  useEffect(() => {
    const s = initSocket();

    function onCreated(payload: any) {
      if (!selectedMailbox) return;
      const mb = mailboxes.find(b => b.id === payload.mailboxId)
      if (!mb) return;
      if (mb.accountId !== selectedMailbox.accountId) return;
      refreshMailboxes();
      (async () => {
        try {
          const data = await getMessagesByAccount(selectedMailbox.accountId, pageSize, 0, debouncedSearch, selectedCategory || undefined);
          const list = Array.isArray(data) ? data : [];
          setMessages(list);
          setOffset(list.length);
          setHasMore(list.length === pageSize);
        } catch (e) { console.warn('refresh after created failed', e); }
      })();
    }

    function onUpdated(payload: any) {
      const messageId = payload.messageId || payload.id;
      if (!messageId) return;
      const changes = payload.changes || {};
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, ...changes } : m));
      if (typeof changes.read === 'boolean' || typeof changes.archived === 'boolean') {
        refreshMailboxes();
      }
      if (selectedMessage?.id === messageId) {
        (async () => {
          try {
            const data = await getMessage(messageId);
            setMessageDetail(data);
          } catch (e) { console.warn('refresh message detail failed', e); }
        })();
      }
    }

    s.on('message.created', onCreated);
    s.on('message.updated', onUpdated);
    return () => {
      s.off('message.created', onCreated);
      s.off('message.updated', onUpdated);
    }
  }, [selectedMailbox?.id, selectedCategory, debouncedSearch, selectedMessage?.id])

  // Listen for external requests to open a specific message (from desktop notification click)
  useEffect(() => {
    function handler(ev: any) {
      try {
        const detail = ev?.detail || {};
        if (!detail?.messageId) return;
        setOpenMessageRequest({ messageId: detail.messageId, mailboxId: detail.mailboxId });
      } catch (e) { console.warn('openMessage event handler error', e); }
    }
    window.addEventListener('openMessage', handler as any);
    return () => window.removeEventListener('openMessage', handler as any);
  }, []);

  // Process openMessage requests: ensure mailbox selected and load message
  useEffect(() => {
    if (!openMessageRequest) return;
    (async () => {
      const { messageId, mailboxId } = openMessageRequest;
      try {
        // if mailboxId provided, select mailbox
        if (mailboxId && mailboxes && mailboxes.length) {
          const mb = mailboxes.find(b => b.id === mailboxId);
          if (mb) setSelectedMailbox(mb);
        }

        // fetch message directly and set selection + detail
        const msg = await getMessage(messageId);
        if (msg) {
          // if message contains mailboxId ensure mailbox selected
          if (msg.mailboxId && mailboxes && mailboxes.length) {
            const mb2 = mailboxes.find(b => b.id === msg.mailboxId);
            if (mb2) setSelectedMailbox(mb2);
          }
          setSelectedMessage({ id: msg.id });
          setMessageDetail(msg);
        }
      } catch (e) {
        console.warn('openMessage processing failed', e);
      } finally {
        setOpenMessageRequest(null);
      }
    })();
  }, [openMessageRequest, mailboxes]);

  useEffect(() => {
    setAllowImagesForMessage(loadPrefs<Record<string, boolean>>('mail_allow_images_message', {}))
    setAllowImagesForSender(loadPrefs<Record<string, boolean>>('mail_allow_images_sender', {}))
  }, [])

  useEffect(() => {
    let readTimer: any = null
    if (!selectedMessage) { setMessageDetail(null); return }
    ;(async()=>{
      setLoadingMessage(true)
      try{
        const data = await getMessage(selectedMessage.id)
        setMessageDetail(data)
        // update route (message ID is no longer included)
        replaceRoute(selectedMailbox?.id || null, selectedCategory || null)
        // start read timer: if opened for >2s mark as read
        if (data && !data.read) {
          if (readTimer) clearTimeout(readTimer)
          readTimer = setTimeout(async () => {
            try {
              await markMessageRead(data.id)
              setMessageDetail((d: any) => d ? { ...d, read: true } : d)
              setMessages((prev: any[]) => prev.map(m => m.id === data.id ? { ...m, read: true } : m))
            } catch (e) {
              console.warn('mark read failed', e)
            }
          }, 2000)
        }
      } finally {
        setLoadingMessage(false)
      }
    })()

    return () => { if (readTimer) clearTimeout(readTimer) }
  },[selectedMessage?.id])

  const mailboxTitle = useMemo(() => {
    if (!selectedMailbox) return 'Mailboxes'
    const account = accounts.find(a => a.id === selectedMailbox.accountId)
    return account ? `${account.email} · ${selectedMailbox.name}` : selectedMailbox.name
  }, [selectedMailbox, accounts])

  const groupedMailboxes = useMemo(() => {
    const groups: Record<string, any[]> = {}
    for (const box of mailboxes) {
      const key = box.accountEmail || 'Account'
      if (!groups[key]) groups[key] = []
      groups[key].push(box)
    }
    return groups
  }, [mailboxes])

  // If an account is selected, only show that account's mailbox group
  const mailboxGroups = useMemo(() => {
    if (!selectedAccountId) return Object.entries(groupedMailboxes)
    const acc = accounts.find(a => a.id === selectedAccountId)
    if (!acc) return Object.entries(groupedMailboxes)
    return Object.entries(groupedMailboxes).filter(([email]) => email === acc.email)
  }, [groupedMailboxes, selectedAccountId, accounts])

  // Group messages by date for list view: today, yesterday, past 7 days, older
  const groupedMessagesByDate = useMemo(() => {
    const sections: Record<string, any[]> = { today: [], yesterday: [], last7: [], older: [] }
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const startOfYesterday = new Date(startOfToday)
    startOfYesterday.setDate(startOfYesterday.getDate() - 1)
    const sevenDaysAgo = new Date(startOfToday)
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    for (const msg of messages || []) {
      const d = msg.internalDate ? new Date(msg.internalDate) : null
      let bucket = 'older'
      if (!d) {
        bucket = 'older'
      } else if (d >= startOfToday) {
        bucket = 'today'
      } else if (d >= startOfYesterday) {
        bucket = 'yesterday'
      } else if (d >= sevenDaysAgo) {
        bucket = 'last7'
      } else {
        bucket = 'older'
      }
      sections[bucket].push(msg)
    }

    return sections
  }, [messages])

  const senderAddress = useMemo(() => {
    return messageDetail ? getSenderAddress(messageDetail.fromHeader) : null
  }, [messageDetail])

  const imagesAllowed = useMemo(() => {
    if (!messageDetail?.id) return false
    if (senderAddress && allowImagesForSender[senderAddress]) return true
    return !!allowImagesForMessage[messageDetail.id]
  }, [messageDetail, senderAddress, allowImagesForSender, allowImagesForMessage])

  const sanitizedHtml = useMemo(() => {
    if (!messageDetail?.html) return { html: '', blockedCount: 0 }
    let base = stripTrackingPixels(messageDetail.html)

    // Replace cid: image sources with inline attachment URLs when attachments are present
    try {
      if (messageDetail.attachments && Array.isArray(messageDetail.attachments) && messageDetail.attachments.length) {
        for (const at of messageDetail.attachments) {
          if (!at || !at.contentId) continue
          const cid = String(at.contentId).replace(/^<|>$/g, '')
          const re = new RegExp(`(["\'])cid:${cid}(["\'])`, 'gi')
          const url = `/api/v1/messages/${encodeURIComponent(messageDetail.id)}/attachments/${encodeURIComponent(at.id)}?inline=1`
          base = base.replace(re, `$1${url}$2`)
        }
      }
    } catch (_) {}

    return imagesAllowed ? { html: base, blockedCount: 0 } : blockRemoteImages(base)
  }, [messageDetail, imagesAllowed])

  const parsedAiAction = useMemo(() => {
    if (!messageDetail?.aiAction) return null
    try {
      return typeof messageDetail.aiAction === 'string' ? JSON.parse(messageDetail.aiAction) : messageDetail.aiAction
    } catch (_err) {
      return null
    }
  }, [messageDetail?.aiAction])

  const parsedAiItinerary = useMemo(() => {
    if (!messageDetail?.aiItinerary) return []
    try { return typeof messageDetail.aiItinerary === 'string' ? JSON.parse(messageDetail.aiItinerary) : messageDetail.aiItinerary }
    catch (_err) { return [] }
  }, [messageDetail?.aiItinerary])

  const parsedAiTracking = useMemo(() => {
    if (!messageDetail?.aiTracking) return []
    try { return typeof messageDetail.aiTracking === 'string' ? JSON.parse(messageDetail.aiTracking) : messageDetail.aiTracking }
    catch (_err) { return [] }
  }, [messageDetail?.aiTracking])

  async function handleUpdateMessageCategory(cat: string | null) {
    if (!messageDetail?.id) return
    try {
      await updateMessageLabels(messageDetail.id, { category: cat })
      const data = await getMessage(messageDetail.id)
      if (data) {
        setMessageDetail(data)
        setMessages(prev => prev.map(m => m.id === data.id ? { ...m, category: data.category, spam: data.spam } : m))
      }
    } catch (e) {
      console.warn('update category failed', e)
    }
  }

  async function handleToggleSpam() {
    if (!messageDetail?.id) return
    try {
      const nextSpam = !messageDetail.spam
      await updateMessageLabels(messageDetail.id, { spam: nextSpam })
      const data = await getMessage(messageDetail.id)
      if (data) {
        setMessageDetail(data)
        setMessages(prev => prev.map(m => m.id === data.id ? { ...m, category: data.category, spam: data.spam } : m))
      }
    } catch (e) {
      console.warn('toggle spam failed', e)
    }
  }

  function allowImagesForThisMessage() {
    if (!messageDetail?.id) return
    const next = { ...allowImagesForMessage, [messageDetail.id]: true }
    setAllowImagesForMessage(next)
    savePrefs('mail_allow_images_message', next)
  }

  function allowImagesForThisSender() {
    if (!senderAddress) return
    const next = { ...allowImagesForSender, [senderAddress]: true }
    setAllowImagesForSender(next)
    savePrefs('mail_allow_images_sender', next)
  }


  async function handleSync() {
    if (!selectedMailbox?.accountId || syncing) return
    setSyncing(true)
    try {
      await syncAccount(selectedMailbox.accountId)
    } finally {
      setSyncing(false)
    }
  }

  async function handleAiProcess() {
    if (!messageDetail?.id || aiProcessing) return
    setAiProcessing(true)
    try {
      await enqueueMessageAi(messageDetail.id)
      let data: any = null
      for (let i = 0; i < 8; i += 1) {
        data = await getMessage(messageDetail.id)
        if (data?.category) break
        await new Promise(res => setTimeout(res, 1000))
      }
      if (data) {
        setMessageDetail(data)
        setMessages(prev => prev.map(m => m.id === data.id ? { ...m, category: data.category, spam: data.spam } : m))
      }
    } finally {
      setAiProcessing(false)
    }
  }

  async function setMessageArchivedClient(id: string, archived: boolean) {
    try {
      await setMessageArchived(id, archived)
      if (archived) {
        // when archiving, remove from current list view
        setMessages(prev => prev.filter(m => m.id !== id))
        if (selectedMessage?.id === id) {
          setSelectedMessage(null)
          setMessageDetail(null)
        }
        // update route to remove message id
        replaceRoute(selectedMailbox?.id || null, selectedCategory || null)
      } else {
        // when unarchiving (likely seen via search results), keep it visible and update state
        setMessages(prev => prev.map(m => m.id === id ? { ...m, archived: false } : m))
        if (selectedMessage?.id === id) {
          // refresh message detail to reflect unarchived state
          try {
            const data = await getMessage(id)
            setMessageDetail(data)
            setSelectedMessage(data)
            replaceRoute(selectedMailbox?.id || null, selectedCategory || null)
          } catch (e) {
            console.warn('failed to refresh message after unarchive', e)
          }
        }
      }
    } catch (e) {
      console.warn('archive failed', e)
    }
  }

  async function refreshMailboxes() {
    try {
      const data = await getMailboxes()
      const next = Array.isArray(data) ? data : []
      setMailboxes(next)
      if (selectedMailbox?.id) {
        const updated = next.find((b: any) => b.id === selectedMailbox.id)
        if (updated) setSelectedMailbox(updated)
      }
    } catch (e) {
      console.warn('refresh mailboxes failed', e)
    }
  }

  async function refreshCurrentMessages() {
    if (!selectedMailbox) return
    setLoadingMessages(true)
    try {
      const accountId = selectedMailbox.accountId
      const data = accountId ? await getMessagesByAccount(accountId, pageSize, 0, debouncedSearch, selectedCategory || undefined) : []
      const list = Array.isArray(data) ? data : []
      setMessages(list)
      setSelectedMessage(list.length ? list[0] : null)
      setOffset(list.length)
      setHasMore(list.length === pageSize)
    } finally {
      setLoadingMessages(false)
    }
  }

  async function handleCategoryMarkAllRead(target: { mailboxId?: string; accountId?: string; category: string } | null) {
    if (!target) return
    try {
      if (target.accountId) {
        await markCategoryReadAllByAccount(target.accountId, target.category)
      } else if (target.mailboxId) {
        await markCategoryReadAll(target.mailboxId, target.category)
      }
      await refreshMailboxes()
      // if current view matches target, refresh
      if (target.accountId && selectedMailbox?.accountId === target.accountId) await refreshCurrentMessages()
      else if (target.mailboxId && selectedMailbox?.id === target.mailboxId) await refreshCurrentMessages()
    } catch (e) {
      console.warn('mark all as read failed', e)
    }
  }

  async function handleCategoryArchiveAll(target: { mailboxId?: string; accountId?: string; category: string } | null) {
    if (!target) return
    try {
      if (target.accountId) {
        await archiveCategoryAllByAccount(target.accountId, target.category)
      } else if (target.mailboxId) {
        await archiveCategoryAll(target.mailboxId, target.category)
      }
      await refreshMailboxes()
      if (target.accountId && selectedMailbox?.accountId === target.accountId) await refreshCurrentMessages()
      else if (target.mailboxId && selectedMailbox?.id === target.mailboxId) await refreshCurrentMessages()
    } catch (e) {
      console.warn('archive all failed', e)
    }
  }

  // Composer state and helpers
  const [composerOpen, setComposerOpen] = useState(false)
  const [composerTo, setComposerTo] = useState('')
  const [composerCc, setComposerCc] = useState('')
  const [composerBcc, setComposerBcc] = useState('')
  const [composerSubject, setComposerSubject] = useState('')
  const [composerBody, setComposerBody] = useState('')
  const [composerRich, setComposerRich] = useState(true)
  const [inlineReplyOpen, setInlineReplyOpen] = useState(false)

  function openCompose(prefill?: { to?: string; subject?: string; body?: string }) {
    setComposerTo(prefill?.to || '')
    setComposerCc('')
    setComposerBcc('')
    setComposerSubject(prefill?.subject || '')
    setComposerBody(prefill?.body || '')
    setComposerOpen(true)
  }

  function closeComposer() {
    setComposerOpen(false)
  }

  function openReply() {
    if (!messageDetail) return
    const addr = getSenderAddress(messageDetail.fromHeader) || ''
    let subj = messageDetail.subject || ''
    if (subj && !/^re:/i.test(subj)) subj = `Re: ${subj}`
    setComposerTo(addr)
    setComposerCc('')
    setComposerBcc('')
    setComposerSubject(subj)
    // leave the composer empty for inline reply; original will be appended at send-time
    setComposerBody('')
    setInlineReplyOpen(true)
  }

  function handleSendCompose() {
    if (!composerTo || !composerTo.trim()) {
      alert('Please enter at least one recipient')
      return
    }
    (async () => {
      try {
        const payload: any = {
          accountId: selectedMailbox?.accountId || undefined,
          to: composerTo.trim(),
          cc: composerCc.trim() || undefined,
          bcc: composerBcc.trim() || undefined,
          subject: composerSubject || undefined,
          body: composerRich ? undefined : composerBody || undefined,
          html: composerRich ? composerBody || undefined : undefined
        }
        const res = await sendMessage(payload)
        if (res && res.ok) {
          alert('Message sent')
        } else {
          alert('Send failed')
        }
      } catch (e: any) {
        console.warn('send failed', e)
        alert('Send failed: ' + (e?.message || ''))
      } finally {
        setComposerOpen(false)
      }
    })()
  }

  async function handleSendInline() {
    if (!composerTo || !composerTo.trim()) {
      alert('Please enter at least one recipient')
      return
    }
    try {
      // Ensure subject has a single leading "Re:" (don't prepend twice)
      let subj = composerSubject || ''
      if (subj && !/^re:/i.test(subj)) subj = `Re: ${subj}`
      // Build final body/html by appending the quoted original under the reply
      let finalHtml: string | undefined = undefined
      let finalBody: string | undefined = undefined
      if (composerRich) {
        const quote = messageDetail ? buildQuotedOriginalHTML(messageDetail) : ''
        finalHtml = (composerBody || '') + (composerBody ? '<div style="height:12px"></div>' : '') + quote || undefined
      } else {
        if (messageDetail) {
          const originalPlain = messageDetail.text || ''
          const quotedPlain = `\n\nOn ${formatDate(messageDetail.internalDate)} ${formatFrom(messageDetail.fromHeader)} wrote:\n> ${originalPlain.split('\n').join('\n> ')}`
          finalBody = (composerBody || '') + quotedPlain
        } else {
          finalBody = composerBody || undefined
        }
      }

      const payload: any = {
        accountId: selectedMailbox?.accountId || undefined,
        to: composerTo.trim(),
        cc: composerCc.trim() || undefined,
        bcc: composerBcc.trim() || undefined,
        subject: subj || undefined,
        body: composerRich ? undefined : finalBody,
        html: composerRich ? finalHtml : undefined
      }
      const res = await sendMessage(payload)
      if (res && res.ok) {
        alert('Message sent')
        setInlineReplyOpen(false)
        // Refresh mailbox/messages to show the sent message
        await refreshMailboxes()
        if (selectedMailbox) await refreshCurrentMessages()
      } else {
        alert('Send failed')
      }
    } catch (e: any) {
      console.warn('send failed', e)
      alert('Send failed: ' + (e?.message || ''))
    }
  }

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '260px 360px 1fr', gap: 2, height: 'calc(100vh - 112px)' }}>
      <Paper sx={{ p: 1.5, overflow: 'auto' }}>
        <FormControl fullWidth size="small" sx={{ mb: 1 }}>
          <InputLabel id="account-select-label">Account</InputLabel>
          <Select
            labelId="account-select-label"
            value={selectedAccountId || ''}
            label="Account"
            onChange={(e: any) => {
              const val = e.target.value || null
              setSelectedAccountId(val)
              // when switching accounts: choose the first mailbox for that account
              // and default to the "All" folder (category=null). Also clear preview.
              if (val) {
                const acc = accounts.find(a => a.id === val)
                if (acc) {
                  const firstBox = mailboxes.find(b => b.accountId === acc.id)
                  if (firstBox) {
                    setSelectedMailbox(firstBox)
                    setSelectedCategory(null)
                    setSelectedMessage(null)
                    setMessageDetail(null)
                    try { replaceRoute(firstBox.id, null) } catch (_) {}
                  }
                }
              } else {
                // show all accounts: clear selection and preview
                setSelectedMailbox(null)
                setSelectedCategory(null)
                setSelectedMessage(null)
                setMessageDetail(null)
                try { replaceRoute(null, null) } catch (_) {}
              }
            }}
          >
            <MenuItem value="">All accounts</MenuItem>
            {accounts.map(a => (
              <MenuItem key={a.id} value={a.id}>{a.email}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary' }}>Folders</Typography>
        {loadingBoxes ? <CircularProgress size={24} /> : (
          <List dense subheader={<li />}
            sx={{ '& .MuiListSubheader-root': { bgcolor: 'transparent', fontWeight: 600 } }}>
            {mailboxGroups.map(([accountEmail, boxes]) => {
              // aggregate category counts across all boxes for this account
              const accountBoxes = (boxes as any[])
              const labels = ['All','primary','updates','social','newsletters','promotions','other']
              const firstBox = accountBoxes[0]
              const aggregated: Record<string, number> = { All: 0, primary: 0, updates: 0, social: 0, newsletters: 0, promotions: 0, other: 0 }
              for (const b of accountBoxes) {
                aggregated.All += Number(b.totalCount || 0)
                const cc = b.categoryCounts || {}
                for (const l of Object.keys(aggregated)) {
                  if (l === 'All') continue
                  aggregated[l] += Number(cc[l] || 0)
                }
              }

              return (
                <li key={accountEmail}>
                  <ul style={{ padding: 0 }}>
                    <ListSubheader>{accountEmail}</ListSubheader>
                    {labels.map(label => {
                      // special handling for 'All' and 'Sent'
                      const labelKey = label === 'All' ? null : label
                      const count = aggregated[label as keyof typeof aggregated] || 0
                      const isSelected = selectedMailbox && selectedMailbox.accountEmail === accountEmail && (label === 'All' ? selectedCategory === null : selectedCategory === label)
                      return (
                        <ListItemButton
                          key={label}
                          selected={!!isSelected}
                          onContextMenu={(e) => {
                            if (!firstBox) return
                            e.preventDefault()
                            setContextMenu(null)
                            setCategoryMenu({ mouseX: e.clientX - 2, mouseY: e.clientY - 4, accountId: firstBox.accountId, category: labelKey || '' })
                          }}
                          onClick={() => {
                            if (!firstBox) return
                            setSelectedMailbox(firstBox)
                            const nextCategory = label === 'All' ? null : label
                            setSelectedCategory(nextCategory)
                            replaceRoute(firstBox.id, nextCategory)
                          }}
                        >
                          <ListItemText primary={label} primaryTypographyProps={{ fontSize: '0.9rem', fontWeight: 600, sx: { textTransform: label === 'All' ? 'none' : 'capitalize' }, color: 'text.secondary' }} />
                          { count > 0 && <Chip label={String(count)} size="small" /> }
                        </ListItemButton>
                      )
                    })}
                    {/* show Sent mailbox if present for account */}
                    {accountBoxes.map(b => (b.path === 'Sent' || b.name === 'Sent') ? (
                      <div key={b.id}>
                        <ListItemButton
                          selected={selectedMailbox?.id === b.id}
                          onClick={() => { setSelectedMailbox(b); setSelectedCategory(null); replaceRoute(b.id, null) }}
                        >
                          <ListItemText primary={b.name} primaryTypographyProps={{ fontSize: '0.9rem', fontWeight: 600, color: 'text.secondary' }} />
                          {b.unreadCount > 0 && <Chip label={b.unreadCount} size="small" color="primary" />}
                        </ListItemButton>
                      </div>
                    ) : null)}
                  </ul>
                </li>
              )
            })}
          </List>
        )}
      </Paper>

      <Paper sx={{ p: 1.5, overflow: 'auto' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Box>
            <Typography variant="subtitle2" sx={{ color: 'text.secondary' }}>{mailboxTitle}</Typography>
            {selectedMailbox?.lastCheckedAt && <Typography variant="caption" color="text.secondary">{`Synced: ${timeAgo(selectedMailbox.lastCheckedAt)}`}</Typography>}
          </Box>
          <Chip
            label={syncing ? 'Syncing…' : 'Sync'}
            onClick={handleSync}
            size="small"
            color="primary"
            variant={syncing ? 'filled' : 'outlined'}
          />
        </Box>
        <TextField
          size="small"
          placeholder="Search mail"
          value={search}
          onChange={e => setSearch(e.target.value)}
          fullWidth
          sx={{ mb: 1 }}
        />
        {loadingMessages && messages.length === 0 ? <CircularProgress size={24} /> : messages.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 2 }}>Nothing to see here.</Typography>
        ) : (
          <List dense>
            {(() => {
              const order = [
                { key: 'today', label: 'Today' },
                { key: 'yesterday', label: 'Yesterday' },
                { key: 'last7', label: 'Past 7 days' },
                { key: 'older', label: 'Older' }
              ]

              return order.map(section => {
                const list = groupedMessagesByDate[section.key] || []
                if (!list.length) return null
                return (
                  <React.Fragment key={section.key}>
                    <ListSubheader sx={{ bgcolor: 'transparent', mt: 1, pl: 0, fontWeight: 600 }}>{section.label}</ListSubheader>
                    {list.map((msg: any) => {
                      const unread = !(msg.read === true || (Array.isArray(msg.flags) ? msg.flags.includes('\\Seen') : false))
                      return (
                        <React.Fragment key={msg.id}>
                          <ListItemButton
                            selected={selectedMessage?.id === msg.id}
                            onClick={() => { setSelectedMessage(msg); replaceRoute(selectedMailbox?.id || null, selectedCategory || null) }}
                            onContextMenu={(e) => { e.preventDefault(); setContextMenu({ mouseX: e.clientX - 2, mouseY: e.clientY - 4, id: msg.id }) }}
                            alignItems="flex-start"
                          >
                            <ListItemText
                              primaryTypographyProps={{ fontWeight: unread ? 600 : 400 }}
                              primary={msg.subject || '(no subject)'}
                              secondary={
                                <span>
                                  {formatFrom(msg.fromHeader)}
                                  <br />
                                  {(msg.toHeader || msg.to) ? (
                                    <span style={{ color: 'rgba(0,0,0,0.6)' }}>To: {formatRecipientsElements(msg.toHeader || msg.to)}</span>
                                  ) : null}
                                  {(msg.toHeader || msg.to) ? <br /> : null}
                                  {formatDate(msg.internalDate)}
                                </span>
                              }
                            />
                            {msg.category && (
                              <Tooltip title={msg.categoryReason || ''} arrow>
                                <Chip
                                  label={msg.category}
                                  size="small"
                                  color={categoryColor(msg.category) as any}
                                  sx={{ ml: 1, textTransform: 'capitalize' }}
                                />
                              </Tooltip>
                            )}
                                  {msg.hasItinerary && (
                              <Chip label="Event" size="small" color="info" sx={{ ml: 1 }} />
                            )}
                            {msg.hasTracking && (
                              <Chip label="Tracking" size="small" color="secondary" sx={{ ml: 1 }} />
                            )}
                            {msg.spam && (
                              <Chip
                                label="Spam"
                                size="small"
                                color="error"
                                sx={{ ml: 1, fontWeight: 600 }}
                              />
                            )}

                            {/* Archive control */}
                            <IconButton size="small" sx={{ ml: 1 }} disabled={msg.archived} onClick={e => {
                              e.stopPropagation();
                              const id = msg.id;
                              const archived = !msg.archived;
                              setMessageArchivedClient(id, archived);
                            }}
                            >
                              {msg.archived ? <UnarchiveIcon fontSize="small" /> : <ArchiveIcon fontSize="small" />}
                            </IconButton>
                          </ListItemButton>
                          <Divider component="li" />
                        </React.Fragment>
                      )
                    })}
                  </React.Fragment>
                )
              })
            })()}
            {hasMore && <Box ref={loadMoreRef} sx={{ height: 32 }} />}

            <Menu
              open={!!contextMenu}
              onClose={() => setContextMenu(null)}
              anchorReference="anchorPosition"
              anchorPosition={contextMenu ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined}
            >
              <MenuItem onClick={async () => {
                if (!contextMenu) return setContextMenu(null)
                const id = contextMenu.id
                setContextMenu(null)
                try {
                  setAiProcessing(true)
                  await enqueueMessageAi(id)
                  // optimistically mark category may update; refresh list item if it's visible
                  const updated = await getMessage(id).catch(() => null)
                  if (updated) {
                    setMessages(prev => prev.map(m => m.id === id ? { ...m, category: updated.category, spam: updated.spam } : m))
                    if (selectedMessage?.id === id) setMessageDetail(updated)
                  }
                } finally { setAiProcessing(false) }
              }}>Run AI</MenuItem>

              {contextMessage?.archived && (
                <MenuItem onClick={async () => {
                  if (!contextMenu) return setContextMenu(null)
                  const id = contextMenu.id
                  setContextMenu(null)
                  // unarchive
                  await setMessageArchived(id, false)
                  setMessages(prev => prev.map(m => m.id === id ? { ...m, archived: false } : m))
                  if (selectedMessage?.id === id) {
                    const data = await getMessage(id).catch(() => null)
                    if (data) { setMessageDetail(data); setSelectedMessage(data) }
                  }
                }}>{'Unarchive'}</MenuItem>
              )}

              {contextMessage?.read && (
                <MenuItem onClick={async () => {
                  if (!contextMenu) return setContextMenu(null)
                  const id = contextMenu.id
                  setContextMenu(null)
                  try {
                    await markMessageUnread(id)
                    setMessages(prev => prev.map(m => m.id === id ? { ...m, read: false } : m))
                    if (selectedMessage?.id === id) setMessageDetail((d:any) => d ? { ...d, read: false } : d)
                  } catch (e) {
                    console.warn('mark unread failed', e)
                  }
                }}>{'Mark as Unread'}</MenuItem>
              )}
            </Menu>

            <Menu
              open={!!categoryMenu}
              onClose={() => setCategoryMenu(null)}
              anchorReference="anchorPosition"
              anchorPosition={categoryMenu ? { top: categoryMenu.mouseY, left: categoryMenu.mouseX } : undefined}
            >
              <MenuItem onClick={async () => {
                const target = categoryMenu ? { mailboxId: categoryMenu.mailboxId, accountId: categoryMenu.accountId, category: categoryMenu.category } : null
                setCategoryMenu(null)
                await handleCategoryMarkAllRead(target)
              }}>Mark all as read</MenuItem>
              <MenuItem onClick={async () => {
                const target = categoryMenu ? { mailboxId: categoryMenu.mailboxId, accountId: categoryMenu.accountId, category: categoryMenu.category } : null
                setCategoryMenu(null)
                await handleCategoryArchiveAll(target)
              }}>Archive all</MenuItem>
            </Menu>
          </List>
        )}
      </Paper>

      <Paper sx={{ p: 2, overflow: 'auto' }}>
        {loadingMessage && <CircularProgress size={24} />}
        {!loadingMessage && messageDetail && (
          <Box sx={{ display: 'grid', gap: 1.5 }}>
            <Typography variant="h6">{messageDetail.subject || '(no subject)'}</Typography>
            <Typography variant="body2" color="text.secondary">From: {formatFrom(messageDetail.fromHeader)}</Typography>
            <Typography variant="body2" color="text.secondary">Date: {formatDate(messageDetail.internalDate)}</Typography>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <FormControl size="small" sx={{ minWidth: 140 }}>
                <InputLabel id="message-category-select">Category</InputLabel>
                <Select
                  labelId="message-category-select"
                  value={messageDetail.category || ''}
                  label="Category"
                  onChange={(e: any) => handleUpdateMessageCategory(e.target.value || null)}
                >
                  <MenuItem value="">None</MenuItem>
                  {['primary','updates','social','newsletters','promotions','other'].map(c => (
                    <MenuItem key={c} value={c}>{c}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Chip
                label={messageDetail.spam ? 'Spam' : 'Not spam'}
                size="small"
                color={messageDetail.spam ? 'error' : 'default'}
                onClick={handleToggleSpam}
                clickable
                sx={{ ml: 1, fontWeight: 600 }}
              />
              {/* AI generated summary and recommended action */}
              {messageDetail.aiSummary && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{messageDetail.aiSummary}</Typography>
              )}

              {parsedAiItinerary && parsedAiItinerary.length > 0 && (
                <Box sx={{ mt: 1 }}>
                  {parsedAiItinerary.map((ev: any, i: number) => (
                    <Box key={i} sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 0.5 }}>
                      <Chip label="Event" size="small" color="info" />
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{ev.summary || 'Event'}</Typography>
                      <Typography variant="body2" color="text.secondary">{ev.start ? new Date(ev.start).toLocaleString() : ''}{ev.end ? ` — ${new Date(ev.end).toLocaleString()}` : ''}</Typography>
                    </Box>
                  ))}
                </Box>
              )}

              <Box sx={{ ml: 'auto' }}>
                <IconButton size="small" onClick={openReply} title="Reply">
                  <ReplyIcon />
                </IconButton>
              </Box>

              {parsedAiTracking && parsedAiTracking.length > 0 && (
                <Box sx={{ mt: 1 }}>
                  {parsedAiTracking.map((t: any, i: number) => (
                    <Box key={i} sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 0.5 }}>
                      <Chip label="Tracking" size="small" color="secondary" />

                      {t.url ? (
                        <a href={t.url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', gap: 8, alignItems: 'center', textDecoration: 'none' }}>
                          <Typography variant="body2" sx={{ fontWeight: 600, color: 'inherit' }}>{t.carrier || 'Shipment'}</Typography>
                          {t.trackingNumber && <Typography variant="body2" sx={{ fontWeight: 600, color: 'primary.main' }}>{`• ${t.trackingNumber}`}</Typography>}
                          <LaunchIcon fontSize="small" sx={{ color: 'text.secondary', ml: 0.5 }} />
                        </a>
                      ) : (
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{t.carrier || 'Shipment'}{t.trackingNumber ? ` • ${t.trackingNumber}` : ''}</Typography>
                      )}

                      {t.deliveryDate && (
                        <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>{`Delivery: ${new Date(t.deliveryDate).toLocaleDateString()}`}</Typography>
                      )}
                    </Box>
                  ))}
                </Box>
              )}

              {parsedAiAction && (
                <Tooltip title={parsedAiAction.reason || ''} arrow>
                  <Chip label={`Action: ${parsedAiAction.type || 'none'}`} size="small" sx={{ mt: 1 }} />
                </Tooltip>
              )}

              {messageDetail.attachments && messageDetail.attachments.length > 0 && (
                <Box sx={{ display: 'grid', gap: 1, mt: 1 }}>
                  <Typography variant="subtitle2">Attachments</Typography>
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                    {messageDetail.attachments.map((at: any) => (
                      <Box key={at.id} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{at.filename || 'Attachment'}</Typography>
                        {at.sizeBytes ? <Typography variant="body2" color="text.secondary">{`${(Number(at.sizeBytes) / 1024).toFixed(1)} KB`}</Typography> : null}
                        <IconButton size="small" onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            const blob = await downloadAttachment(messageDetail.id, at.id)
                            const url = URL.createObjectURL(blob)
                            const a = document.createElement('a')
                            a.href = url
                            a.download = at.filename || 'attachment'
                            document.body.appendChild(a)
                            a.click()
                            a.remove()
                            URL.revokeObjectURL(url)
                          } catch (err) {
                            console.warn('download failed', err)
                          }
                        }}>
                          <LaunchIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    ))}
                  </Box>
                </Box>
              )}
            </Box>

            <Divider />
            {messageDetail.html ? (
              <Box sx={{ display: 'grid', gap: 1 }}>
                {!imagesAllowed && sanitizedHtml.blockedCount > 0 && (
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Typography variant="body2" color="text.secondary">
                      Remote images blocked ({sanitizedHtml.blockedCount}).
                    </Typography>
                    <Chip label="Load images" onClick={allowImagesForThisMessage} size="small" color="primary" />
                    {senderAddress && <Chip label={`Always allow from ${senderAddress}`} onClick={allowImagesForThisSender} size="small" variant="outlined" />}
                  </Box>
                )}
                {(() => {
                  const fallbackName = formatFrom(messageDetail.fromHeader)
                  const fallbackDate = formatDate(messageDetail.internalDate)
                  const items = buildThreadItemsFromHtml(
                    sanitizedHtml.html,
                    { name: fallbackName, email: getSenderAddress(messageDetail.fromHeader) || '', dateText: fallbackDate }
                  )
                  if (!items || items.length < 2) {
                    return <Box sx={{ '& img': { maxWidth: '100%' } }} dangerouslySetInnerHTML={{ __html: sanitizedHtml.html }} />
                  }
                  return (
                    <Box sx={{ display: 'grid', gap: 1 }}>
                      {items.map((it, idx) => (
                        <Box key={it.id} sx={{ display: 'grid', gridTemplateColumns: '40px 1fr', gap: 1, py: 1, borderBottom: idx < items.length - 1 ? '1px solid rgba(0,0,0,0.06)' : 'none' }}>
                          <Avatar sx={{ width: 32, height: 32 }}>{(it.name || 'U').charAt(0).toUpperCase()}</Avatar>
                          <Box sx={{ display: 'grid', gap: 0.5 }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 2 }}>
                              <Box sx={{ display: 'flex', gap: 1, alignItems: 'baseline', flexWrap: 'wrap' }}>
                                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>{it.name}</Typography>
                                {it.email ? <Typography variant="body2" color="text.secondary">{`<${it.email}>`}</Typography> : null}
                              </Box>
                              {it.dateText ? <Typography variant="caption" color="text.secondary">{formatThreadDate(it.dateText)}</Typography> : null}
                            </Box>
                            <Box sx={{ '& img': { maxWidth: '100%' } }} dangerouslySetInnerHTML={{ __html: it.bodyHtml || '' }} />
                          </Box>
                        </Box>
                      ))}
                    </Box>
                  )
                })()}
              </Box>
            ) : (
              (() => {
                const text = messageDetail.text || ''
                const fallbackName = formatFrom(messageDetail.fromHeader)
                const fallbackDate = formatDate(messageDetail.internalDate)
                const items = buildThreadItemsFromPlain(
                  text,
                  { name: fallbackName, email: getSenderAddress(messageDetail.fromHeader) || '', dateText: fallbackDate }
                )
                if (!items || items.length < 2) return <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>{text}</Typography>
                return (
                  <Box sx={{ display: 'grid', gap: 1 }}>
                    {items.map((it, idx) => (
                      <Box key={it.id} sx={{ display: 'grid', gridTemplateColumns: '40px 1fr', gap: 1, py: 1, borderBottom: idx < items.length - 1 ? '1px solid rgba(0,0,0,0.06)' : 'none' }}>
                        <Avatar sx={{ width: 32, height: 32 }}>{(it.name || 'U').charAt(0).toUpperCase()}</Avatar>
                        <Box sx={{ display: 'grid', gap: 0.5 }}>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 2 }}>
                            <Box sx={{ display: 'flex', gap: 1, alignItems: 'baseline', flexWrap: 'wrap' }}>
                              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>{it.name}</Typography>
                              {it.email ? <Typography variant="body2" color="text.secondary">{`<${it.email}>`}</Typography> : null}
                            </Box>
                            {it.dateText ? <Typography variant="caption" color="text.secondary">{formatThreadDate(it.dateText)}</Typography> : null}
                          </Box>
                          <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>{it.bodyText || ''}</Typography>
                        </Box>
                      </Box>
                    ))}
                  </Box>
                )
              })()
            )}
            {/* Inline reply composer (compact) */}
            {inlineReplyOpen && (
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', mt: 2 }}>
                <Avatar alt={messageDetail?.fromHeader?.[0]?.name || messageDetail?.fromHeader?.[0]?.address || 'Me'} src={undefined} />
                <Box sx={{ flex: 1, border: '1px solid rgba(0,0,0,0.08)', borderRadius: 1, p: 1 }}>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Box sx={{ flex: 1 }}>
                      {composerRich ? (
                        // @ts-ignore
                        <ReactQuill theme="snow" value={composerBody} onChange={(v: any) => setComposerBody(v)} style={{ height: 140 }} />
                      ) : (
                        <TextField size="small" label="Message" value={composerBody} onChange={e => setComposerBody(e.target.value)} multiline rows={6} fullWidth />
                      )}
                    </Box>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-end' }}>
                      <IconButton size="small" onClick={() => setComposerRich(!composerRich)} title="Toggle rich/plain">
                        <CloseIcon />
                      </IconButton>
                      <IconButton size="small" color="primary" onClick={handleSendInline} title="Send">
                        <SendIcon />
                      </IconButton>
                      <IconButton size="small" onClick={() => setInlineReplyOpen(false)} title="Close">
                        <CloseIcon />
                      </IconButton>
                    </Box>
                  </Box>
                </Box>
              </Box>
            )}
          </Box>
        )}
        {!loadingMessage && !messageDetail && (
          <Typography color="text.secondary">Select a message to view it.</Typography>
        )}
      </Paper>
      {/* Composer floating UI */}
      {composerOpen && (
        <Paper elevation={8} sx={{ position: 'fixed', right: 20, bottom: 20, width: 520, height: 420, display: 'flex', flexDirection: 'column', zIndex: 1400 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 1, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
            <Typography variant="subtitle1">New Message</Typography>
            <Box>
              <IconButton size="small" onClick={handleSendCompose} color="primary"><SendIcon /></IconButton>
              <IconButton size="small" onClick={closeComposer}><CloseIcon /></IconButton>
            </Box>
          </Box>
          <Box sx={{ p: 1, display: 'flex', flexDirection: 'column', gap: 1, flex: 1, overflow: 'auto' }}>
            <TextField size="small" label="To" value={composerTo} onChange={e => setComposerTo(e.target.value)} fullWidth />
            <TextField size="small" label="Cc" value={composerCc} onChange={e => setComposerCc(e.target.value)} fullWidth />
            <TextField size="small" label="Bcc" value={composerBcc} onChange={e => setComposerBcc(e.target.value)} fullWidth />
            <TextField size="small" label="Subject" value={composerSubject} onChange={e => setComposerSubject(e.target.value)} fullWidth />
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <Typography variant="body2">Rich text</Typography>
              <input type="checkbox" checked={composerRich} onChange={e => setComposerRich(e.target.checked)} />
            </Box>
            {composerRich ? (
              // @ts-ignore
              <ReactQuill theme="snow" value={composerBody} onChange={(v: any) => setComposerBody(v)} style={{ height: 220 }} />
            ) : (
              <TextField size="small" label="Message" value={composerBody} onChange={e => setComposerBody(e.target.value)} multiline rows={8} fullWidth />
            )}
          </Box>
        </Paper>
      )}

      <Fab variant="extended" color="primary" sx={{ position: 'fixed', right: 20, bottom: composerOpen ? 460 : 20 }} onClick={() => openCompose()}>
        Compose
      </Fab>
    </Box>
  )
}
