// Language code → ISO country for flag rendering. Windows Chromium draws emoji
// flags as bare letters, so we use tiny flag PNGs from flagcdn (allowed by the
// CSP img-src https: whitelist); on failure callers fall back to the code.
export const FLAG_CC: Record<string, string> = {
  en: 'gb', ms: 'my', th: 'th', ja: 'jp', sv: 'se', pt: 'br', es: 'es',
  vi: 'vn', it: 'it', pl: 'pl', fr: 'fr', de: 'de', ar: 'sa', zh: 'cn',
}

export function flagUrl(code: string): string {
  return FLAG_CC[code] ? `https://flagcdn.com/w40/${FLAG_CC[code]}.png` : ''
}
