/**
 * Internovus wordmark, theme-aware: the black logo shows in light mode, the
 * white logo in dark mode (toggled by the `.dark` class via Tailwind, no JS).
 * Pass sizing via `className` (e.g. "h-7 w-auto").
 */
export function Logo({ className }: { className?: string }) {
  const cls = className ?? 'h-7 w-auto'
  return (
    <>
      <img src="/internovus-black.svg" alt="Internovus" className={`${cls} block dark:hidden`} />
      <img src="/internovus-white.svg" alt="Internovus" aria-hidden className={`${cls} hidden dark:block`} />
    </>
  )
}
