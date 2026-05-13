---
type: brand-voice
audience: anthropic-skills:translate
purpose: Default tone-of-voice instructions fed verbatim into every translation run when no per-brand voice override exists.
---

# Default brand voice for translations

This file is loaded by `/translate-figma` whenever a brand-specific voice file
is not present at `projects/<brand>/i18n/brand-voice.md`. It is fed verbatim
into the translator prompt — keep it short, opinionated, and concrete.

## Voice principles

1. **Confident, never pushy.** Headlines state benefits as facts. CTAs are verbs in the imperative, never tentative ("Start", not "Try to start").
2. **Second person, present tense.** Address the reader as "you" / "your". Avoid "we" except when introducing the company.
3. **Short verbs, short sentences.** Aim for ~8–12 words per sentence in body copy, ≤5 words for CTAs and badges, ≤8 words for headlines.
4. **Specific, not vague.** Numbers, named features, and concrete outcomes beat adjectives. Cut "very", "really", "powerful", "amazing", "best-in-class".
5. **Locale-native, not literal.** Idioms translate idiomatically. Currency, date format, decimal separator, phone format follow target-locale convention. Quotation marks follow target convention (« » in French, „ " in German, " " in English).

## Per-locale tone notes

- **German (de)** — direct, formal "Sie" by default for B2C finance/coaching. Compounds are normal; favor short compounds over long ones if both work. Watch hyphens.
- **French (fr)** — formal "vous" by default. Match register to source — never drop into "tu" unless source is overtly casual. Use insecable spaces before `: ; ! ?` per French typography (the ` ` character).
- **Spanish (es)** — neutral pan-LATAM Spanish by default unless locale code says otherwise (`es-ES` → Spain, `es-LATAM` → LATAM). Use "tú" for direct-to-consumer marketing unless brand voice says otherwise.
- **Portuguese (pt)** — same defaulting rule: `pt-BR` for Brazil, `pt-PT` for Portugal. Brazilian uses "você"; Portuguese tends to "tu" + verb conjugation.
- **Italian (it)** — formal "Lei" for finance/health; "tu" for consumer apps and casual brands. Match source register.
- **Bulgarian (bg)** — formal "Вие" by default for B2C marketing. Latin loanwords (trading, online) are acceptable and natural in tech contexts.
- **Arabic (ar)** — Modern Standard Arabic unless a dialect is requested. Right-to-left: do not reorder placeholders — Figma handles bidi rendering.
- **Japanese (ja)** — `です/ます` polite form for marketing. Drop honorific suffixes from English brand names ("BrainTrade様" is wrong).
- **Chinese (zh)** — simplified by default. Numbers stay Arabic. No spaces between Chinese characters.

## Hard rules

- **Brand and product names are never translated.** Even if they would be meaningful in the target language. See `glossary.global.json` → `doNotTranslate`.
- **Placeholders are sacred.** `{name}`, `{{var}}`, `%s`, `${value}` — preserve verbatim, in the same order if the language requires reordering rephrase the sentence around them.
- **CTAs and buttons must fit.** When the character limit conflicts with literal translation, rephrase shorter. A button that overflows is broken.
- **No invented punctuation.** Don't add exclamation marks or emoji the source didn't use. Don't drop punctuation the source did use unless target-locale convention demands it.
- **Numbers stay numbers.** "3" remains "3" — don't spell out "three". Currency symbols may swap per locale convention.
- **No machine-translation tells.** Read your output aloud — if it sounds like Google Translate, rewrite. The teammate is shipping this to production with no human review.

## What "good" looks like

Source (English):
> Start Your Trading Education With a Personal Trainer

Bad (DE, literal):
> Beginnen Sie Ihre Handelsausbildung mit einem persönlichen Trainer

Good (DE, native marketing tone):
> Starten Sie Ihre Trading-Ausbildung — mit persönlichem Coach

Why: keeps "Trading" (loanword, natural in DE finance), uses em-dash for rhythm, "Coach" matches industry usage, shorter overall.
