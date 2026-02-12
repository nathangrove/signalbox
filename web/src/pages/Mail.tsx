import React, { useEffect, useMemo, useRef, useState } from 'react'
import { API_BASE } from '../api'
import ReactQuill from 'react-quill'
import 'react-quill/dist/quill.snow.css'
import MessageIframe from './Mail/components/MessageIframe'
import { archiveCategoryAll, archiveCategoryAllByAccount, enqueueMessageAi, getAccounts, getMailboxes, getMessage, getMessages, getMessagesByAccount, markCategoryReadAll, markCategoryReadAllByAccount, markMessageRead, markMessageUnread, setMessageArchived, downloadAttachment, sendMessage, updateMessageLabels } from '../api'
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
import Drawer from '@mui/material/Drawer'
import { useTheme } from '@mui/material/styles'
import useMediaQuery from '@mui/material/useMediaQuery'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
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
import ForwardIcon from '@mui/icons-material/Forward'
import ReportIcon from '@mui/icons-material/Report'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import { isValid, parse } from 'date-fns'

import TextField from '@mui/material/TextField'
import * as DarkReader from 'darkreader'
import MessageListPanel from './Mail/components/MessageListPanel'
import { categoryColor, formatFrom, formatRecipients, formatRecipientsElements, getSenderAddress, formatDate, timeAgo, stripTrackingPixels, plainTextToHtml, htmlToPlainText, htmlQuote, buildQuotedOriginalHTML, splitPlainThread, splitHtmlThread, parseDateCandidate, parseThreadHeader, formatThreadDate, buildThreadItemsFromPlain, buildThreadItemsFromHtml, blockRemoteImages } from '../utils'
import { loadPrefs, savePrefs } from '../utils/prefs'

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

  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'))
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [mobileView, setMobileView] = useState<'list'|'message'>('list')

  useEffect(() => {
    function handler() { setDrawerOpen(true) }
    window.addEventListener('toggleMailDrawer', handler as any)
    return () => window.removeEventListener('toggleMailDrawer', handler as any)
  }, [])

  useEffect(() => {
    (async()=>{
      const accs = await getAccounts()
      const list = Array.isArray(accs) ? accs : []
      setAccounts(list)
      if (list.length) setSelectedAccountId(list[0].id || null)
    })()
  },[])

  // notify other parts of the app when the selected account changes
  useEffect(() => {
    try {
      window.dispatchEvent(new CustomEvent('account.selection.changed', { detail: { accountId: selectedAccountId } }))
    } catch (_) {}
  }, [selectedAccountId])

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
      // Support single update object or array of updates
      const updates = Array.isArray(payload) ? payload : [payload];
      const appliedMap: Record<string, any> = {};
      let shouldRefreshMailboxes = false;
      let shouldRefreshDetail = false;

      for (const item of updates) {
        const messageId = item.messageId || item.id;
        if (!messageId) continue;
        const changes = item.changes || {};
        let appliedChanges: any = { ...changes };
        if (changes.aiLabels && typeof changes.aiLabels === 'object') {
          const ai = changes.aiLabels as any;
          appliedChanges.aiLabels = ai;
          if (typeof ai.category !== 'undefined') appliedChanges.category = ai.category;
          if (typeof ai.spam !== 'undefined') appliedChanges.spam = ai.spam;
          if (typeof ai.categoryReason !== 'undefined') appliedChanges.categoryReason = ai.categoryReason;
          if (typeof ai.method !== 'undefined') appliedChanges.categoryMethod = ai.method;
        }
        appliedMap[messageId] = { ...(appliedMap[messageId] || {}), ...appliedChanges };

        if (typeof appliedChanges.read === 'boolean' || typeof appliedChanges.archived === 'boolean' || typeof appliedChanges.category !== 'undefined' || typeof appliedChanges.spam !== 'undefined') {
          shouldRefreshMailboxes = true;
        }
        if (selectedMessage?.id === messageId) shouldRefreshDetail = true;
      }

      if (Object.keys(appliedMap).length) {
        setMessages(prev => prev.map(m => {
          const upd = appliedMap[m.id];
          return upd ? { ...m, ...upd } : m;
        }));
      }

      if (shouldRefreshMailboxes) refreshMailboxes();

      if (shouldRefreshDetail) {
        const id = selectedMessage?.id as string;
        (async () => {
          try {
            const data = await getMessage(id);
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

  // Listen for search input from mobile AppBar
  useEffect(() => {
    function handler(ev: any) {
      try {
        const v = ev?.detail?.value || ''
        setSearch(String(v))
      } catch (e) { console.warn('mobile search handler', e) }
    }
    window.addEventListener('mailSearchInput', handler as any)
    return () => window.removeEventListener('mailSearchInput', handler as any)
  }, [])

  // Emit search updates so AppBar can mirror current search
  useEffect(() => {
    try { window.dispatchEvent(new CustomEvent('mailSearchUpdated', { detail: { search } })) } catch (_) {}
  }, [search])

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
    const acctText = account ? account.email : selectedMailbox.accountEmail || 'Account'
    const cat = selectedCategory ? String(selectedCategory) : 'All'
    const catText = cat.charAt(0).toUpperCase() + cat.slice(1)
    return `${acctText} - ${catText}`
  }, [selectedMailbox, accounts, selectedCategory])

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
          const url = `${API_BASE}/messages/${encodeURIComponent(messageDetail.id)}/attachments/${encodeURIComponent(at.id)}?inline=1`
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
      // If marking as spam, also archive the message
      if (nextSpam) {
        try {
          await setMessageArchived(messageDetail.id, true)
        } catch (err) {
          console.warn('archive after spam failed', err)
        }
      }
      const data = await getMessage(messageDetail.id)
      if (data) {
        setMessageDetail(data)
        setMessages(prev => prev.map(m => m.id === data.id ? { ...m, category: data.category, spam: data.spam, archived: data.archived } : m))
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

  const fabBottom = composerOpen ? (isMobile ? 'calc(70vh + 30px)' : 460) : 20

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

  function openForward() {
    if (!messageDetail) return
    let subj = messageDetail.subject || ''
    if (subj && !/^fwd:/i.test(subj)) subj = `Fwd: ${subj}`
    // prefer HTML quoted original when available
    const bodyHtml = messageDetail ? (messageDetail.html ? buildQuotedOriginalHTML(messageDetail) : plainTextToHtml(messageDetail.text || messageDetail.body || '')) : ''
    setComposerTo('')
    setComposerCc('')
    setComposerBcc('')
    setComposerSubject(subj)
    setComposerBody(bodyHtml)
    setComposerRich(true)
    setComposerOpen(true)
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

  const headerHeight = isMobile ? 56 : 112
  const contentHtmlSx = useMemo(() => {
    const base: any = {
      maxWidth: '100%',
      overflowX: 'auto',
      wordBreak: 'break-word',
      overflowWrap: 'break-word',
      '& img': { maxWidth: '100%' },
      '& table': { maxWidth: '100%', width: 'auto' },
      '& pre': { whiteSpace: 'pre-wrap', wordBreak: 'break-word' }
    }
    if (theme.palette.mode === 'dark') {
      return {
        ...base,
        color: theme.palette.text.primary,
        backgroundColor: 'transparent',
        '& *': { color: `${theme.palette.text.primary} !important` },
        '& a': { color: `${(theme.palette as any).primary.light} !important` },
        '& blockquote, & pre': { background: 'rgba(255,255,255,0.04)' }
      }
    }
    return base
  }, [theme.palette])

  useEffect(() => {
    try {
      if (theme.palette.mode === 'dark' && messageDetail?.html) {
        if (DarkReader && DarkReader.enable) {
          DarkReader.enable({ brightness: 100, contrast: 90, sepia: 10 })
        }
      } else {
        if (DarkReader && DarkReader.disable) {
          DarkReader.disable()
        }
      }
    } catch (e) {
      console.warn('DarkReader error', e)
    }

    return () => {
      try { if (DarkReader && DarkReader.disable) DarkReader.disable() } catch (_) {}
    }
  }, [theme.palette.mode, messageDetail?.id])

  return (
    <Box sx={{ m: 0, display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '260px 360px calc(98vw - 260px - 360px - 32px)', gap: 2, height: `calc(100vh - ${headerHeight}px)` }}>
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} anchor="left">
        <Box sx={{ width: 260, p: 1.5, overflow: 'auto' }}>
          <FormControl fullWidth size="small" sx={{ mb: 1 }}>
            <InputLabel id="mobile-account-select-label">Account</InputLabel>
            <Select
              labelId="mobile-account-select-label"
              value={selectedAccountId || ''}
              label="Account"
              onChange={(e: any) => {
                const val = e.target.value || null
                setSelectedAccountId(val)
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
                  setSelectedMailbox(null)
                  setSelectedCategory(null)
                  setSelectedMessage(null)
                  setMessageDetail(null)
                  try { replaceRoute(null, null) } catch (_) {}
                }
                setDrawerOpen(false)
                setMobileView('list')
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
            <List dense subheader={<li />} sx={{ '& .MuiListSubheader-root': { bgcolor: 'transparent', fontWeight: 600 } }}>
              {mailboxGroups.map(([accountEmail, boxes]) => {
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
                              setDrawerOpen(false)
                              setMobileView('list')
                            }}
                          >
                            <ListItemText primary={label} primaryTypographyProps={{ fontSize: '0.9rem', fontWeight: 600, sx: { textTransform: label === 'All' ? 'none' : 'capitalize' }, color: 'text.secondary' }} />
                            { count > 0 && <Chip label={String(count)} size="small" /> }
                          </ListItemButton>
                        )
                      })}
                      {accountBoxes.map(b => (b.path === 'Sent' || b.name === 'Sent') ? (
                        <div key={b.id}>
                          <ListItemButton
                            selected={selectedMailbox?.id === b.id}
                            onClick={() => { setSelectedMailbox(b); setSelectedCategory(null); replaceRoute(b.id, null); setDrawerOpen(false); setMobileView('list') }}
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
        </Box>
      </Drawer>

      <Paper sx={{ p: 1.5, overflow: 'auto', display: isMobile ? 'none' : 'block' }}>
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
                    if (isMobile) { setDrawerOpen(false); setMobileView('list') }
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
                              if (isMobile) { setDrawerOpen(false); setMobileView('list') }
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
                          onClick={() => { setSelectedMailbox(b); setSelectedCategory(null); replaceRoute(b.id, null); if (isMobile) { setDrawerOpen(false); setMobileView('list') } }}
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

      <MessageListPanel
        isMobile={isMobile}
        mobileView={mobileView}
        setMobileView={setMobileView}
        mailboxTitle={mailboxTitle}
        selectedMailbox={selectedMailbox}
        loadingMessages={loadingMessages}
        messages={messages}
        search={search}
        setSearch={setSearch}
        groupedMessagesByDate={groupedMessagesByDate}
        selectedMessage={selectedMessage}
        setSelectedMessage={setSelectedMessage}
        replaceRoute={replaceRoute}
        setContextMenu={setContextMenu}
        setCategoryMenu={setCategoryMenu}
        hasMore={hasMore}
        loadMoreRef={loadMoreRef}
        enqueueMessageAi={enqueueMessageAi}
        getMessage={getMessage}
        setMessages={setMessages}
        setAiProcessing={setAiProcessing}
        setMessageArchivedClient={setMessageArchivedClient}
        markMessageUnread={markMessageUnread}
        setMessageDetail={setMessageDetail}
        pageSize={pageSize}
      />

      <Paper sx={{ p: 2, overflowY: 'hidden', overflowX: 'hidden', display: isMobile && mobileView !== 'message' ? 'none' : 'flex', flexDirection: 'column' }}>
        {loadingMessage && <CircularProgress size={24} />}
        {!loadingMessage && messageDetail && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, flex: 1, minHeight: 0 }}>
            {isMobile ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <IconButton size="small" onClick={() => { setSelectedMessage(null); setMessageDetail(null); setMobileView('list'); replaceRoute(selectedMailbox?.id || null, selectedCategory || null) }}>
                  <ArrowBackIcon />
                </IconButton>
                <Typography variant="h6" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{messageDetail.subject || '(no subject)'}</Typography>
              </Box>
            ) : (
              <Typography variant="h6">{messageDetail.subject || '(no subject)'}</Typography>
            )}
            <Box sx={{ width: '100%' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    From: <span style={{ fontWeight: 700 }}>{(messageDetail?.fromHeader && Array.isArray(messageDetail.fromHeader) && messageDetail.fromHeader[0]?.name) || formatFrom(messageDetail.fromHeader)}</span>
                    {" "}
                    <span style={{ fontWeight: 400, color: 'inherit' }}>{(messageDetail?.fromHeader && Array.isArray(messageDetail.fromHeader) && `<${messageDetail.fromHeader[0]?.address}>`) || ''}</span>
                  </Typography>
                </Box>
                <Typography variant="caption" color="text.secondary">{formatDate(messageDetail.internalDate)}</Typography>
              </Box>

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                <Typography variant="body2" color="text.secondary" sx={{ alignItems: 'center' }}>To: {formatRecipientsElements(messageDetail.toHeader || messageDetail.to)}</Typography>
              </Box>

              {messageDetail.aiSummary && (
                <Box sx={{ mt: 1, mb: 2, p: 1.5, borderRadius: 1, bgcolor: (t) => t.palette.mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(234,245,255,0.7)', border: (t) => `1px solid ${t.palette.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(26,115,232,0.08)'}` }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="subtitle2">AI Summary</Typography>
                  </Box>
                  <Box component="ul" sx={{ pl: 2, m: 0 }}>
                        <Typography variant="body2" sx={{ display: 'inline' }}>{messageDetail.aiSummary}</Typography>
                  </Box>
                </Box>
              )}

              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', mt: 1, width: '100%' }}>
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

                <Box sx={{ ml: 'auto', display: 'flex', gap: 1 }}>
                  <IconButton size="small" onClick={handleToggleSpam} title={messageDetail.spam ? 'Mark not spam' : 'Mark spam'}>
                    <ReportIcon color={messageDetail.spam ? 'error' : 'inherit'} />
                  </IconButton>
                  <IconButton size="small" onClick={openForward} title="Forward">
                    <ForwardIcon />
                  </IconButton>
                  <IconButton size="small" onClick={openReply} title="Reply">
                    <ReplyIcon />
                  </IconButton>
                </Box>

                {parsedAiItinerary && parsedAiItinerary.length > 0 && (
                  <Box sx={{ mt: 1, width: '100%' }}>
                    {parsedAiItinerary.map((ev: any, i: number) => (
                      <Box key={i} sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 0.5 }}>
                        <Chip label="Event" size="small" color="info" />
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{ev.summary || 'Event'}</Typography>
                        <Typography variant="body2" color="text.secondary">{ev.start ? new Date(ev.start).toLocaleString() : ''}{ev.end ? ` — ${new Date(ev.end).toLocaleString()}` : ''}</Typography>
                      </Box>
                    ))}
                  </Box>
                )}

                {parsedAiTracking && parsedAiTracking.length > 0 && (
                  <Box sx={{ mt: 1, width: '100%' }}>
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

                {messageDetail.attachments && messageDetail.attachments.length > 0 && (
                  <Box sx={{ display: 'grid', gap: 1, mt: 1, width: '100%' }}>
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
            </Box>

            <Divider />
              {messageDetail.html ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minHeight: 0, overflow: 'hidden' }}>
                {!imagesAllowed && sanitizedHtml.blockedCount > 0 && (
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Typography variant="body2" color="text.secondary">
                      Remote images blocked ({sanitizedHtml.blockedCount}).
                    </Typography>
                    <Chip label="Load images" onClick={allowImagesForThisMessage} size="small" color="primary" />
                    {senderAddress && <Chip label={`Always allow from ${senderAddress}`} onClick={allowImagesForThisSender} size="small" variant="outlined" />}
                  </Box>
                )}
                {/* Thread-splitting temporarily disabled — render the whole HTML body as-is */}
                <Box sx={[contentHtmlSx, { flex: 1, minHeight: 0 }]}>
                  <MessageIframe html={sanitizedHtml.html} darkMode={theme.palette.mode === 'dark'} darkReader={theme.palette.mode === 'dark'} />
                </Box>
              </Box>
              ) : (
              /* Thread-splitting temporarily disabled — render plain text as a single block */
              <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', p: 1 }}>{messageDetail.text || ''}</Typography>
              </Box>
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
        <Paper elevation={8} sx={{ position: 'fixed', right: isMobile ? 10 : 20, left: isMobile ? 10 : 'auto', bottom: 20, width: isMobile ? 'auto' : 520, maxWidth: isMobile ? 'calc(100% - 20px)' : undefined, height: isMobile ? '70vh' : 420, display: 'flex', flexDirection: 'column', zIndex: 1400 }}>
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

      <Fab variant="extended" color="primary" sx={{ position: 'fixed', right: isMobile ? 10 : 20, bottom: fabBottom }} onClick={() => openCompose()}>
        Compose
      </Fab>
    </Box>
  )
}
