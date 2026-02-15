import React from 'react'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import List from '@mui/material/List'
import ListSubheader from '@mui/material/ListSubheader'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import Divider from '@mui/material/Divider'
import CircularProgress from '@mui/material/CircularProgress'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Box from '@mui/material/Box'
import LaunchIcon from '@mui/icons-material/Launch'
import ArchiveIcon from '@mui/icons-material/Archive'
import UnarchiveIcon from '@mui/icons-material/Unarchive'
import ReportIcon from '@mui/icons-material/Report'
import ForwardIcon from '@mui/icons-material/Forward'
import ReplyIcon from '@mui/icons-material/Reply'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'

import { formatFrom, formatRecipientsElements, categoryColor, timeAgo, formatDate } from '../../../utils'

export default function MessageListPanel(props: any) {
  const {
    isMobile,
    mobileView,
    setMobileView,
    mailboxTitle,
    selectedMailbox,
    loadingMessages,
    messages,
    search,
    setSearch,
    groupedMessagesByDate,
    selectedMessage,
    setSelectedMessage,
    replaceRoute,
    setContextMenu,
    setCategoryMenu,
    hasMore,
    loadMoreRef,
    enqueueMessageAi,
    getMessage,
    setMessages,
    setAiProcessing,
    setMessageArchivedClient,
    markMessageUnread,
    setMessageDetail,
    pageSize
  } = props

  const [expandedGroups, setExpandedGroups] = React.useState<Record<string, boolean>>({});

  // Per-row component so each message can manage its own touch state
  function MessageRow({ msg, groupIndicator }: { msg: any; groupIndicator?: React.ReactNode }) {
    const [tx, setTx] = React.useState(0)
    const [dragging, setDragging] = React.useState(false)
    const startX = React.useRef<number | null>(null)
    const startY = React.useRef<number | null>(null)
    const threshold = 80 // px to trigger toggle

    const onTouchStart = (e: React.TouchEvent) => {
      if (!isMobile) return
      const t = e.touches[0]
      startX.current = t.clientX
      startY.current = t.clientY
      setDragging(true)
    }

    const onTouchMove = (e: React.TouchEvent) => {
      if (!dragging || startX.current === null) return
      const t = e.touches[0]
      const dx = t.clientX - startX.current
      const dy = startY.current ? Math.abs(t.clientY - startY.current) : 0
      // if vertical scroll is larger, don't treat as horizontal swipe
      if (dy > Math.abs(dx)) return
      e.preventDefault()
      // allow horizontal drag both ways (we'll toggle archive on release)
      const limited = Math.max(Math.min(dx, 120), -160)
      setTx(limited)
    }

    const onTouchEnd = () => {
      if (!dragging) return
      setDragging(false)
      if (Math.abs(tx) >= threshold) {
        // any horizontal swipe beyond threshold toggles archived state
        setMessageArchivedClient(msg.id, !msg.archived)
        setTx(0)
      } else {
        // reset
        setTx(0)
      }
    }

    // Show the same action icon regardless of swipe direction because swipe either way toggles
    const actionIsUnarchive = !!msg.archived
    const bgColor = actionIsUnarchive ? '#2e7d32' : '#1976d2'
    const ActionIcon = actionIsUnarchive ? UnarchiveIcon : ArchiveIcon

    return (
      <React.Fragment key={msg.id}>
        <div
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          style={{ position: 'relative', overflow: 'hidden' }}
        >
          {/* background action indicator (appears from whichever side the user swipes) */}
          <div style={{
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: tx < 0 ? 'flex-end' : 'flex-start',
            padding: '0 16px',
            pointerEvents: 'none',
            color: '#fff',
            background: tx === 0 ? 'transparent' : bgColor,
            transition: dragging ? 'none' : 'background 150ms ease'
          }}>
            {tx !== 0 ? <ActionIcon /> : null}
          </div>

          <div style={{ transform: `translateX(${tx}px)`, transition: dragging ? 'none' : 'transform 180ms cubic-bezier(.2,.8,.2,1)' }}>
            <ListItemButton
              selected={selectedMessage?.id === msg.id}
              onClick={() => { setSelectedMessage(msg); replaceRoute(selectedMailbox?.id || null, null, msg.id); if (isMobile) setMobileView('message') }}
              onContextMenu={(e) => { e.preventDefault(); setContextMenu({ mouseX: e.clientX - 2, mouseY: e.clientY - 4, id: msg.id }) }}
              alignItems="flex-start"
              style={{ opacity: msg.collapsed ? 0.65 : 1 }}
            >
              <ListItemText
                primaryTypographyProps={{ fontWeight: !(msg.read === true || (Array.isArray(msg.flags) ? msg.flags.includes('\\Seen') : false)) ? 600 : 400 }}
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
                <Chip
                  label={msg.category}
                  size="small"
                  color={categoryColor(msg.category) as any}
                  sx={{ ml: 1, textTransform: 'capitalize' }}
                />
              )}
              {groupIndicator ? <Box sx={{ ml: 1, display: 'flex', alignItems: 'center' }}>{groupIndicator}</Box> : null}
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

              <IconButton size="small" sx={{ ml: 1 }} disabled={msg.archived} onClick={e => {
                e.stopPropagation();
                const id = msg.id; const archived = !msg.archived; setMessageArchivedClient(id, archived);
              }}>
                {msg.archived ? <UnarchiveIcon fontSize="small" /> : <ArchiveIcon fontSize="small" />}
              </IconButton>
            </ListItemButton>
          </div>
        </div>
        <Divider component="li" />
      </React.Fragment>
    )
  }

  return (
    <Paper sx={{ p: 1.5, overflow: 'auto', display: isMobile && mobileView === 'message' ? 'none' : 'block' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Box>
          <Typography variant="subtitle2" sx={{ color: 'text.secondary' }}>{mailboxTitle}</Typography>
          {selectedMailbox?.lastCheckedAt && <Typography variant="caption" color="text.secondary">{`Synced: ${timeAgo(selectedMailbox.lastCheckedAt)}`}</Typography>}
        </Box>
      </Box>
      {!isMobile && (
        <TextField
          size="small"
          placeholder="Search mail"
          value={search}
          onChange={e => setSearch(e.target.value)}
          fullWidth
          sx={{ mb: 1 }}
        />
      )}
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

              // build groups keyed by normalized subject
              const groups: Record<string, any[]> = {}
              for (const m of list) {
                const key = (m.normalizedSubject || m.subject || '').trim() || '__no_subject__'
                groups[key] = groups[key] || []
                groups[key].push(m)
              }

              return (
                <React.Fragment key={section.key}>
                  <ListSubheader sx={{ bgcolor: 'transparent', mt: 1, pl: 0, fontWeight: 600 }}>{section.label}</ListSubheader>

                  {Object.entries(groups).map(([key, group]) => {
                    group.sort((a: any, b: any) => {
                      const av = a.internalDate ? new Date(a.internalDate).getTime() : 0
                      const bv = b.internalDate ? new Date(b.internalDate).getTime() : 0
                      return bv - av
                    })

                    const representative = group[0]
                    const collapsedCount = group.length - 1
                    const expanded = !!expandedGroups[key]

                    if (!expanded) {
                      const indicator = collapsedCount > 0 ? (
                        <Chip
                          label={`+${collapsedCount}`}
                          size="small"
                          onClick={(e) => { e.stopPropagation(); setExpandedGroups(prev => ({ ...prev, [key]: true })) }}
                          sx={{ ml: 1, cursor: 'pointer' }}
                        />
                      ) : null

                      return (
                        <React.Fragment key={key}>
                          <MessageRow key={representative.id} msg={representative} groupIndicator={indicator} />
                        </React.Fragment>
                      )
                    }

                    return (
                      <React.Fragment key={key}>
                        {group.map((m: any) => <MessageRow key={m.id} msg={m} />)}
                      </React.Fragment>
                    )
                  })}
                </React.Fragment>
              )
            })
          })()}
          {hasMore && <Box ref={loadMoreRef} sx={{ height: 32 }} />}

          {/* Menus are controlled by parent via setContextMenu / setCategoryMenu when needed */}
        </List>
      )}
    </Paper>
  )
}
