// Default names for the LP Builder's layers.
//
// MIRRORED by auto_name() in backend/app/lp_builder/export.py, which stamps the
// very same string as `data-name` on export. Keep the two in step — a parity
// check over both lives in the repo's verification notes.

/** Words that read wrong under plain title-casing. */
const NAME_ACRONYMS: Record<string, string> = {
  cta: 'CTA', faq: 'FAQ', seo: 'SEO', url: 'URL', id: 'ID',
}

export function humanise(token: string): string {
  const words = (token || '').trim().split(/[-_\s]+/).filter(Boolean)
  return (
    words
      .map((w, i) => {
        const low = w.toLowerCase()
        if (NAME_ACRONYMS[low]) return NAME_ACRONYMS[low]
        return i === 0 ? w[0].toUpperCase() + w.slice(1) : low
      })
      .join(' ') || token
  )
}

/**
 * The default name for a slot key — what a layer is called before anyone
 * renames it. 'title' -> 'Title', 'steps.2' -> 'Step 3', 'steps.2.icon' -> 'Icon'.
 * Mirrors auto_name() in backend/app/lp_builder/export.py, which stamps the very
 * same string as `data-name` on export — so the tree and the HTML agree.
 */
export function autoName(key: string): string {
  const parts = (key || '').split('.')
  if (parts.length >= 3) return humanise(parts[parts.length - 1])
  if (parts.length === 2 && /^\d+$/.test(parts[1])) {
    const base = parts[0]
    const singular = base.length > 3 && base.endsWith('s') ? base.slice(0, -1) : base
    return `${humanise(singular)} ${Number(parts[1]) + 1}`
  }
  return humanise(parts[parts.length - 1])
}

/**
 * The block's own name for a slot, if it declares one. Mirrors template_name()
 * in backend/app/lp_builder/export.py.
 *
 * A repeat resolves by its own key for the ITEM ('faq' -> 'Question 1') and by
 * field name for what's inside it ('faq.0.q' -> 'q' -> 'Question').
 */
export function blockName(
  names: Record<string, string> | undefined,
  key: string,
): string | null {
  if (!names || !key) return null
  if (names[key]) return names[key]
  const parts = key.split('.')
  if (parts.length === 3) return names[`${parts[0]}.${parts[2]}`] ?? names[parts[2]] ?? null
  if (parts.length === 2 && /^\d+$/.test(parts[1])) {
    const base = names[parts[0]]
    return base ? `${base} ${Number(parts[1]) + 1}` : null
  }
  return null
}

/** The name to show for a slot: the user's rename, else the block's own name,
 * else one derived from the key. Same order the exporter uses. */
export function resolveLayerName(
  custom: string | undefined,
  blockNames: Record<string, string> | undefined,
  key: string,
): string {
  return custom || blockName(blockNames, key) || autoName(key)
}
