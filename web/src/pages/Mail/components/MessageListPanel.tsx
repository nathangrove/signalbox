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
              return (
                <React.Fragment key={section.key}>
                  <ListSubheader sx={{ bgcolor: 'transparent', mt: 1, pl: 0, fontWeight: 600 }}>{section.label}</ListSubheader>
                  {list.map((msg: any) => {
                    const unread = !(msg.read === true || (Array.isArray(msg.flags) ? msg.flags.includes('\\Seen') : false))
                    return (
                      <React.Fragment key={msg.id}>
                        <ListItemButton
                          selected={selectedMessage?.id === msg.id}
                          onClick={() => { setSelectedMessage(msg); replaceRoute(selectedMailbox?.id || null, null); if (isMobile) setMobileView('message') }}
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
                            <Chip
                              label={msg.category}
                              size="small"
                              color={categoryColor(msg.category) as any}
                              sx={{ ml: 1, textTransform: 'capitalize' }}
                            />
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

                          <IconButton size="small" sx={{ ml: 1 }} disabled={msg.archived} onClick={e => {
                            e.stopPropagation();
                            const id = msg.id; const archived = !msg.archived; setMessageArchivedClient(id, archived);
                          }}>
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

          {/* Menus are controlled by parent via setContextMenu / setCategoryMenu when needed */}
        </List>
      )}
    </Paper>
  )
}
