import { useEffect, useState } from 'react'

/** Live dark-mode flag — observes the <html> class the theme toggle flips
 * (useTheme is per-component state, so watching the DOM is the one source of
 * truth every logo rendering can share). */
export function useIsDark(): boolean {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    const el = document.documentElement
    const mo = new MutationObserver(() => setDark(el.classList.contains('dark')))
    mo.observe(el, { attributes: true, attributeFilter: ['class'] })
    return () => mo.disconnect()
  }, [])
  return dark
}

/** The dark LETTER fills used by brand wordmarks (BrainTrade navy/gray and
 * common near-blacks) — swapped to white in dark mode; waves/accents keep
 * their colors. */
const DARK_LETTER_FILLS = /#(060751|070851|63637F|0B1220|000000|111111)\b/gi

/** Brand logo (inline SVG string or a URL) → an <img> src. In dark mode the
 * dark letter colors are swapped to white so wordmarks stay readable on the
 * app's dark surfaces. */
export function brandLogoUri(svg?: string | null, dark?: boolean): string {
  let raw = (svg || '').trim()
  if (!raw) return ''
  if (!raw.startsWith('<svg')) return raw
  if (dark) raw = raw.replace(DARK_LETTER_FILLS, '#FFFFFF')
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(raw)
}

/** The right logo for the current theme: an explicit dark-theme logo wins;
 * otherwise the light logo gets its letters recolored as a fallback. */
export function brandLogoSrc(
  brand:
    | { logo_svg?: string | null; logo_svg_dark?: string | null; icon_svg?: string | null }
    | null
    | undefined,
  dark: boolean,
): string {
  if (!brand) return ''
  if (dark && brand.logo_svg_dark) return brandLogoUri(brand.logo_svg_dark, false)
  // Fall back to the square mark. Only a handful of entities actually have a
  // wordmark — most carry only icon_svg — and returning '' here put an <img
  // src=""> on screen, which renders as a broken-image icon next to the brand
  // name. A square mark is a worse lockup than a wordmark and a much better
  // one than a broken image.
  return brandLogoUri(brand.logo_svg, dark) || brandLogoUri(brand.icon_svg, dark)
}
