/**
 * Header chip: app version + when this build was made (shown in the viewer's
 * local time). Values are injected at build time (see vite.config.ts `define`).
 */
export function VersionBadge() {
  let built = ''
  try {
    built = new Date(__APP_BUILD_TIME__).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
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
