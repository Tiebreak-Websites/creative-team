// Flag rendering. Windows Chromium draws emoji flags as bare letters, so we use
// tiny PNGs from flagcdn (allowed by the CSP img-src https: whitelist); on
// failure callers fall back to the code.
//
// This is the ONE language→country map. It briefly existed twice — here and in
// lpBuilder/Builder.tsx — and the copies drifted: this one was missing Norwegian
// and pointed Spanish at Spain, so the LP dashboard and the builder canvas
// disagreed about the same language.
export const FLAG_CC: Record<string, string> = {
  en: 'gb',
  ms: 'my',
  th: 'th',
  ja: 'jp',
  sv: 'se',
  no: 'no',
  pt: 'br',
  // 'es' means Spanish (LatAm) here — the team's list flags it as Mexico, and
  // the Banner Builder's locale list uses 'es-419' + mx for the same thing.
  es: 'mx',
  vi: 'vn',
  it: 'it',
  pl: 'pl',
  fr: 'fr',
  de: 'de',
  ar: 'sa',
  zh: 'cn',
}

/** Flag for a LANGUAGE code — needs the map above ('en' is not a country). */
export function flagUrl(code: string): string {
  return FLAG_CC[code] ? `https://flagcdn.com/w40/${FLAG_CC[code]}.png` : ''
}

/** Flag for a MARKET code. Market codes are ISO-3166 alpha-2, which is exactly
 * what the CDN keys on, so there's deliberately no mapping here to drift. */
export function countryFlagUrl(code: string): string {
  const c = (code || '').trim().toLowerCase()
  return c ? `https://flagcdn.com/w40/${c}.png` : ''
}
