/**
 * Header chip: app version + when this build was made (shown in the viewer's
 * local time). Values are injected at build time (see vite.config.ts `define`).
 */
export function VersionBadge() {
  let built = ''
  try {
    const d = new Date(__APP_BUILD_TIME__)
    const day = d.getDate()
    const month = d.toLocaleString('en-US', { month: 'long' })
    const time = d.toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
    built = `${day} ${month}, ${time}` // e.g. "24 June, 11:40 AM"
  } catch {
    /* ignore */
  }
  return (
    <span
      className="hidden items-center gap-1.5 rounded-full border border-border px-2.5 py-1 font-mono text-[11px] leading-none text-muted-foreground lg:inline-flex"
      title={`Internovus - Creative Builder v${__APP_VERSION__} · updated ${built}`}
    >
      <span className="font-semibold text-foreground/80">v{__APP_VERSION__}</span>
      <span className="text-muted-foreground/50">·</span>
      <span>{built}</span>
    </span>
  )
}
