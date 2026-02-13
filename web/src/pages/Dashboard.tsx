import React, { useEffect, useState } from 'react'
import { getDashboard } from '../api'
import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import Divider from '@mui/material/Divider'

export default function Dashboard(){
  const [data, setData] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)

  function openEventMessage(evt: any) {
    if (!evt?.messageId) return
    try {
      const path = `/mail/${encodeURIComponent(evt.mailboxId || '')}/message/${encodeURIComponent(evt.messageId)}`
      window.history.pushState({}, '', path)
      window.dispatchEvent(new PopStateEvent('popstate'))
    } catch (e) { console.warn('open event message failed', e) }
  }

  useEffect(() => {
    (async () => {
      setLoading(true)
      try {
        const d = await getDashboard()
        setData(d)
      } catch (e) { console.warn('fetch dashboard failed', e) }
      setLoading(false)
    })()
  }, [])

  if (loading) return <Typography>Loading dashboard…</Typography>

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 2 }}>
      <Box>
        <Paper sx={{ p: 2, mb: 2 }}>
          <Typography variant="h6">Overview</Typography>
          <Typography>Total messages: {data?.counts?.total ?? 0}</Typography>
          <Typography>Unread: {data?.counts?.unread ?? 0}</Typography>
          <Typography>Awaiting reply: {data?.counts?.awaitingReply ?? 0}</Typography>
          {data?.llmSummary && (
            <Box sx={{ mt: 1 }}>
              <Divider sx={{ my: 1 }} />
              <Typography variant="body2">{data.llmSummary}</Typography>
            </Box>
          )}
        </Paper>

        <Paper sx={{ p: 2, mb: 2 }}>
          <Typography variant="h6">Counts by Category</Typography>
          <Box sx={{ mt: 1, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {Object.entries(data?.countsByCategory || {}).map(([k, v]: any) => (
              <Chip key={k} label={`${k}: ${v.total} (${v.unread})`} />
            ))}
          </Box>
        </Paper>

        <Paper sx={{ p: 2 }}>
          <Typography variant="h6">Upcoming events (today + tomorrow)</Typography>
          <List dense>
            {(data?.events || []).map((e: any) => (
              <ListItem key={e.id} divider>
                <ListItemText
                  primary={e.summary || '(no title)'}
                  secondary={new Date(e.start).toLocaleString()}
                />
                {e.messageId && (
                  <Chip
                    size="small"
                    label="Open message"
                    onClick={() => openEventMessage(e)}
                    clickable
                  />
                )}
              </ListItem>
            ))}
          </List>
        </Paper>
      </Box>

      <Box>
        <Paper sx={{ p: 2, mb: 2 }}>
          <Typography variant="h6">News</Typography>
          <List dense>
            {(data?.news || []).map((n: any, idx: number) => (
              <ListItem key={idx} component="a" href={n.url} target="_blank" rel="noreferrer" button>
                <ListItemText primary={n.title} secondary={n.source} />
              </ListItem>
            ))}
          </List>
        </Paper>
        
      </Box>
    </Box>
  )
}
