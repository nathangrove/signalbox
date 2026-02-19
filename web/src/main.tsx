import * as React from 'react'
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

        // Request Notification permission (best-effort) so the SW can show
        // a system notification when a new version activates while the app
        // is backgrounded. Don't prompt if the user already denied.
        try {
          if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
            Notification.requestPermission().then(permission => {
              console.log('Notification permission:', permission);
            }).catch(() => {});
          }
        } catch (e) {
          // ignore
        }

        // If there's an already-waiting worker, prompt the user to update.
        function promptUpdateFor(registration: ServiceWorkerRegistration) {
          const waiting = registration.waiting;
          if (!waiting) return;
          try {
            const accept = confirm('A new version is available — reload to update?');
            if (accept) {
              // Ask the waiting SW to skipWaiting, it will activate and then
              // the page will reload on controllerchange or SW message.
              waiting.postMessage({ type: 'SKIP_WAITING' });
            }
          } catch (e) {
            // ignore
          }
        }

        if (reg.waiting) {
          promptUpdateFor(reg);
        }

        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              promptUpdateFor(reg);
            }
          });
        });

        // When the active controller changes (a new SW took control), reload.
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          try { window.location.reload(); } catch (e) { /* ignore */ }
        });

        // Also listen for direct messages from the SW (e.g. activation notice).
        navigator.serviceWorker.addEventListener('message', (evt) => {
          if (evt.data && evt.data.type === 'NEW_VERSION_ACTIVATED') {
            try { window.location.reload(); } catch (e) { /* ignore */ }
          }
        });
      }).catch(err => console.warn('Service worker registration failed', err))
    } catch (e) { console.warn('SW register error', e) }
  })
}
