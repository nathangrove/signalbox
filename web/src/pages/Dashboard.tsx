import React, { useEffect, useState } from 'react'
import { getDashboard } from '../api'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import Grid from '@mui/material/Grid'
import Chip from '@mui/material/Chip'
import Box from '@mui/material/Box'

export default function Dashboard(){
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<any>(null)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const res = await getDashboard()
        if (mounted) setData(res)
      } catch (e) {
        console.error('dashboard fetch failed', e)
      } finally { if (mounted) setLoading(false) }
    })()
    return () => { mounted = false }
  }, [])

  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']

  // Group events by ISO date string (YYYY-MM-DD)
  const eventsByDate: Record<string, any[]> = {}
  if (data && Array.isArray(data.events)) {
    for (const ev of data.events) {
      const d = new Date(ev.start);
      const key = d.toISOString().slice(0,10);
      eventsByDate[key] = eventsByDate[key] || [];
      eventsByDate[key].push(ev);
    }
  }

  // Build month grid for current month (start Monday)
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  // find start of week (Monday) containing monthStart
  const monthStartDay = monthStart.getDay(); // 0=Sun
  const offsetToMonday = (monthStartDay === 0) ? -6 : (1 - monthStartDay);
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() + offsetToMonday);

  // create array of 42 days (6 weeks)
  const monthGrid: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    monthGrid.push(d);
  }

  return (
    <div>
      <Paper sx={{ p:2, mb:2 }}>
        <Typography variant="h5">Dashboard</Typography>
        <Typography variant="body2" sx={{ mt:1 }}>{loading ? 'Loading...' : (data?.llmSummary || 'No summary available.')}</Typography>
        <Box sx={{ mt:2, display:'flex', gap:1 }}>
          <Chip label={`Total: ${data?.counts?.total ?? '—'}`} />
          <Chip label={`Unread: ${data?.counts?.unread ?? '—'}`} />
          <Chip color="primary" label={`Awaiting Reply: ${data?.counts?.awaitingReply ?? '—'}`} />
        </Box>
      </Paper>

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1 }}>
        {days.map(d => (
          <Box key={d} sx={{ p:1, textAlign:'center', borderBottom: '1px solid', borderColor: 'divider' }}>
            <Typography variant="subtitle2">{d}</Typography>
          </Box>
        ))}

        {monthGrid.map(dayDate => {
          const iso = dayDate.toISOString().slice(0,10);
          const inCurrentMonth = dayDate.getMonth() === today.getMonth();
          const evs = eventsByDate[iso] || [];
          return (
            <Paper key={iso + dayDate.getDate()} sx={{ p:1, minHeight:100, bgcolor: inCurrentMonth ? 'background.paper' : 'action.hover', border: '1px solid', borderColor: 'divider' }}>
              <Typography variant="caption" sx={{ float:'right' }}>{dayDate.getDate()}</Typography>
              {loading && <Typography variant="body2">Loading...</Typography>}
              {!loading && evs.length === 0 && (
                <Typography variant="body2" color="text.secondary">No events</Typography>
              )}
              {!loading && evs.map((ev:any) => (
                <Box key={ev.id} sx={{ mt:1 }}>
                  <Typography variant="body2"><strong>{new Date(ev.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong> — {ev.summary}</Typography>
                </Box>
              ))}
            </Paper>
          )
        })}
      </Box>
    </div>
  )
}
