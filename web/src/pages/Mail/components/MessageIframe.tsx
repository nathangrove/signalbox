import * as React from 'react'
import { useMemo, useState, useEffect, useRef } from 'react'
import DOMPurify from 'dompurify'

type Props = {
  html: string
  darkMode?: boolean
  darkReader?: boolean
}

export default function MessageIframe({ html, darkMode, darkReader }: Props) {
  const id = useMemo(() => Math.random().toString(36).slice(2), [])

  const [height, setHeight] = useState<number | undefined>(undefined)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)

  const doc = useMemo(() => {
    // sanitize user HTML and forbid script-like tags
    const clean = DOMPurify.sanitize(html || '', { WHOLE_DOCUMENT: false, FORBID_TAGS: ['script','iframe','object','embed'] })
    const darkCss = darkMode ? `
      body{background:#0f1113;color:#e6eef8}
      a{color:#8ab4ff}
      /* keep backgrounds transparent but don't force colors so DarkReader can apply readable colors */
      body *{ background: transparent !important }
      pre, code, blockquote{background:rgba(255,255,255,0.04) !important}
      ` : ''

    // If darkReader is requested, include the DarkReader script and init code.
    const darkReaderScripts = (typeof window !== 'undefined' && typeof (window as any).DarkReader !== 'undefined') || false

    const darkReaderInclude = darkReader ? `
      <script src="/darkreader.min.js"></script>
      <script>
        try {
          if (window.DarkReader && window.DarkReader.enable) {
            // Allow DarkReader to override inline styles so pure-black text is adjusted
            window.DarkReader.enable({brightness: 100, contrast: 95, sepia: 10}, {ignoreInlineStyle: true});
          }

          // After DarkReader runs, fix any elements that remain pure black
          (function(){
            try {
              const adjust = () => {
                const nodes = document.querySelectorAll('body *');
                for (let i = 0; i < nodes.length; i++) {
                  const el = nodes[i];
                  try {
                    const cs = getComputedStyle(el);
                    const color = cs && cs.color;
                    if (color === 'rgb(0, 0, 0)' || color === 'rgba(0, 0, 0, 1)') {
                      el.style.color = '#d7dde8';
                    }
                  } catch (e) { /* ignore computed style errors */ }
                }
              };
              adjust();
              const mo = new MutationObserver(adjust);
              mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['style','class'] });
            } catch (e) { console.warn('darkreader post-adjust failed', e) }
          })();

        } catch (e) { console.warn('DarkReader init failed', e) }
      </script>
    ` : ''

    // script to post the document height to the parent window
    const resizeScript = `
      <script>
        (function(){
          try {
            const id = '${id}';
            const send = () => {
              try {
                const h = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
                console.log('message iframe sending height', h);
                window.parent.postMessage({ type: 'signalbox.messageHeight', id: id, height: h }, '*');
              } catch (e) { /* ignore */ }
            };
            const debounced = (() => { let t; return (fn) => { clearTimeout(t); t = setTimeout(fn, 50); }; })();
            window.addEventListener('load', () => debounced(send));
            window.addEventListener('resize', () => debounced(send));
            const mo = new MutationObserver(() => debounced(send));
            mo.observe(document.documentElement || document.body, { subtree: true, childList: true, attributes: true });
            // initial send
            debounced(send);
          } catch (e) { /* ignore */ }
        })();
      </script>`

    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <base href="${typeof window !== 'undefined' ? window.location.origin : '/'}">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    html,body{margin:0;padding:12px;font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;color:#111;background:transparent}
    img{max-width:100%;height:auto;display:block}
    a{color:#1a73e8}
    blockquote{margin:0;padding-left:12px;border-left:3px solid rgba(0,0,0,0.08)}
    ${darkCss}
  </style>
  ${darkReaderInclude}
</head>
<body>${clean}
  <script>
    (function(){
      try {
        // Ensure existing links open in a new tab and are safe
        const setAttrs = (el) => {
          try {
            el.forEach ? el.forEach(a => { a.target = '_blank'; a.rel = 'noopener noreferrer'; }) : null;
          } catch (e) { /* ignore */ }
        };

        setAttrs(document.querySelectorAll('a'));

        // Intercept clicks to open via window.open so sandboxed iframes still pop out
        document.addEventListener('click', function(e){
          try {
            const a = e.target && e.target.closest && e.target.closest('a');
            if (a && a.href) {
              window.open(a.href, '_blank');
              e.preventDefault();
            }
          } catch (err) { /* ignore */ }
        }, true);

        // Watch for new anchors added later (images, rewritten HTML, etc.)
        const mo = new MutationObserver(() => setAttrs(document.querySelectorAll('a')));
        mo.observe(document.body, { childList: true, subtree: true });
      } catch (e) { /* ignore */ }
    })();
  </script>
  ${resizeScript}
</body>
</html>`
  }, [html, darkMode, darkReader])

  // Allow scripts so the injected resize script can run. Keep same-origin only when darkReader needs it.
  const sandboxAttr = darkReader ? 'allow-forms allow-popups allow-popups-to-escape-sandbox allow-scripts allow-same-origin' : 'allow-forms allow-popups allow-popups-to-escape-sandbox allow-scripts'

  useEffect(() => {
    const handler = (ev: MessageEvent) => {
      try {
        const data = ev.data || {};
        console.log('message iframe parent received', data && data.type, data && data.height)
        if (data && data.type === 'signalbox.messageHeight' && data.id === id && typeof data.height === 'number') {
          // if iframeRef is set, ensure the event came from it
          setHeight(data.height)
        }
      } catch (e) { /* ignore */ }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [id])

  return (
    <iframe
      ref={iframeRef}
      title="message-view"
      srcDoc={doc}
      sandbox={sandboxAttr}
      style={{ width: '100%', height: height ? `${height}px` : '400px', minHeight: 0, border: 0, display: 'block' }}
    />
  )
}
