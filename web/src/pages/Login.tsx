import * as React from 'react'
import { useState } from 'react'
import { login, register } from '../api'
import Box from '@mui/material/Box'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'

export default function Login({ onLogin }: { onLogin: () => void }){
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'login'|'register'>('login')
  const [error, setError] = useState<string| null>(null)

  async function submit(e: React.FormEvent){
    e.preventDefault()
    setError(null)
    try{
      const res = mode === 'login' ? await login(email,password) : await register(email,password)
      if (res && res.access_token){
        localStorage.setItem('access_token', res.access_token)
        onLogin()
      } else {
        setError(JSON.stringify(res))
      }
    }catch(err:any){ setError(err.message || String(err)) }
  }

  return (
    <Paper sx={{ p:3, maxWidth:480, mx:'auto' }}>
      <Typography variant="h5" sx={{ mb:2 }}>{mode === 'login' ? 'Login' : 'Register'}</Typography>
      <Box component="form" onSubmit={submit} sx={{ display:'grid', gap:2 }}>
        <TextField label="Email" value={email} onChange={e=>setEmail(e.target.value)} fullWidth />
        <TextField label="Password" type="password" value={password} onChange={e=>setPassword(e.target.value)} fullWidth />
        <Box sx={{ display:'flex', gap:1 }}>
          <Button variant="contained" type="submit">{mode === 'login' ? 'Login' : 'Register'}</Button>
          <Button variant="outlined" onClick={()=>setMode(mode==='login'?'register':'login')}>{mode==='login'?'Create account':'Have account? Login'}</Button>
        </Box>
        {error && <Typography color="error">{error}</Typography>}
      </Box>
    </Paper>
  )
}
