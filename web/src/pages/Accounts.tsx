import React, { useEffect, useState } from 'react'
import { getAccounts, createAccount, syncAccount, updateAccount } from '../api'
import Paper from '@mui/material/Paper'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import InputLabel from '@mui/material/InputLabel'
import FormControl from '@mui/material/FormControl'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import Box from '@mui/material/Box'

export default function Accounts(){
  const [accounts, setAccounts] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [provider, setProvider] = useState('imap')
  const [email, setEmail] = useState('')
  const [host, setHost] = useState('')
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState('')
  const [smtpUser, setSmtpUser] = useState('')
  const [smtpPass, setSmtpPass] = useState('')
  const [smtpSecure, setSmtpSecure] = useState(true)
  const [selectedAccount, setSelectedAccount] = useState<any | null>(null)
  const [imapHostState, setImapHostState] = useState('')
  const [imapPortState, setImapPortState] = useState('')
  const [imapUserState, setImapUserState] = useState('')
  const [imapPassState, setImapPassState] = useState('')
  const [imapSecureState, setImapSecureState] = useState(true)

  async function load(){
    setLoading(true)
    try{ const data = await getAccounts(); setAccounts(Array.isArray(data)?data:[]) }finally{ setLoading(false) }
  }

  useEffect(()=>{ load() },[])

  async function add(e:React.FormEvent){
    e.preventDefault()
    const payload = { provider, email, config: { host, user, pass, smtpHost: smtpHost || undefined, smtpPort: smtpPort ? Number(smtpPort) : undefined, smtpUser: smtpUser || undefined, smtpPass: smtpPass || undefined, smtpSecure } }
    await createAccount(payload)
    setEmail(''); setHost(''); setUser(''); setPass('')
    setSmtpHost(''); setSmtpPort(''); setSmtpUser(''); setSmtpPass(''); setSmtpSecure(true)
    load()
  }

  function editAccount(a:any){
    setSelectedAccount(a);
    const cfg = a.config || {};
    setSmtpHost(cfg.smtpHost || cfg.smtp_host || '');
    setSmtpPort(cfg.smtpPort ? String(cfg.smtpPort) : (cfg.smtp_port ? String(cfg.smtp_port) : ''));
    setSmtpUser(cfg.smtpUser || cfg.smtp_user || '');
    setSmtpPass(cfg.smtpPass || cfg.smtp_pass || '');
    setSmtpSecure(typeof cfg.smtpSecure !== 'undefined' ? !!cfg.smtpSecure : true);
    setImapHostState(cfg.imapHost || cfg.imap_host || cfg.host || '');
    setImapPortState(cfg.imapPort ? String(cfg.imapPort) : (cfg.imap_port ? String(cfg.imap_port) : ''));
    setImapUserState(cfg.imapUser || cfg.imap_user || cfg.user || '');
    setImapPassState(cfg.imapPass || cfg.imap_pass || cfg.pass || '');
    setImapSecureState(typeof cfg.imapSecure !== 'undefined' ? !!cfg.imapSecure : true);
  }

  async function saveAccount(){
    if (!selectedAccount) return;
    const payload:any = { config: {
      smtpHost: smtpHost || undefined,
      smtpPort: smtpPort ? Number(smtpPort) : undefined,
      smtpUser: smtpUser || undefined,
      smtpPass: smtpPass || undefined,
      smtpSecure,
      imapHost: imapHostState || undefined,
      imapPort: imapPortState ? Number(imapPortState) : undefined,
      imapUser: imapUserState || undefined,
      imapPass: imapPassState || undefined,
      imapSecure: imapSecureState
    } };
    await updateAccount(selectedAccount.id, payload);
    setSelectedAccount(null);
    setSmtpHost(''); setSmtpPort(''); setSmtpUser(''); setSmtpPass(''); setSmtpSecure(true);
    setImapHostState(''); setImapPortState(''); setImapUserState(''); setImapPassState(''); setImapSecureState(true);
    load();
  }

  return (
    <Box sx={{ display:'grid', gap:3 }}>
      <Paper sx={{ p:2 }}>
        <Typography variant="h6">Your Accounts</Typography>
        {loading ? <Typography>Loading...</Typography> : (
          <List>
            {accounts.map(a=> (
              <ListItem key={a.id} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box>
                  <div>{a.email} ({a.provider})</div>
                  <div style={{ fontSize: 12, color: '#666' }}>{(a.config && a.config.smtpHost) ? `SMTP: ${a.config.smtpHost}` : 'No SMTP configured'}</div>
                </Box>
                <Box>
                  <Button size="small" onClick={()=>editAccount(a)}>Edit</Button>
                  <Button size="small" onClick={()=>syncAccount(a.id)}>Sync</Button>
                </Box>
              </ListItem>
            ))}
          </List>
        )}
      </Paper>

      <Paper sx={{ p:2 }}>
        <Typography variant="h6">Add account</Typography>
        <Box component="form" onSubmit={add} sx={{ display:'grid', gap:2, maxWidth:600 }}>
          <FormControl>
            <InputLabel id="provider-label">Provider</InputLabel>
            <Select labelId="provider-label" value={provider} label="Provider" onChange={e=>setProvider(e.target.value)}>
              <MenuItem value="imap">IMAP</MenuItem>
            </Select>
          </FormControl>
          <TextField label="Account email" value={email} onChange={e=>setEmail(e.target.value)} />
          <TextField label="IMAP host" value={host} onChange={e=>setHost(e.target.value)} />
          <TextField label="IMAP user" value={user} onChange={e=>setUser(e.target.value)} />
          <TextField label="IMAP pass" type="password" value={pass} onChange={e=>setPass(e.target.value)} />
          <Typography variant="subtitle2">SMTP (optional)</Typography>
          <TextField label="SMTP host" value={smtpHost} onChange={e=>setSmtpHost(e.target.value)} />
          <TextField label="SMTP port" value={smtpPort} onChange={e=>setSmtpPort(e.target.value)} />
          <TextField label="SMTP user" value={smtpUser} onChange={e=>setSmtpUser(e.target.value)} />
          <TextField label="SMTP pass" type="password" value={smtpPass} onChange={e=>setSmtpPass(e.target.value)} />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography>SMTP secure (TLS)</Typography>
            <input type="checkbox" checked={smtpSecure} onChange={e=>setSmtpSecure(e.target.checked)} />
          </Box>
          <Box>
            <Button variant="contained" type="submit">Add</Button>
          </Box>
        </Box>
      </Paper>
      {selectedAccount && (
        <Paper sx={{ p:2 }}>
          <Typography variant="h6">Edit account settings for {selectedAccount.email}</Typography>
          <Box sx={{ display:'grid', gap:2, maxWidth:600 }}>
            <Typography variant="subtitle2">IMAP</Typography>
            <TextField label="IMAP host" value={imapHostState} onChange={e=>setImapHostState(e.target.value)} />
            <TextField label="IMAP port" value={imapPortState} onChange={e=>setImapPortState(e.target.value)} />
            <TextField label="IMAP user" value={imapUserState} onChange={e=>setImapUserState(e.target.value)} />
            <TextField label="IMAP pass" type="password" value={imapPassState} onChange={e=>setImapPassState(e.target.value)} />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography>IMAP secure (TLS)</Typography>
              <input type="checkbox" checked={imapSecureState} onChange={e=>setImapSecureState(e.target.checked)} />
            </Box>

            <Typography variant="subtitle2">SMTP</Typography>
            <TextField label="SMTP host" value={smtpHost} onChange={e=>setSmtpHost(e.target.value)} />
            <TextField label="SMTP port" value={smtpPort} onChange={e=>setSmtpPort(e.target.value)} />
            <TextField label="SMTP user" value={smtpUser} onChange={e=>setSmtpUser(e.target.value)} />
            <TextField label="SMTP pass" type="password" value={smtpPass} onChange={e=>setSmtpPass(e.target.value)} />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography>SMTP secure (TLS)</Typography>
              <input type="checkbox" checked={smtpSecure} onChange={e=>setSmtpSecure(e.target.checked)} />
            </Box>
            <Box>
              <Button variant="contained" onClick={saveAccount} sx={{ mr:1 }}>Save</Button>
              <Button variant="outlined" onClick={()=>setSelectedAccount(null)}>Cancel</Button>
            </Box>
          </Box>
        </Paper>
      )}
    </Box>
  )
}
