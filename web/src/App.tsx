import React, { useState } from 'react'
import Login from './pages/Login'
import Mail from './pages/Mail'
import { initSocket } from './socket'
import { getMessage } from './api'
import AppBar from '@mui/material/AppBar'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import Container from '@mui/material/Container'
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

export default function App(){
  const outerTheme = useTheme()
  const isMobile = useMediaQuery(outerTheme.breakpoints.down('sm'))
  const [loggedIn, setLoggedIn] = useState(!!localStorage.getItem('access_token'))

  const [settingsAnchor, setSettingsAnchor] = useState<null | HTMLElement>(null)
  const [openAccounts, setOpenAccounts] = useState(false)

  const [mode, setMode] = useState<'light'|'dark'>(() => {
    try { return (localStorage.getItem('theme') === 'dark') ? 'dark' : 'light' } catch { return 'light' }
  })
  const appTheme = React.useMemo(() => createTheme({ palette: { mode } }), [mode])
  const [mobileSearch, setMobileSearch] = useState('')
  const [titleBase] = useState(() => (typeof document !== 'undefined' ? document.title || 'NotJAEC' : 'NotJAEC'))
  const [unseenCount, setUnseenCount] = useState(0)

  React.useEffect(() => {
    function onMailSearchUpdated(e: any) {
      try { setMobileSearch(e?.detail?.search || '') } catch(_) {}
    }
    window.addEventListener('mailSearchUpdated', onMailSearchUpdated as any)
    return () => window.removeEventListener('mailSearchUpdated', onMailSearchUpdated as any)
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

    const onMessageCreated = (payload: any) => {
      // increment unseen counter when new messages arrive while tab not visible/focused
      try {
        if (typeof document !== 'undefined' && (document.visibilityState !== 'visible' || !document.hasFocus())) {
          setUnseenCount(c => c + 1)
        }
      } catch (_) {}

      (async () => {
        try {
          if (!payload || !payload.messageId) return;

          // Try to fetch message (and ai labels) a few times since classification may be async
          let msg: any = null;
          const attempts = [0, 2000, 5000];
          for (let i = 0; i < attempts.length; i++) {
            try {
              msg = await getMessage(payload.messageId);
            } catch (_) { msg = null }
            if (msg && (msg.category || typeof msg.spam !== 'undefined')) break;
            await new Promise(res => setTimeout(res, attempts[i]));
          }

          // If we couldn't determine category/spam, skip notification
          if (!msg) return;
          const category = (msg.category || '').toLowerCase();
          const spam = !!msg.spam;
          if (spam) return;
          if (category !== 'primary' && category !== 'updates') return;

          const title = payload.subject || msg.subject || 'New message';
          const from = payload.from ? (payload.from.name || payload.from.address || '') : (msg.fromHeader ? (Array.isArray(msg.fromHeader) && msg.fromHeader[0] ? (msg.fromHeader[0].name || msg.fromHeader[0].address) : '') : '');
          showDesktopNotification(title, from, { messageId: payload.messageId, mailboxId: payload.mailboxId });
        } catch (e) { console.warn('message.created handler error', e); }
      })();
    };

    socket.on('message.created', onMessageCreated);

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

  // update document title to show unseen count
  React.useEffect(() => {
    try {
      if (typeof document === 'undefined') return
      const baseTitle = `Inbox - ${titleBase}`
      document.title = unseenCount > 0 ? `(${unseenCount}) ${baseTitle}` : baseTitle
    } catch (_) {}
  }, [unseenCount, titleBase])

  // clear unseen counter when user focuses / views the tab
  React.useEffect(() => {
    function clearCount() { try { setUnseenCount(0) } catch (_) {} }
    function onVisibility() { if (typeof document !== 'undefined' && document.visibilityState === 'visible') clearCount() }
    window.addEventListener('focus', clearCount)
    window.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', clearCount)
      window.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  function onLogin(){ setLoggedIn(true) }
  function logout(){ localStorage.removeItem('access_token'); setLoggedIn(false) }

  function openSettingsMenu(e: React.MouseEvent<HTMLElement>) { setSettingsAnchor(e.currentTarget) }
  function closeSettingsMenu() { setSettingsAnchor(null) }
  function handleOpenAccounts() { closeSettingsMenu(); setOpenAccounts(true) }
  function handleCloseAccounts() { setOpenAccounts(false) }

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
            <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
              NotJAEC
            </Typography>
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
                <MenuItem>
                  <FormControlLabel
                    control={<Switch checked={mode === 'dark'} onChange={(e) => { const next = e.target.checked ? 'dark' : 'light'; setMode(next); try { localStorage.setItem('theme', next) } catch (_) {} }} />}
                    label="Dark mode"
                  />
                </MenuItem>
                <MenuItem onClick={handleOpenAccounts}>Accounts</MenuItem>
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
        {loggedIn ? <Mail /> : <Login onLogin={onLogin} />}
      </Container>
      </div>
    </ThemeProvider>
  )
}
