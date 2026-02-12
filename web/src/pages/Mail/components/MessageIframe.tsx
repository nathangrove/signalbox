import React, { useMemo } from 'react'
import DOMPurify from 'dompurify'

type Props = {
  html: string
  darkMode?: boolean
  darkReader?: boolean
}

export default function MessageIframe({ html, darkMode, darkReader }: Props) {
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
<body>${clean}</body>
</html>`
  }, [html, darkMode, darkReader])

  const sandboxAttr = darkReader ? 'allow-forms allow-popups allow-popups-to-escape-sandbox allow-scripts allow-same-origin' : 'allow-forms allow-popups allow-popups-to-escape-sandbox'

  return (
    <iframe
      title="message-view"
      srcDoc={doc}
      sandbox={sandboxAttr}
      style={{ width: '100%', height: '100%', minHeight: 0, border: 0, display: 'block' }}
    />
  )
}
