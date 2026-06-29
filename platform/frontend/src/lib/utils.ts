import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merge conditional class names and dedupe conflicting Tailwind utilities. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Friendly display name from a login email — "stefina.varadzhakova@x.dev" →
 * "Stefina Varadzhakova". Falls back to the raw value if it isn't email-shaped.
 * Used to label who generated a batch in the shared gallery + Disk Manager.
 */
export function formatUserName(email?: string | null): string {
  if (!email) return ''
  const local = email.split('@')[0]
  const parts = local.split(/[._-]+/).filter(Boolean)
  if (!parts.length) return email
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ')
}
