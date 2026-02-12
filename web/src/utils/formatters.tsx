import React from 'react'
import Tooltip from '@mui/material/Tooltip'

export function categoryColor(category?: string | null) {
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

export function formatFrom(fromHeader: any): string {
  const list = Array.isArray(fromHeader) ? fromHeader : []
  if (!list.length) return 'Unknown sender'
  const first = list[0]
  return first.name ? `${first.name} <${first.address}>` : first.address
}

export function formatRecipients(toHeader: any): string {
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

export function formatRecipientsElements(toHeader: any) {
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

export function getSenderAddress(fromHeader: any): string | null {
  const list = Array.isArray(fromHeader) ? fromHeader : []
  if (!list.length) return null
  const first = list[0]
  return first.address || null
}

export function formatDate(input?: string | Date | null) {
  if (!input) return ''
  const d = new Date(input)
  return d.toLocaleString()
}

export function timeAgo(input?: string | Date | null) {
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
  return then.toLocaleString()
}

export default {
  categoryColor,
  formatFrom,
  formatRecipients,
  formatRecipientsElements,
  getSenderAddress,
  formatDate,
  timeAgo
}
