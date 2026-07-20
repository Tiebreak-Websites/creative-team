import { type ComponentType } from 'react'
import { ArrowRight } from 'lucide-react'
import { useIsDark } from '@/lib/brandLogo'
import { formatUserName } from '@/lib/utils'
import { useAuth } from '../auth/AuthContext'

/** One builder offered on the home screen. Fed from the PRODUCTS registry in
 * App.tsx so the home screen can never drift out of sync with the nav. */
export interface HomeOption {
  id: string
  label: string
  blurb: string
  icon: ComponentType<{ className?: string }>
  /** Card accent — mixed toward an opaque base so it reads in both themes. */
  accent: string
  /** No working tool yet: the card is still reachable, just marked. */
  soon?: boolean
}

/** Local part of the day, so the greeting isn't jarring at 9pm. */
function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Working late'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

/**
 * The workspace landing screen. Rather than dropping everyone into the Banner
 * Builder, this asks what they want to make and lets the three builders
 * introduce themselves — which is also how the Email Builder becomes
 * discoverable before it ships.
 */
export function Home({
  options,
  onPick,
}: {
  options: HomeOption[]
  onPick: (id: string) => void
}) {
  const { user } = useAuth()
  const dark = useIsDark()
  const name = formatUserName(user?.email)

  return (
    <div className="h-full overflow-y-auto">
      {/* Upper third rather than dead-centre: the content block is short, and
          true centring on a tall screen leaves more space above it than the
          block itself, which reads as misaligned instead of deliberate. */}
      <div className="mx-auto flex min-h-full max-w-5xl flex-col px-6 pb-14 pt-[10vh]">
        <header className="animate-fade-up">
          {name && (
            <p className="font-display text-sm font-medium text-muted-foreground">
              {greeting()}, {name}
            </p>
          )}
          <h1 className="mt-1.5 font-display text-3xl font-bold tracking-tight sm:text-4xl">
            What do you want to create?
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Pick a builder to get started — you can switch between them any time from the bar above.
          </p>
        </header>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {options.map((o, i) => {
            // Opaque base: a translucent tint composites over the dark card into
            // a washed-out grey and takes the label contrast with it.
            const base = dark ? '#101013' : '#FFFFFF'
            const wash = `color-mix(in srgb, ${o.accent} ${dark ? 16 : 10}%, ${base})`
            const chip = `color-mix(in srgb, ${o.accent} ${dark ? 30 : 16}%, ${base})`
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => onPick(o.id)}
                // Without this the accessible name is the whole card — title,
                // blurb and CTA run together.
                aria-label={`Open ${o.label}`}
                title={`Open ${o.label}`}
                className="group animate-fade-up relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card p-5 text-left shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{ animationDelay: `${80 + i * 70}ms`, backgroundColor: wash }}
              >
                {/* Colour lives on the wrapper — lucide icons stroke with
                    currentColor, and the shared icon type is className-only. */}
                <span
                  className="flex h-12 w-12 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-105"
                  style={{ backgroundColor: chip, color: o.accent }}
                >
                  <o.icon className="h-6 w-6" />
                </span>

                <span className="mt-4 flex items-center gap-2">
                  <span className="font-display text-base font-semibold">{o.label}</span>
                  {o.soon && (
                    <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Soon
                    </span>
                  )}
                </span>
                <span className="mt-1 text-sm leading-relaxed text-muted-foreground">{o.blurb}</span>

                <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-foreground/70 transition-colors group-hover:text-foreground">
                  {o.soon ? 'Take a look' : 'Open'}
                  <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
