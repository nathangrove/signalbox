let originalHref: string | null = null

export async function fillFavicon() {
  try {
    if (typeof document === 'undefined') return
    const head = document.head || document.getElementsByTagName('head')[0]
    let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement | null
    if (!link) {
      link = document.createElement('link')
      link.rel = 'icon'
      head.appendChild(link)
    }
    if (!originalHref) originalHref = link.href || '/icons/icon-192.svg'

    const size = 64
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1

    const baseImage = new Image()
    baseImage.crossOrigin = 'anonymous'
    baseImage.src = originalHref || '/icons/icon-192.svg'
    await new Promise<void>(res => { baseImage.onload = () => res(); baseImage.onerror = () => res(); })

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(size * dpr)
    canvas.height = Math.round(size * dpr)
    canvas.style.width = `${size}px`
    canvas.style.height = `${size}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    if (dpr !== 1) ctx.scale(dpr, dpr)

    // draw cover-style so the logo fills the square
    try {
      ctx.clearRect(0, 0, size, size)
      // zoom slightly more to fill
      const pad = Math.round(size * 0.02)
      ctx.drawImage(baseImage as HTMLImageElement, -pad, -pad, size + pad * 2, size + pad * 2)
    } catch (e) {
      ctx.fillStyle = '#4F46E5'
      ctx.fillRect(0, 0, size, size)
    }

    const url = canvas.toDataURL('image/png')
    link.href = url
  } catch (_) {}
}

export function restoreFavicon() {
  try {
    if (typeof document === 'undefined') return
    const link = document.querySelector("link[rel~='icon']") as HTMLLinkElement | null
    if (link && originalHref) link.href = originalHref
  } catch (_) {}
}
