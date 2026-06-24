// Lightweight, dependency-free language guess for auto-selecting the banner
// locale from the concept text the user typed/pasted. Returns one of the Banner
// Builder's supported locale values, or null when it isn't confident.
//
// Non-Latin scripts are detected with high confidence by Unicode range; Latin
// languages are scored by stopword hits + a few diacritic nudges.

const STOP: Record<string, string[]> = {
  'es-419': ['el', 'la', 'los', 'las', 'de', 'en', 'y', 'que', 'con', 'para', 'por', 'un', 'una', 'líder', 'más', 'está', 'según', 'su'],
  pt: ['o', 'a', 'os', 'as', 'de', 'em', 'que', 'não', 'com', 'para', 'uma', 'você', 'está', 'mais', 'são', 'do', 'da'],
  de: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'mit', 'ein', 'eine', 'für', 'auf', 'den', 'zu', 'im'],
  it: ['il', 'lo', 'la', 'di', 'che', 'non', 'con', 'per', 'una', 'sono', 'più', 'del', 'della', 'gli'],
  pl: ['i', 'w', 'na', 'nie', 'to', 'jest', 'się', 'że', 'do', 'z', 'dla', 'przez', 'oraz'],
  sv: ['och', 'att', 'det', 'är', 'en', 'ett', 'som', 'på', 'för', 'med', 'inte', 'har', 'till'],
  en: ['the', 'and', 'of', 'to', 'in', 'is', 'for', 'with', 'you', 'your', 'a', 'on', 'we'],
}

// Ordered: check kana before generic CJK so Japanese isn't mistaken for Chinese.
const SCRIPTS: [RegExp, string][] = [
  [/[぀-ヿ]/, 'ja'], // hiragana / katakana
  [/[฀-๿]/, 'th'], // thai
  [/[؀-ۿ]/, 'ar'], // arabic
  [/[一-鿿]/, 'zh'], // CJK ideographs
]

export function detectLocale(text: string): string | null {
  const t = (text || '').trim()
  if (t.length < 8) return null

  for (const [re, loc] of SCRIPTS) {
    if (re.test(t)) return loc
  }

  const words = t.toLowerCase().match(/[\p{L}]+/gu) ?? []
  if (!words.length) return null
  const set = new Set(words)

  const scores: Record<string, number> = {}
  for (const [loc, list] of Object.entries(STOP)) {
    scores[loc] = list.reduce((n, w) => n + (set.has(w) ? 1 : 0), 0)
  }
  // Diacritic / punctuation nudges.
  if (/[ñ¿¡]/i.test(t)) scores['es-419'] += 2
  if (/[ãõ]/i.test(t) || /ç/i.test(t)) scores['pt'] += 2
  if (/[äöüß]/i.test(t)) scores['de'] += 1.5
  if (/[łąężźśćń]/i.test(t)) scores['pl'] += 2
  if (/[åä]/i.test(t)) scores['sv'] += 1

  let best = 'en'
  let bestScore = 0
  for (const [loc, s] of Object.entries(scores)) {
    if (s > bestScore) {
      bestScore = s
      best = loc
    }
  }
  return bestScore >= 1 ? best : null
}
