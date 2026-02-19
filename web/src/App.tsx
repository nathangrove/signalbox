import * as React from 'react'
import { useEffect, useState } from 'react'
import Login from './pages/Login'
import Mail from './pages/Mail/Mail'
import Dashboard from './pages/Dashboard'
import { initSocket } from './socket'
import { getMessage, getMailboxes, getDashboard } from './api'
import AppBar from '@mui/material/AppBar'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import Container from '@mui/material/Container'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import MenuIcon from '@mui/icons-material/Menu'
import { useTheme, ThemeProvider, createTheme } from '@mui/material/styles'
import useMediaQuery from '@mui/material/useMediaQuery'
import CssBaseline from '@mui/material/CssBaseline'
import Switch from '@mui/material/Switch'
import FormControlLabel from '@mui/material/FormControlLabel'
import TextField from '@mui/material/TextField'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import SettingsIcon from '@mui/icons-material/Settings'
import Accounts from './pages/Accounts'
import { fillFavicon } from './utils/favicon'

export default function App(){
  const outerTheme = useTheme()
  const isMobile = useMediaQuery(outerTheme.breakpoints.down('sm'))
  const [loggedIn, setLoggedIn] = useState(!!localStorage.getItem('access_token'))

  // keep track of current path so navigation updates render without reload
  const [currentPath, setCurrentPath] = useState<string>(typeof window !== 'undefined' ? window.location.pathname : '/')
  useEffect(() => {
    const onPop = () => setCurrentPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  function navigate(path: string) {
    try {
      window.history.pushState({}, '', path)
      setCurrentPath(path)
      window.dispatchEvent(new PopStateEvent('popstate'))
    } catch (_) { window.location.pathname = path }
  }

  const [settingsAnchor, setSettingsAnchor] = useState<null | HTMLElement>(null)
  const [openAccounts, setOpenAccounts] = useState(false)

  const [mode, setMode] = useState<'light'|'dark'>(() => {
    try { return (localStorage.getItem('theme') === 'dark') ? 'dark' : 'light' } catch { return 'light' }
  })
  const appTheme = React.useMemo(() => createTheme({ palette: { mode } }), [mode])
  const [mobileSearch, setMobileSearch] = useState('')
  const [titleBase] = useState(() => (typeof document !== 'undefined' ? document.title || 'Signalbox' : 'Signalbox'))
  const [primaryUnreadCount, setPrimaryUnreadCount] = useState(0)
  const activeAccountRef = React.useRef<string | null>(null)

  // fetch primary unread count, optionally scoped to an accountId
  async function refreshPrimaryCount(accountId?: string | null) {
    try {
      if (accountId) {
        const data = await getMailboxes(accountId || undefined)
        const list = Array.isArray(data) ? data : []
        let total = 0
        for (const b of list) {
          const cc = b.categoryCounts || {}
          total += Number(cc.primary || 0)
        }
        setPrimaryUnreadCount(total)
      } else {
        // For global count, prefer server-side dashboard summary (includes unread per category)
        try {
          const d = await getDashboard()
          let primaryUnread = 0
          const catObj = d?.countsByCategory || {}
          for (const [k, v] of Object.entries(catObj || {})) {
            try {
              if (String(k).toLowerCase() === 'primary') {
                primaryUnread += Number((v as any)?.unread || 0)
              }
            } catch (_) {}
          }
          setPrimaryUnreadCount(primaryUnread)
        } catch (e) {
          // fallback to summing mailboxes
          const data = await getMailboxes(undefined)
          const list = Array.isArray(data) ? data : []
          let total = 0
          for (const b of list) {
            const cc = b.categoryCounts || {}
            total += Number(cc.primary || 0)
          }
          setPrimaryUnreadCount(total)
        }
      }
    } catch (e) { console.warn('refresh primary count failed', e) }
  }

  React.useEffect(() => {
    function onMailSearchUpdated(e: any) {
      try { setMobileSearch(e?.detail?.search || '') } catch(_) {}
    }
    window.addEventListener('mailSearchUpdated', onMailSearchUpdated as any)
    return () => window.removeEventListener('mailSearchUpdated', onMailSearchUpdated as any)
  }, [])

  // make favicon logo fill the available space by rendering the SVG to a cover-scaled PNG
  React.useEffect(() => {
    try { fillFavicon().catch(() => {}) } catch (_) {}
  }, [])


  // initialize socket and desktop notifications when logged in
  React.useEffect(() => {
    if (!loggedIn) return;
    const socket = initSocket();

    function showDesktopNotification(title: string, body?: string, data?: any) {
      try {
        if (Notification.permission === 'default') {
          Notification.requestPermission();
        }
        if (Notification.permission === 'granted') {
          const n = new Notification(title, { body: body || undefined });
          n.onclick = () => {
            window.focus();
            try {
              // dispatch a custom event so Mail component can open the specific message
              if (data && data.messageId) {
                window.dispatchEvent(new CustomEvent('openMessage', { detail: { messageId: data.messageId, mailboxId: data.mailboxId } }));
              } else {
                // fallback: navigate to mail view
                window.location.hash = '#/';
              }
            } catch (_) {
              window.location.hash = '#/';
            }
          };
        }
      } catch (e) {
        console.warn('desktop notification failed', e);
      }
    }

    // use outer refreshPrimaryCount

    const onMessageCreated = (payload: any) => {
      (async () => {
        try {
          if (!payload || !payload.messageId) return;
          let msg: any = null;
          const attempts = [0, 2000, 5000];
          for (let i = 0; i < attempts.length; i++) {
            try { msg = await getMessage(payload.messageId); } catch (_) { msg = null }
            if (msg && (msg.category || typeof msg.spam !== 'undefined')) break;
            await new Promise(res => setTimeout(res, attempts[i]));
          }
          if (!msg) return;
          const category = (msg.category || '').toLowerCase();
          const spam = !!msg.spam;
          if (spam) return;
          // Only show desktop notification for primary
          if (category !== 'primary') return;
          const title = payload.subject || msg.subject || 'New message';
          const from = payload.from ? (payload.from.name || payload.from.address || '') : (msg.fromHeader ? (Array.isArray(msg.fromHeader) && msg.fromHeader[0] ? (msg.fromHeader[0].name || msg.fromHeader[0].address) : '') : '');
          showDesktopNotification(title, from, { messageId: payload.messageId, mailboxId: payload.mailboxId });
          // refresh primary unread badge (scoped to selected account)
          try { await refreshPrimaryCount(activeAccountRef.current) } catch (_) {}
        } catch (e) { console.warn('message.created handler error', e); }
      })();
    };

    socket.on('message.created', onMessageCreated);
    socket.on('message.updated', () => { try { refreshPrimaryCount(activeAccountRef.current) } catch (_) {} })

    // initial primary unread count (scope to selected account if present)
    try { refreshPrimaryCount(activeAccountRef.current).catch(() => {}) } catch (_) {}

    // Prompt for notification permission on first login and show welcome when granted
    try {
      if ('Notification' in window) {
        if (Notification.permission === 'default') {
          Notification.requestPermission().then(p => {
            if (p === 'granted') {
              showDesktopNotification('Welcome to NotJAEC', 'Notifications enabled — you will receive new message alerts.');
            }
          }).catch(() => {});
        }
      }
    } catch (e) {
      console.warn('notification permission prompt failed', e);
    }

    return () => {
      try { socket.off('message.created', onMessageCreated); } catch (_) {}
    };
  }, [loggedIn]);

  // listen for account selection changes from Mail component and refresh primary count scoped to that account
  React.useEffect(() => {
    function onAccountSelection(e: any) {
      try {
        const aid = e?.detail?.accountId || undefined
        activeAccountRef.current = aid || null
        refreshPrimaryCount(aid)
      } catch (_) {}
    }
    window.addEventListener('account.selection.changed', onAccountSelection as any)
    return () => window.removeEventListener('account.selection.changed', onAccountSelection as any)
  }, [])

  // update document title to show primary unread count and update favicon badge
  React.useEffect(() => {
    try {
      if (typeof document === 'undefined') return
      const baseTitle = `Inbox - ${titleBase}`
      document.title = primaryUnreadCount > 0 ? `(${primaryUnreadCount}) ${baseTitle}` : baseTitle
    } catch (_) {}
  }, [primaryUnreadCount, titleBase])

  function onLogin(){ setLoggedIn(true) }
  function logout(){ localStorage.removeItem('access_token'); setLoggedIn(false) }

  function openSettingsMenu(e: React.MouseEvent<HTMLElement>) { setSettingsAnchor(e.currentTarget) }
  function closeSettingsMenu() { setSettingsAnchor(null) }
  function handleOpenAccounts() { closeSettingsMenu(); setOpenAccounts(true) }
  function handleCloseAccounts() { setOpenAccounts(false) }

  async function checkForUpdates() {
    try {
      if (!('serviceWorker' in navigator)) return alert('Service worker not available');
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return alert('No service worker registration found');
      // If there's a waiting worker, ask it to skip waiting and let controllerchange listener reload the page
      if (reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        alert('Update activating — the app will reload when ready.');
        return;
      }
      // Otherwise, try to update (will fetch a new SW if available)
      await reg.update();
      // If a new worker is now waiting, trigger skipWaiting
      if (reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        alert('Update activating — the app will reload when ready.');
        return;
      }
      alert('No update found');
    } catch (e) {
      console.warn('checkForUpdates failed', e);
      alert('Update check failed');
    }
  }

  return (
    <ThemeProvider theme={appTheme}>
      <CssBaseline />
      <div>
      <AppBar position="static">
        <Toolbar>
          {loggedIn && isMobile && (
            <IconButton color="inherit" onClick={() => window.dispatchEvent(new CustomEvent('toggleMailDrawer'))} size="small">
              <MenuIcon />
            </IconButton>
          )}
          {loggedIn && isMobile ? (
            <TextField
              size="small"
              placeholder="Search mail"
              value={mobileSearch}
              onChange={(e) => {
                const v = e.target.value
                setMobileSearch(v)
                try { window.dispatchEvent(new CustomEvent('mailSearchInput', { detail: { value: v } })) } catch(_) {}
              }}
              sx={{ flexGrow: 1, bgcolor: 'background.paper', borderRadius: 1 }}
            />
          ) : (
            <Box sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', gap: 2 }}>
              <Box component="img" src="/logo-white-text.svg" alt="Signalbox" sx={{ height: 62 }} />
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Button color={currentPath === '/' ? 'secondary' : 'inherit'} onClick={() => navigate('/')}>Mail</Button>
                <Button color={currentPath.startsWith('/dashboard') ? 'secondary' : 'inherit'} onClick={() => navigate('/dashboard')}>Dashboard</Button>
              </Box>
            </Box>
          )}
          {loggedIn && (
            <>
              <IconButton color="inherit" onClick={openSettingsMenu} size="small">
                <SettingsIcon />
              </IconButton>
              <Menu
                anchorEl={settingsAnchor}
                open={Boolean(settingsAnchor)}
                onClose={closeSettingsMenu}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
              >
                <MenuItem onClick={() => { closeSettingsMenu(); window.location.pathname = '/dashboard' }}>Dashboard</MenuItem>
                <MenuItem>
                  <FormControlLabel
                    control={<Switch checked={mode === 'dark'} onChange={(e) => { const next = e.target.checked ? 'dark' : 'light'; setMode(next); try { localStorage.setItem('theme', next) } catch (_) {} }} />}
                    label="Dark mode"
                  />
                </MenuItem>
                <MenuItem onClick={handleOpenAccounts}>Accounts</MenuItem>
                <MenuItem onClick={() => { closeSettingsMenu(); checkForUpdates(); }}>Check for updates</MenuItem>
                <MenuItem onClick={() => { closeSettingsMenu(); /* placeholder for other settings */ }}>Preferences</MenuItem>
                <MenuItem onClick={() => { closeSettingsMenu(); logout(); }}>Logout</MenuItem>
              </Menu>
            </>
          )}
        </Toolbar>
      </AppBar>

      <Dialog open={openAccounts} onClose={handleCloseAccounts} maxWidth="md" fullWidth>
        <DialogTitle>Accounts</DialogTitle>
        <DialogContent>
          <Accounts />
        </DialogContent>
      </Dialog>
      <Container disableGutters={isMobile} sx={{ mt: isMobile ? 0 : 4, px: isMobile ? 0 : undefined, maxWidth: 'xl', m: isMobile ? 0 : 2 }}>
        {loggedIn ? (currentPath && currentPath.startsWith('/dashboard') ? <Dashboard /> : <Mail />) : <Login onLogin={onLogin} />}
      </Container>
      </div>
    </ThemeProvider>
  )
}
