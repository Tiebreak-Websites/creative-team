// Admin › Users — the CreativeOPS access model, on the builder's own
// Supabase project.
//
// The flow: Microsoft SSO first-login lands a person as viewer + PENDING;
// they wait at a gate until an admin acts here — grant access, set a role,
// optionally narrow which app surfaces they see. Role truth is the users
// table; everything in this panel edits that table and nothing else.

import { useEffect, useMemo, useState } from 'react'
import { Check, Loader2, ShieldAlert, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Toggle } from '@/components/Toggle'
import { API_BASE, asJson } from '../http'

interface Row {
  id: string
  email: string | null
  name: string | null
  role: 'viewer' | 'user' | 'copywriter' | 'admin'
  access_status: 'pending' | 'active'
  active: boolean
  sections: string[] | null
  created_at: string
}

const SECTION_LABEL: Record<string, string> = {
  banners: 'Banners',
  lps: 'Landing Pages',
  emails: 'CRM Emails',
  settings: 'Settings',
}

export function UsersSettings() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [sections, setSections] = useState<string[]>([])
  const [roles, setRoles] = useState<string[]>([])
  const [dormant, setDormant] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = () =>
    fetch(`${API_BASE}/admin/users`, { credentials: 'include' })
      .then(async (r) => {
        if (r.status === 424) {
          setDormant(true)
          setRows([])
          return
        }
        if (!r.ok) throw new Error((await asJson(r)).detail || `HTTP ${r.status}`)
        const d = await r.json()
        setRows(d.users)
        setSections(d.sections)
        setRoles(d.roles)
      })
      .catch((e) => setError(e.message))

  useEffect(() => { load() }, [])

  const patch = (id: string, body: Record<string, unknown>) => {
    setBusy(id)
    fetch(`${API_BASE}/admin/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error((await asJson(r)).detail || 'Could not save')
        const updated: Row = await r.json()
        setRows((cur) => (cur ?? []).map((u) => (u.id === id ? updated : u)))
      })
      .catch((e) => setError(typeof e.message === 'string' ? e.message : 'Could not save'))
      .finally(() => setBusy(null))
  }

  const pending = useMemo(() => (rows ?? []).filter((r) => r.access_status === 'pending'), [rows])
  const granted = useMemo(() => (rows ?? []).filter((r) => r.access_status !== 'pending'), [rows])

  if (rows === null) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    )
  }

  if (dormant) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-10 text-center">
        <UserRound className="mx-auto h-7 w-7 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">User management activates with Microsoft sign-in</p>
        <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
          This panel manages the Supabase users table — who may enter, their role, and
          which parts of the builder they see. It comes alive when the SUPABASE keys are
          configured; the first Microsoft sign-ins will then appear here as pending
          requests for you to approve.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {error && (
        <p className="flex items-start gap-1.5 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}

      {pending.length > 0 && (
        <section className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4">
          <h2 className="font-display text-sm font-bold">
            Awaiting access <span className="tabular-nums">({pending.length})</span>
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Signed in with Microsoft and waiting at the gate.
          </p>
          <div className="mt-3 space-y-2">
            {pending.map((u) => (
              <div key={u.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{u.name || u.email}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{u.email}</span>
                </span>
                <Button
                  size="sm"
                  disabled={busy === u.id}
                  onClick={() => patch(u.id, { access_status: 'active', role: 'user' })}
                >
                  {busy === u.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Grant access
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="font-display text-base font-bold">Users</h2>
        <p className="mb-3 mt-0.5 text-xs text-muted-foreground">
          Role decides what someone can do; sections decide what they see — leave
          sections on “role defaults” unless a person needs a narrower view.
        </p>

        {granted.length === 0 ? (
          <p className="p-6 text-center text-xs text-muted-foreground">
            Nobody yet — users appear after their first Microsoft sign-in.
          </p>
        ) : (
          <div className="space-y-2">
            {granted.map((u) => {
              const custom = u.sections !== null
              return (
                <div key={u.id} className="rounded-xl border border-border px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{u.name || u.email}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">{u.email}</span>
                    </span>
                    <select
                      value={u.role}
                      disabled={busy === u.id}
                      onChange={(e) => patch(u.id, { role: e.target.value })}
                      className="h-8 rounded-lg border border-border bg-card px-2 text-xs"
                      aria-label={`Role for ${u.email}`}
                    >
                      {roles.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <span className="flex items-center gap-1.5">
                      <Toggle
                        on={u.active}
                        label={u.active ? `Deactivate ${u.email}` : `Activate ${u.email}`}
                        onChange={(next) => patch(u.id, { active: next })}
                      />
                      <span className="w-12 text-[11px] text-muted-foreground">
                        {u.active ? 'Active' : 'Off'}
                      </span>
                    </span>
                    {busy === u.id && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                      Sections
                    </span>
                    {sections.map((s) => {
                      const onNow = custom ? (u.sections ?? []).includes(s) : true
                      return (
                        <button
                          key={s}
                          type="button"
                          disabled={busy === u.id}
                          title={custom ? undefined : 'Role defaults — click to customise'}
                          onClick={() => {
                            const base = custom ? (u.sections ?? []) : sections
                            const next = onNow ? base.filter((x) => x !== s) : [...base, s]
                            patch(u.id, { sections: next })
                          }}
                          className={cn(
                            'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                            onNow
                              ? custom
                                ? 'border-primary bg-primary/10 text-foreground'
                                : 'border-border bg-secondary text-muted-foreground'
                              : 'border-border text-muted-foreground/50 hover:border-primary/40',
                          )}
                        >
                          {SECTION_LABEL[s] ?? s}
                        </button>
                      )
                    })}
                    {custom ? (
                      <button
                        type="button"
                        className="text-[10px] text-primary underline-offset-2 hover:underline"
                        onClick={() => patch(u.id, { clear_sections: true })}
                      >
                        reset to role defaults
                      </button>
                    ) : (
                      <span className="text-[10px] italic text-muted-foreground">role defaults</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
