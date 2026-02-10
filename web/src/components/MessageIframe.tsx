import React, { useMemo } from 'react'

type Props = {
  html: string
}

export default function MessageIframe({ html }: Props) {
  const doc = useMemo(() => {
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
  </style>
</head>
<body>${html}</body>
</html>`
  }, [html])

  return (
    <iframe
      title="message-view"
      srcDoc={doc}
      sandbox="allow-forms allow-popups allow-popups-to-escape-sandbox"
      style={{ width: '100%', height: '100%', minHeight: 0, border: 0, display: 'block' }}
    />
  )
}
