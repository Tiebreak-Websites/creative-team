// Brand folders — the shelf both builders open onto.
//
// Extracted from the LP Builder so the Email Builder shows the SAME shelf
// rather than a lookalike: two copies of a folder drift (the flag map already
// taught us that), and a folder that renders differently per tool stops
// reading as the same thing.

import { FolderOpen } from 'lucide-react'
import { brandLogoSrc, brandLogoUri } from '@/lib/brandLogo'
import { entityAccent, NEUTRAL_ACCENT, type Brand } from '@/bannerBuilder/brandsApi'

export interface FolderItem {
  id: string
  name: string
  brand: Brand | null
  count: number
  latest: string
}

export function FolderGrid({
  folders,
  dark,
  onOpen,
  noun = 'landing page',
}: {
  folders: FolderItem[]
  dark: boolean
  onOpen: (id: string) => void
  /** What the folder holds, singular — 'landing page', 'email'. */
  noun?: string
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {folders.map((f, i) => {
        const accent = f.brand ? entityAccent(f.brand) ?? NEUTRAL_ACCENT : NEUTRAL_ACCENT
        const icon = f.brand?.icon_svg ? brandLogoUri(f.brand.icon_svg, false) : ''
        const label = `${f.count} ${noun}${f.count === 1 ? '' : 's'}`
        // Mix the accent toward an OPAQUE base, not `transparent`: a translucent
        // tint composites over the dark card into a washed-out grey that kills
        // label contrast. Mixing toward white (light) / near-black (dark) keeps
        // the folder coloured and the theme's own text colour readable on it.
        const base = dark ? '#101013' : '#FFFFFF'
        const mix = (pct: number) => `color-mix(in srgb, ${accent} ${pct}%, ${base})`
        const face = mix(dark ? 20 : 13)
        const tabFace = mix(dark ? 34 : 28)
        const divider = mix(dark ? 32 : 22)
        return (
          <button
            key={f.id || 'other'}
            type="button"
            onClick={() => onOpen(f.id)}
            title={`Open the ${f.name} folder — ${label}`}
            className="group animate-fade-up relative block w-full pt-2.5 text-left"
            style={{ animationDelay: `${Math.min(i * 40, 320)}ms` }}
          >
            {/* The TAB. Sits behind the body (declared first, body is opaque), so
                its bottom edge is covered and the folder reads as one shape. */}
            <span
              aria-hidden
              className="absolute left-3 top-0 h-5 w-[42%] rounded-t-lg transition-transform duration-200 group-hover:-translate-y-0.5"
              // Same material as the folder face, a shade deeper — a tab is part
              // of the folder, not a sticker on it.
              style={{ backgroundColor: tabFace }}
            />
            {/* A sheet peeking out, but only when the folder holds pages — a
                full folder looks full. */}
            {f.count > 0 && (
              <span
                aria-hidden
                className="absolute inset-x-2 top-1 h-4 rounded-t-lg border border-b-0 border-border bg-card transition-transform duration-200 group-hover:-translate-y-0.5"
              />
            )}

            {/* bg-card keeps the body OPAQUE so the tab's lower half stays
                hidden behind it; the tint layer inside colours the whole face. */}
            <div className="relative overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-all duration-200 group-hover:-translate-y-0.5 group-hover:border-primary/40 group-hover:shadow-md">
              <div style={{ backgroundColor: face }}>
                {/* pl-2.5 matches the label's padding below, so the icon's left
                    edge lines up with the folder name. */}
                <div className="flex h-[70px] items-center justify-start pl-2.5">
                  {icon ? (
                    <img
                      src={icon}
                      alt=""
                      className="h-11 w-11 rounded-lg bg-white shadow-sm ring-1 ring-black/5 transition-transform duration-200 group-hover:scale-105"
                    />
                  ) : f.brand?.logo_svg ? (
                    <img
                      src={brandLogoSrc(f.brand, dark)}
                      alt=""
                      className="h-8 max-w-28 rounded-md bg-white p-1 shadow-sm ring-1 ring-black/5"
                    />
                  ) : (
                    <FolderOpen className="h-7 w-7" style={{ color: accent }} />
                  )}
                </div>

                <div
                  className="border-t px-2.5 py-2"
                  style={{ borderColor: divider }}
                >
                  <span
                    className="block truncate font-display text-[13px] font-semibold"
                    title={f.name}
                  >
                    {f.name}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                    <FolderOpen className="h-3 w-3 shrink-0" aria-hidden />
                    <span className="truncate">
                      {f.count === 0 ? 'Empty' : label}
                      {f.latest &&
                        ` · ${new Date(f.latest).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}
                    </span>
                  </span>
                </div>
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
