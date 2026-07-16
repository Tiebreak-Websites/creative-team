import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Loader2, MessageSquarePlus, Send, X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Floating suggestions / bug-report widget, available on every tool.
 *
 * Users write ideas into their own thread and see an "Implemented" tick appear
 * on a message once it ships. Admins see everyone's threads grouped by author
 * and flip the checkmark that produces that tick.
 */
interface FeedbackMsg {
  id: string
  email: string
  text: string
  created_at: string
  status: 'open' | 'done'
  done_at: string | null
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, {
    credentials: 'include',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  })
  if (!r.ok) {
    const body = await r.json().catch(() => ({}))
    throw new Error((body as { detail?: string }).detail || `HTTP ${r.status}`)
  }
  return r.json()
}

function when(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString('en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

export function FeedbackWidget() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<FeedbackMsg[]>([])
  const [admin, setAdmin] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async () => {
    try {
      const d = await api<{ messages: FeedbackMsg[]; admin: boolean }>('/api/feedback')
      setMessages(d.messages)
      setAdmin(d.admin)
      setErr('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [])

  // Load on open + keep fresh while open (status ticks appear live).
  useEffect(() => {
    if (!open) return
    void refresh()
    const iv = window.setInterval(() => void refresh(), 30_000)
    return () => window.clearInterval(iv)
  }, [open, refresh])
  useEffect(() => {
    // new content → keep the newest message in view
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, open])

  async function send() {
    const t = text.trim()
    if (!t || busy) return
    setBusy(true)
    try {
      const m = await api<FeedbackMsg>('/api/feedback', { method: 'POST', body: JSON.stringify({ text: t }) })
      setMessages((ms) => [...ms, m])
      setText('')
      setErr('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function toggleDone(m: FeedbackMsg) {
    try {
      const upd = await api<FeedbackMsg>(`/api/feedback/${m.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: m.status === 'done' ? 'open' : 'done' }),
      })
      setMessages((ms) => ms.map((x) => (x.id === upd.id ? upd : x)))
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  // Admin: group by author so each user's thread reads together.
  const groups = admin
    ? [...new Set(messages.map((m) => m.email))].map((email) => ({
        email,
        msgs: messages.filter((m) => m.email === email),
      }))
    : null

  const bubble = (m: FeedbackMsg) => (
    <div key={m.id} className="rounded-xl border border-border bg-secondary/40 px-2.5 py-2">
      <p className="whitespace-pre-wrap break-words text-xs leading-snug">{m.text}</p>
      <div className="mt-1 flex items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground">{when(m.created_at)}</span>
        {m.status === 'done' && (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
            <Check className="h-3 w-3" /> Implemented
          </span>
        )}
        {admin && (
          <button
            type="button"
            onClick={() => void toggleDone(m)}
            aria-pressed={m.status === 'done'}
            title={m.status === 'done' ? 'Mark as not implemented' : 'Mark as implemented — the author sees the tick'}
            className={cn(
              'ml-auto grid h-5 w-5 place-items-center rounded-md border transition-colors',
              m.status === 'done'
                ? 'border-emerald-500 bg-emerald-500 text-white'
                : 'border-border text-muted-foreground hover:border-emerald-500 hover:text-emerald-500',
            )}
          >
            <Check className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  )

  return (
    <>
      {open && (
        <div className="fixed bottom-20 right-4 z-[90] flex max-h-[min(34rem,calc(100vh-7rem))] w-80 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl animate-fade-up">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
            <MessageSquarePlus className="h-4 w-4 text-primary" />
            <span className="min-w-0 flex-1 truncate font-display text-sm font-semibold">
              {admin ? 'Suggestions — all users' : 'Suggestions & bug reports'}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close feedback"
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {messages.length === 0 && !err && (
              <p className="px-2 py-6 text-center text-[11px] leading-relaxed text-muted-foreground">
                Tell us what to build or fix — every idea lands with the team, and you'll see an{' '}
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">Implemented ✓</span> tick here
                once it ships.
              </p>
            )}
            {groups
              ? groups.map((g) => (
                  <div key={g.email} className="space-y-1.5">
                    <p className="px-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {g.email}
                    </p>
                    {g.msgs.map(bubble)}
                  </div>
                ))
              : messages.map(bubble)}
            {err && <p className="px-1 text-[10px] text-destructive">{err}</p>}
          </div>

          <div className="border-t border-border p-2">
            <div className="flex items-end gap-1.5">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void send()
                  }
                }}
                rows={2}
                placeholder="Suggest a feature, report a bug… (Enter sends)"
                aria-label="Feedback message"
                className="min-h-0 w-full resize-none rounded-lg border border-input bg-background px-2 py-1.5 text-xs focus-visible:border-primary focus-visible:outline-none"
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={busy || !text.trim()}
                title="Send"
                aria-label="Send feedback"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm transition-opacity disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={open ? 'Close suggestions' : 'Suggestions & bug reports'}
        aria-label={open ? 'Close suggestions' : 'Open suggestions and bug reports'}
        aria-expanded={open}
        className={cn(
          'fixed bottom-4 right-4 z-[90] grid h-11 w-11 place-items-center rounded-full shadow-lg transition-all',
          open
            ? 'border border-border bg-card text-foreground hover:bg-secondary'
            : 'bg-primary text-primary-foreground hover:brightness-110',
        )}
      >
        {open ? <X className="h-5 w-5" /> : <MessageSquarePlus className="h-5 w-5" />}
      </button>
    </>
  )
}
