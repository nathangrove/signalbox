import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

// Register service worker for PWA functionality (best-effort)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    try {
      navigator.serviceWorker.register('/sw.js').then(reg => {
        console.log('Service worker registered:', reg.scope)
      }).catch(err => console.warn('Service worker registration failed', err))
    } catch (e) { console.warn('SW register error', e) }
  })
}
