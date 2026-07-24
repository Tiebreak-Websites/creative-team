// The Ready-for-Design strip — ONE component for the Banner and LP builders.
//
// Same reasoning as FolderGrid: the two builders must show the same Monday
// queue the same way (Mine/All scope, priority-tinted chips, owners), and two
// copies of a strip drift apart. Data comes from the shared backend builder
// (creative_queue.build_queue); this renders whatever slice a builder fetched.

import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { QueueResult, QueueTask } from '@/bannerBuilder/campaignApi'

/**
 * Fetch + keep fresh one builder's Ready-for-Design queue.
 *
 * The strip must track the BOARD, not the page load: a designer edits the
 * Banner Sizes column on Monday and clicks the chip seconds later, so a
 * mount-only fetch serves stale sizes. Refetches on scope change, on window
 * focus (the "came back from Monday" moment) and on a slow interval.
 * `deps` forces extra refetches (e.g. the LP builder passes its project count
 * — a created project removes its task from the queue server-side).
 */
export function useReadyQueue(
  fetcher: (scope: 'mine' | 'all') => Promise<QueueResult>,
  deps: unknown[] = [],
) {
  const [tasks, setTasks] = useState<QueueTask[]>([])
  const [scope, setScope] = useState<'mine' | 'all'>('mine')
  const [meta, setMeta] = useState<{ linked: boolean; mineCount: number; allCount: number }>(
    { linked: false, mineCount: 0, allCount: 0 })
  useEffect(() => {
    let alive = true
    const load = () => fetcher(scope).then((d) => {
      if (!alive) return
      setTasks(d.tasks)
      setMeta({ linked: d.linked, mineCount: d.mineCount, allCount: d.allCount })
      // The server downgrades "mine" to "all" for an unlinked user — mirror it.
      if (d.scope !== scope) setScope(d.scope)
    })
    load()
    const iv = window.setInterval(load, 60_000)
    window.addEventListener('focus', load)
    return () => {
      alive = false
      window.clearInterval(iv)
      window.removeEventListener('focus', load)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetcher is a stable module fn; deps is the caller's refresh key
  }, [scope, ...deps])
  return { tasks, scope, setScope, meta }
}

export function ReadyQueueStrip({
  tasks,
  scope,
  linked,
  mineCount,
  allCount,
  onScopeChange,
  onOpen,
  leading,
  className,
  label = 'Ready for design',
}: {
  tasks: QueueTask[]
  scope: 'mine' | 'all'
  /** Whether this account is linked to a Monday person (Admin › Users). */
  linked: boolean
  mineCount: number
  allCount: number
  onScopeChange: (s: 'mine' | 'all') => void
  onOpen: (t: QueueTask) => void
  /** Optional extra chip after the toggle — e.g. the banner "Building for…". */
  leading?: ReactNode
  /** Container chrome — defaults to the full-bleed bar (border-b). The LP
   *  shelf passes rounded-card classes instead. */
  className?: string
  /** Strip title — defaults to "Ready for design"; the CRM builder passes
   *  "Ready for Builder". */
  label?: string
}) {
  return (
    <div className={cn('shrink-0 bg-primary/[0.03] px-4 py-2', className ?? 'border-b border-border')}>
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {/* Mine / All scope — a toggle only when this account is linked to a
            Monday person; otherwise a nudge to set the link in Admin. */}
        {linked ? (
          <div className="flex shrink-0 overflow-hidden rounded-lg border border-border text-[11px]">
            {(['mine', 'all'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onScopeChange(s)}
                className={cn('px-2 py-0.5 transition-colors',
                  scope === s ? 'bg-primary text-primary-foreground'
                              : 'text-muted-foreground hover:bg-secondary')}
              >
                {s === 'mine' ? `Mine (${mineCount})` : `All (${allCount})`}
              </button>
            ))}
          </div>
        ) : (
          <span className="shrink-0 text-[10px] italic text-muted-foreground">
            everyone’s — link your Monday user in Admin to filter
          </span>
        )}
        {leading}
        <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
          {tasks.length === 0 ? (
            <span className="shrink-0 self-center text-[11px] text-muted-foreground">
              None assigned to you —{' '}
              <button type="button" onClick={() => onScopeChange('all')}
                      className="underline underline-offset-2 hover:text-foreground">see all {allCount}</button>.
            </span>
          ) : tasks.map((t) => {
            // Tint the chip by the task's Monday Priority colour (dot +
            // matching border, with a faint fill); plain border when unset.
            const pc = t.item.priority_color
            return (
              <button
                key={t.item.id}
                type="button"
                onClick={() => onOpen(t)}
                title={`${t.item.name} — open pre-filled${t.item.priority ? ` · ${t.item.priority}` : ''}${t.item.owner ? ` · ${t.item.owner}` : ''}`}
                style={pc ? { borderColor: pc, backgroundColor: `${pc}1f` } : undefined}
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-left transition-opacity hover:opacity-80"
              >
                {pc && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: pc }} title={t.item.priority} />}
                <span className="flex min-w-0 flex-col">
                  <span className="max-w-[180px] truncate text-xs font-medium">{t.item.name}</span>
                  {scope === 'all' && t.item.owner && (
                    <span className="max-w-[180px] truncate text-[9px] text-muted-foreground">{t.item.owner}</span>
                  )}
                </span>
                <span className="shrink-0 rounded-full border border-border bg-secondary px-1.5 py-px text-[9px] uppercase text-muted-foreground">
                  {t.match.asset_type}
                </span>
                {t.match.sizes.length > 0 && (
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {t.match.sizes.length} size{t.match.sizes.length === 1 ? '' : 's'}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
