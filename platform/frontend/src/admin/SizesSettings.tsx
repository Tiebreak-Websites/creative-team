import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Check,
  ChevronDown,
  GripVertical,
  Layers,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  getSizeConfig,
  saveSizeConfig,
  type SizeBundle,
  type SizeConfig,
  type SizeGroup,
} from '../bannerBuilder/sizesApi'

/** Client-side gate for a WxH token; the server re-validates (bounds + aspect). */
const SIZE_TOKEN = /^\d{2,4}x\d{2,4}$/

function normalizeToken(text: string): string {
  return (text || '').trim().toLowerCase().replace(/[×*]/g, 'x').replace(/\s+/g, '')
}

/**
 * Sizes & bundles manager (admin Settings surface). Admins organize the size
 * groups shown in the Banner Builder rail AND the add-sizes picker: create /
 * rename / delete groups, reorder them (order = position), add or remove sizes
 * (any sane WxH — customs included), and build one-click size bundles. The
 * special "Custom sizes" group collects user-added sizes and can't be deleted.
 */
export function SizesSettings() {
  const [config, setConfig] = useState<SizeConfig | null>(null)
  const [groups, setGroups] = useState<SizeGroup[]>([])
  const [bundles, setBundles] = useState<SizeBundle[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)

  async function refresh() {
    setError(null)
    setLoading(true)
    try {
      const cfg = await getSizeConfig()
      setConfig(cfg)
      setGroups(cfg.groups.map((g) => ({ ...g, sizes: [...g.sizes] })))
      setBundles(cfg.bundles.map((b) => ({ ...b, sizes: [...b.sizes] })))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const customGroupId = config?.custom_group_id ?? 'custom'
  const snap = (gs: { id: string; label: string; sizes: string[] }[]) =>
    JSON.stringify(gs.map((g) => ({ id: g.id, label: g.label, sizes: g.sizes })))
  const dirty = useMemo(() => {
    if (!config) return false
    return snap(groups) !== snap(config.groups) || snap(bundles) !== snap(config.bundles)
  }, [groups, bundles, config])

  const savingRef = useRef(false)
  async function save(current?: { groups: SizeGroup[]; bundles: SizeBundle[] }) {
    if (savingRef.current) return
    const payload = current ?? { groups, bundles }
    savingRef.current = true
    setSaving(true)
    setError(null)
    try {
      const cfg = await saveSizeConfig(payload)
      setConfig(cfg)
      // Apply the server's normalized shape ONLY if the admin hasn't kept
      // editing during the round-trip — otherwise a response landing mid-typing
      // would eat keystrokes; the next auto-save picks the newer edits up.
      setGroups((cur) => {
        if (snap(cur) !== snap(payload.groups)) return cur
        return cfg.groups.map((g) => ({ ...g, sizes: [...g.sizes] }))
      })
      setBundles((cur) => {
        if (snap(cur) !== snap(payload.bundles)) return cur
        return cfg.bundles.map((b) => ({ ...b, sizes: [...b.sizes] }))
      })
      setSavedFlash(true)
      window.setTimeout(() => setSavedFlash(false), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  // AUTO-SAVE: every change persists on its own (debounced) — a reorder click
  // or a removed size should never be lost because "Save" wasn't pressed.
  useEffect(() => {
    if (!config || loading || !dirty) return
    const t = window.setTimeout(() => {
      void save({ groups, bundles })
    }, 900)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, bundles, config, loading, dirty])

  // ---- ops (position = list order; reordering is drag & drop) ----
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [drag, setDrag] = useState<{ list: 'groups' | 'bundles'; index: number } | null>(null)
  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function dropOn(list: 'groups' | 'bundles', index: number) {
    if (!drag || drag.list !== list || drag.index === index) {
      setDrag(null)
      return
    }
    const move = <T,>(prev: T[]): T[] => {
      const next = [...prev]
      const [item] = next.splice(drag.index, 1)
      next.splice(index, 0, item)
      return next
    }
    if (list === 'groups') setGroups(move)
    else setBundles(move)
    setDrag(null)
  }

  function patchGroup(id: string, patch: Partial<SizeGroup>) {
    setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, ...patch } : g)))
  }
  function removeGroup(id: string) {
    setGroups((prev) => prev.filter((g) => g.id !== id))
  }
  function addGroup() {
    const id = `new-${Date.now().toString(36)}`
    setGroups((prev) => [...prev, { id, label: 'New group', sizes: [] }])
    setExpanded((prev) => new Set(prev).add(id))
  }

  function patchBundle(id: string, patch: Partial<SizeBundle>) {
    setBundles((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)))
  }
  function addBundle() {
    const id = `new-${Date.now().toString(36)}`
    setBundles((prev) => [...prev, { id, label: 'New bundle', sizes: [] }])
    setExpanded((prev) => new Set(prev).add(id))
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-base font-semibold text-foreground">Sizes &amp; bundles</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The size groups everyone sees in the Banner Builder (both the left rail and the
            “Add sizes” picker), in this exact order. Any WxH works — new sizes are validated and
            registered automatically. “Custom sizes” collects user-added sizes and can’t be deleted.
            Changes save automatically.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            role="status"
            aria-live="polite"
            className={cn(
              'inline-flex items-center gap-1.5 text-xs font-medium',
              saving || dirty ? 'text-muted-foreground' : 'text-emerald-600 dark:text-emerald-400',
            )}
          >
            {saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
              </>
            ) : dirty ? (
              'Unsaved changes…'
            ) : savedFlash ? (
              <>
                <Check className="h-3.5 w-3.5" /> Saved
              </>
            ) : config ? (
              <>
                <Check className="h-3.5 w-3.5" /> All changes saved
              </>
            ) : null}
          </span>
          <Button size="sm" onClick={() => void save()} disabled={!dirty || saving || loading}>
            Save now
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void refresh()}
            disabled={loading}
            title="Reload (discards unsaved changes)"
            aria-label="Reload size groups"
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {config?.persisted === false && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>
            Changes are live, but the server could NOT write them to disk — they may be lost on a
            restart. Check the server logs (sizes-config).
          </span>
        </div>
      )}

      {loading ? (
        <div className="mt-5 flex items-center gap-2 rounded-xl border border-border bg-secondary/40 px-4 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading size groups…
        </div>
      ) : (
        <>
          <div className="mt-5 space-y-1.5">
            {groups.map((g, i) => (
              <CollectionRow
                key={g.id}
                index={i}
                label={g.label}
                sizes={g.sizes}
                locked={g.id === customGroupId}
                lockedHint="Collects user-added custom sizes — rename/delete disabled"
                expanded={expanded.has(g.id)}
                onToggleExpand={() => toggleExpanded(g.id)}
                onLabel={(label) => patchGroup(g.id, { label })}
                onSizes={(sizes) => patchGroup(g.id, { sizes })}
                onRemove={() => removeGroup(g.id)}
                dragging={drag?.list === 'groups' && drag.index === i}
                onDragStart={() => setDrag({ list: 'groups', index: i })}
                onDrop={() => dropOn('groups', i)}
                onDragEnd={() => setDrag(null)}
              />
            ))}
            <Button variant="outline" size="sm" className="w-full border-dashed" onClick={addGroup}>
              <Plus className="h-4 w-4" /> Add group
            </Button>
          </div>

          <div className="mt-6">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              <h3 className="font-display text-sm font-semibold text-foreground">Bundles</h3>
              <span className="text-xs text-muted-foreground">
                one-click size sets shown above the groups
              </span>
            </div>
            <div className="mt-2 space-y-1.5">
              {bundles.map((b, i) => (
                <CollectionRow
                  key={b.id}
                  index={i}
                  label={b.label}
                  sizes={b.sizes}
                  expanded={expanded.has(b.id)}
                  onToggleExpand={() => toggleExpanded(b.id)}
                  onLabel={(label) => patchBundle(b.id, { label })}
                  onSizes={(sizes) => patchBundle(b.id, { sizes })}
                  onRemove={() => setBundles((prev) => prev.filter((x) => x.id !== b.id))}
                  dragging={drag?.list === 'bundles' && drag.index === i}
                  onDragStart={() => setDrag({ list: 'bundles', index: i })}
                  onDrop={() => dropOn('bundles', i)}
                  onDragEnd={() => setDrag(null)}
                />
              ))}
              <Button variant="outline" size="sm" className="w-full border-dashed" onClick={addBundle}>
                <Plus className="h-4 w-4" /> Add bundle
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/** One group/bundle as a COMPACT, collapsible row: drag handle + numbered slot
 * + inline name + size count. Expanding reveals the size chips + add input.
 * Reorder by dragging a row onto another. */
function CollectionRow({
  index,
  label,
  sizes,
  locked,
  lockedHint,
  expanded,
  onToggleExpand,
  onLabel,
  onSizes,
  onRemove,
  dragging,
  onDragStart,
  onDrop,
  onDragEnd,
}: {
  index: number
  label: string
  sizes: string[]
  locked?: boolean
  lockedHint?: string
  expanded: boolean
  onToggleExpand: () => void
  onLabel: (label: string) => void
  onSizes: (sizes: string[]) => void
  onRemove: () => void
  dragging: boolean
  onDragStart: () => void
  onDrop: () => void
  onDragEnd: () => void
}) {
  const [newSize, setNewSize] = useState('')
  const [sizeError, setSizeError] = useState(false)

  function addSize() {
    const norm = normalizeToken(newSize)
    if (!SIZE_TOKEN.test(norm)) {
      setSizeError(true)
      return
    }
    setSizeError(false)
    if (!sizes.includes(norm)) onSizes([...sizes, norm])
    setNewSize('')
  }

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={cn(
        'overflow-hidden rounded-lg border border-border bg-secondary/30 transition-opacity',
        dragging && 'opacity-50 ring-2 ring-primary/40',
      )}
    >
      <div className="flex h-9 items-center gap-2 px-2">
        <span className="cursor-grab text-muted-foreground active:cursor-grabbing" title="Drag to reorder">
          <GripVertical className="h-4 w-4" />
        </span>
        {/* numbered slot — the saved position */}
        <span className="inline-flex h-5 w-6 shrink-0 items-center justify-center rounded bg-primary/15 font-display text-[11px] font-bold tabular-nums text-primary">
          {index + 1}
        </span>
        {locked ? (
          <span
            title={lockedHint}
            className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-sm font-medium text-foreground"
          >
            <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> {label}
          </span>
        ) : (
          <input
            value={label}
            onChange={(e) => onLabel(e.target.value)}
            aria-label="Group name"
            className="h-7 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 text-sm font-medium text-foreground transition-colors hover:border-input focus-visible:border-primary focus-visible:bg-background focus-visible:outline-none"
          />
        )}
        <button
          type="button"
          onClick={onToggleExpand}
          title={expanded ? 'Collapse' : 'Edit sizes'}
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label}`}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          {sizes.length} size{sizes.length === 1 ? '' : 's'}
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} />
        </button>
        {!locked && (
          <button
            type="button"
            onClick={onRemove}
            title={`Delete “${label}”`}
            aria-label={`Delete ${label}`}
            className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {expanded && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border bg-card/40 px-2.5 py-2">
          {sizes.map((s) => (
            <span
              key={s}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 font-display text-[12px] font-semibold text-foreground"
            >
              {s}
              <button
                type="button"
                onClick={() => onSizes(sizes.filter((x) => x !== s))}
                title={`Remove ${s}`}
                aria-label={`Remove size ${s}`}
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {sizes.length === 0 && (
            <span className="px-1 text-xs text-muted-foreground">No sizes yet.</span>
          )}
          <span className="inline-flex items-center gap-1">
            <input
              value={newSize}
              onChange={(e) => {
                setNewSize(e.target.value)
                if (sizeError) setSizeError(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addSize()
                }
              }}
              aria-label={`Add a size to ${label}`}
              placeholder="e.g. 500x500"
              className={cn(
                'h-7 w-28 rounded-md border bg-secondary px-2 text-xs text-foreground transition-colors placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/20',
                sizeError ? 'border-destructive' : 'border-input hover:border-foreground/25',
              )}
            />
            <button
              type="button"
              onClick={addSize}
              disabled={!newSize.trim()}
              title="Add this size"
              aria-label={`Add size to ${label}`}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-secondary text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </span>
          {sizeError && (
            <span className="text-[11px] text-destructive">Use width x height, e.g. 500x500.</span>
          )}
        </div>
      )}
    </div>
  )
}
