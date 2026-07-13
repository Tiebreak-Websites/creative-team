"""The built-in finance-LP section library (v1 standard set).

Every section: real HTML annotated with data-lp-* slots, CSS namespaced by
.lp-sec-<key>, built on the design tokens (var(--lp-*)), responsive at the
three canonical widths (base = desktop 1920, <=1199px tablet, <=575px mobile).
`texts` hold per-language DEFAULTS; repeat items default per-index keys
(e.g. "faq.0.q"). Admin edits override these records on disk; the code copy
is always the fallback.
"""

_BTN = ("display:inline-flex;align-items:center;justify-content:center;gap:.5rem;"
        "background:var(--lp-primary);color:#fff;font-weight:700;border:0;cursor:pointer;"
        "border-radius:999px;padding:1rem 2.4rem;font-size:1.06rem;text-decoration:none;"
        "transition:filter .15s ease, transform .15s ease;")

_COMMON_NOTE = "Shared layout helpers (.lp-wrap, .lp-btn) live in export.BASE_CSS."

BUILTIN_SECTIONS = [
# ---------------------------------------------------------------- 1. hero-image
{
 "key": "hero-image", "name": "Hero — image", "category": "hero", "position": 10,
 "html": """<section class="lp-sec-hero-image">
 <div class="lp-wrap hi-grid">
  <div class="hi-copy">
   <p class="hi-eyebrow" data-lp-text="eyebrow">AI-POWERED TRADING</p>
   <h1 class="hi-headline" data-lp-text="headline">The market never sleeps. Neither does your AI.</h1>
   <p class="hi-sub" data-lp-rich="subheadline">Automated monitoring around the clock — clear guidance, instant reactions, zero guesswork.</p>
   <a class="lp-btn" data-lp-link="cta_href" data-lp-text="cta" href="#signup">Get started free</a>
   <div class="hi-chips">
    <!--lp-repeat:chips--><span class="hi-chip" data-lp-text="label">Regulated partners</span><!--/lp-repeat:chips-->
   </div>
  </div>
  <div class="hi-media"><img data-lp-img="hero" src="" alt=""></div>
 </div>
</section>""",
 "css": """.lp-sec-hero-image{background:var(--lp-accent);color:#fff;padding:96px 0}
.lp-sec-hero-image .hi-grid{display:grid;grid-template-columns:1.05fr .95fr;gap:56px;align-items:center}
.lp-sec-hero-image .hi-eyebrow{letter-spacing:.18em;font-size:.82rem;font-weight:700;color:var(--lp-primary);margin:0 0 14px}
.lp-sec-hero-image .hi-headline{font-size:3.4rem;line-height:1.08;margin:0 0 18px;font-weight:800}
.lp-sec-hero-image .hi-sub{font-size:1.15rem;line-height:1.6;color:rgba(255,255,255,.82);margin:0 0 28px}
.lp-sec-hero-image .hi-chips{display:flex;gap:10px;flex-wrap:wrap;margin-top:26px}
.lp-sec-hero-image .hi-chip{border:1px solid rgba(255,255,255,.25);border-radius:999px;padding:.4rem .9rem;font-size:.8rem;color:rgba(255,255,255,.85)}
.lp-sec-hero-image .hi-media img{width:100%;border-radius:18px;display:block;object-fit:cover;box-shadow:0 30px 80px -20px rgba(0,0,0,.55)}
@media (max-width:1199px){.lp-sec-hero-image{padding:72px 0}.lp-sec-hero-image .hi-grid{gap:36px}.lp-sec-hero-image .hi-headline{font-size:2.6rem}}
@media (max-width:575px){.lp-sec-hero-image{padding:56px 0}.lp-sec-hero-image .hi-grid{grid-template-columns:1fr}.lp-sec-hero-image .hi-headline{font-size:1.9rem}}""",
 "texts": {
  "en": {"eyebrow": "AI-POWERED TRADING", "headline": "The market never sleeps. Neither does your AI.",
         "subheadline": "Automated monitoring around the clock — clear guidance, instant reactions, zero guesswork.",
         "cta": "Get started free", "chips.0.label": "24/7 monitoring", "chips.1.label": "Beginner friendly", "chips.2.label": "Free to try"},
 },
},
# ----------------------------------------------------------------- 2. hero-form
{
 "key": "hero-form", "name": "Hero — signup form", "category": "hero", "position": 20,
 "html": """<section class="lp-sec-hero-form">
 <div class="lp-wrap hf-grid">
  <div class="hf-copy">
   <p class="hf-eyebrow" data-lp-text="eyebrow">LIMITED EARLY ACCESS</p>
   <h1 class="hf-headline" data-lp-text="headline">Start smarter with AI-guided investing</h1>
   <p class="hf-sub" data-lp-rich="subheadline">Learn the fundamentals with clear, AI-assisted guidance — built for first-time investors.</p>
   <div class="hf-points">
    <!--lp-repeat:points--><p class="hf-point" data-lp-text="label">✓ No experience needed</p><!--/lp-repeat:points-->
   </div>
  </div>
  <form class="hf-card" data-lp-form>
   <h3 class="hf-form-title" data-lp-text="form_title">Create your free account</h3>
   <input class="hf-in" type="text" name="name" data-lp-text="ph_name" placeholder="Full name" required>
   <input class="hf-in" type="email" name="email" data-lp-text="ph_email" placeholder="Email address" required>
   <input class="hf-in" type="tel" name="phone" data-lp-text="ph_phone" placeholder="Phone number" required>
   <label class="hf-consent"><input type="checkbox" name="consent" required> <span data-lp-text="consent">I agree to be contacted and accept the terms.</span></label>
   <button class="lp-btn hf-submit" type="submit" data-lp-text="submit">Sign up now</button>
  </form>
 </div>
</section>""",
 "css": """.lp-sec-hero-form{background:linear-gradient(135deg,var(--lp-accent),color-mix(in srgb,var(--lp-accent) 70%,#000));color:#fff;padding:96px 0}
.lp-sec-hero-form .hf-grid{display:grid;grid-template-columns:1.1fr .9fr;gap:64px;align-items:center}
.lp-sec-hero-form .hf-eyebrow{letter-spacing:.18em;font-size:.82rem;font-weight:700;color:var(--lp-primary);margin:0 0 14px}
.lp-sec-hero-form .hf-headline{font-size:3.2rem;line-height:1.1;margin:0 0 18px;font-weight:800}
.lp-sec-hero-form .hf-sub{font-size:1.12rem;line-height:1.6;color:rgba(255,255,255,.82);margin:0 0 24px}
.lp-sec-hero-form .hf-point{margin:.4rem 0;color:rgba(255,255,255,.9)}
.lp-sec-hero-form .hf-card{background:#fff;color:var(--lp-text);border-radius:18px;padding:28px;display:flex;flex-direction:column;gap:12px;box-shadow:0 30px 80px -20px rgba(0,0,0,.5)}
.lp-sec-hero-form .hf-form-title{margin:0 0 4px;font-size:1.3rem;font-weight:800}
.lp-sec-hero-form .hf-in{border:1px solid #D7DCE7;border-radius:10px;padding:.85rem 1rem;font-size:1rem;font-family:inherit}
.lp-sec-hero-form .hf-consent{display:flex;gap:.6rem;font-size:.8rem;color:var(--lp-muted);align-items:flex-start;line-height:1.45}
.lp-sec-hero-form .hf-submit{width:100%;margin-top:4px}
@media (max-width:1199px){.lp-sec-hero-form{padding:72px 0}.lp-sec-hero-form .hf-grid{gap:36px}.lp-sec-hero-form .hf-headline{font-size:2.5rem}}
@media (max-width:575px){.lp-sec-hero-form{padding:52px 0}.lp-sec-hero-form .hf-grid{grid-template-columns:1fr}.lp-sec-hero-form .hf-headline{font-size:1.9rem}}""",
 "texts": {
  "en": {"eyebrow": "LIMITED EARLY ACCESS", "headline": "Start smarter with AI-guided investing",
         "subheadline": "Learn the fundamentals with clear, AI-assisted guidance — built for first-time investors.",
         "points.0.label": "✓ No experience needed", "points.1.label": "✓ Set up in 2 minutes", "points.2.label": "✓ Cancel anytime",
         "form_title": "Create your free account", "ph_name": "Full name", "ph_email": "Email address", "ph_phone": "Phone number",
         "consent": "I agree to be contacted and accept the terms.", "submit": "Sign up now"},
  "ms": {"eyebrow": "AKSES AWAL TERHAD", "headline": "Mula melabur dengan lebih bijak bersama AI",
         "subheadline": "Pelajari asas pelaburan dengan panduan AI yang jelas — sesuai untuk pelabur baharu.",
         "points.0.label": "✓ Tiada pengalaman diperlukan", "points.1.label": "✓ Sedia dalam 2 minit", "points.2.label": "✓ Batal bila-bila masa",
         "form_title": "Buka akaun percuma anda", "ph_name": "Nama penuh", "ph_email": "Alamat e-mel", "ph_phone": "Nombor telefon",
         "consent": "Saya bersetuju untuk dihubungi dan menerima terma.", "submit": "Daftar sekarang"},
  "th": {"eyebrow": "สิทธิ์ก่อนใคร จำนวนจำกัด", "headline": "เริ่มลงทุนอย่างชาญฉลาดด้วย AI",
         "subheadline": "เรียนรู้พื้นฐานการลงทุนด้วยคำแนะนำจาก AI ที่ชัดเจน เหมาะสำหรับผู้เริ่มต้น",
         "points.0.label": "✓ ไม่ต้องมีประสบการณ์", "points.1.label": "✓ สมัครได้ใน 2 นาที", "points.2.label": "✓ ยกเลิกได้ตลอดเวลา",
         "form_title": "สร้างบัญชีฟรีของคุณ", "ph_name": "ชื่อ-นามสกุล", "ph_email": "อีเมล", "ph_phone": "เบอร์โทรศัพท์",
         "consent": "ฉันยินยอมให้ติดต่อและยอมรับข้อกำหนด", "submit": "สมัครเลย"},
  "ja": {"eyebrow": "先行アクセス限定", "headline": "AIと始める、賢い投資。",
         "subheadline": "AIの明確なガイダンスで投資の基礎から学べます。初心者のために設計されています。",
         "points.0.label": "✓ 経験は不要", "points.1.label": "✓ 2分で登録完了", "points.2.label": "✓ いつでも解約可能",
         "form_title": "無料アカウントを作成", "ph_name": "氏名", "ph_email": "メールアドレス", "ph_phone": "電話番号",
         "consent": "連絡を受け取ることに同意し、利用規約に同意します。", "submit": "今すぐ無料で登録"},
  "sv": {"eyebrow": "BEGRÄNSAD FÖRTUR", "headline": "Börja smartare med AI-stödd investering",
         "subheadline": "Lär dig grunderna med tydlig, AI-stödd vägledning — byggt för nya investerare.",
         "points.0.label": "✓ Ingen erfarenhet krävs", "points.1.label": "✓ Klart på 2 minuter", "points.2.label": "✓ Avsluta när du vill",
         "form_title": "Skapa ditt kostnadsfria konto", "ph_name": "Fullständigt namn", "ph_email": "E-postadress", "ph_phone": "Telefonnummer",
         "consent": "Jag godkänner att bli kontaktad och accepterar villkoren.", "submit": "Kom igång"},
 },
},
# ------------------------------------------------------------------ 3. stats-bar
{
 "key": "stats-bar", "name": "Stats bar", "category": "content", "position": 30,
 "html": """<section class="lp-sec-stats-bar">
 <div class="lp-wrap sb-row">
  <!--lp-repeat:stats--><div class="sb-item"><p class="sb-value" data-lp-text="value">24/7</p><p class="sb-label" data-lp-text="label">Market monitoring</p></div><!--/lp-repeat:stats-->
 </div>
</section>""",
 "css": """.lp-sec-stats-bar{background:var(--lp-surface);padding:40px 0;border-block:1px solid rgba(0,0,0,.06)}
.lp-sec-stats-bar .sb-row{display:flex;justify-content:space-around;gap:24px;text-align:center;flex-wrap:wrap}
.lp-sec-stats-bar .sb-value{font-size:2.2rem;font-weight:800;color:var(--lp-primary);margin:0}
.lp-sec-stats-bar .sb-label{margin:4px 0 0;color:var(--lp-muted);font-size:.95rem}
@media (max-width:575px){.lp-sec-stats-bar .sb-row{flex-direction:column;gap:18px}}""",
 "texts": {"en": {"stats.0.value": "24/7", "stats.0.label": "Market monitoring",
                  "stats.1.value": "120k+", "stats.1.label": "Active members",
                  "stats.2.value": "2 min", "stats.2.label": "To get started"}},
},
# -------------------------------------------------------------- 4. benefits-grid
{
 "key": "benefits-grid", "name": "Benefits grid", "category": "content", "position": 40,
 "html": """<section class="lp-sec-benefits-grid">
 <div class="lp-wrap">
  <h2 class="bg-title" data-lp-text="title">Why people choose us</h2>
  <p class="bg-sub" data-lp-rich="subtitle">Everything you need to start with confidence.</p>
  <div class="bg-grid">
   <!--lp-repeat:cards--><div class="bg-card"><div class="bg-icon"><img data-lp-img="icon" src="" alt=""></div><h3 class="bg-card-title" data-lp-text="title">Always-on AI</h3><p class="bg-card-text" data-lp-rich="text">Round-the-clock monitoring reacts to sudden moves the moment they happen.</p></div><!--/lp-repeat:cards-->
  </div>
 </div>
</section>""",
 "css": """.lp-sec-benefits-grid{background:var(--lp-bg);padding:88px 0}
.lp-sec-benefits-grid .bg-title{font-size:2.3rem;font-weight:800;text-align:center;margin:0 0 10px;color:var(--lp-text)}
.lp-sec-benefits-grid .bg-sub{text-align:center;color:var(--lp-muted);margin:0 0 44px;font-size:1.08rem}
.lp-sec-benefits-grid .bg-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}
.lp-sec-benefits-grid .bg-card{background:var(--lp-surface);border:1px solid rgba(0,0,0,.05);border-radius:16px;padding:26px}
.lp-sec-benefits-grid .bg-icon{width:52px;height:52px;border-radius:12px;background:color-mix(in srgb,var(--lp-primary) 12%,#fff);display:flex;align-items:center;justify-content:center;margin-bottom:16px;overflow:hidden}
.lp-sec-benefits-grid .bg-icon img{width:30px;height:30px;object-fit:contain}
.lp-sec-benefits-grid .bg-card-title{margin:0 0 8px;font-size:1.15rem;font-weight:700;color:var(--lp-text)}
.lp-sec-benefits-grid .bg-card-text{margin:0;color:var(--lp-muted);line-height:1.55;font-size:.98rem}
@media (max-width:1199px){.lp-sec-benefits-grid .bg-grid{grid-template-columns:repeat(2,1fr)}}
@media (max-width:575px){.lp-sec-benefits-grid{padding:60px 0}.lp-sec-benefits-grid .bg-grid{grid-template-columns:1fr}.lp-sec-benefits-grid .bg-title{font-size:1.7rem}}""",
 "texts": {"en": {"title": "Why people choose us", "subtitle": "Everything you need to start with confidence.",
                  "cards.0.title": "Always-on AI", "cards.0.text": "Round-the-clock monitoring reacts to sudden moves the moment they happen.",
                  "cards.1.title": "Built for beginners", "cards.1.text": "Plain-language guidance takes you from zero to your first informed decision.",
                  "cards.2.title": "You stay in control", "cards.2.text": "Set your own limits — the AI advises, you decide. Cancel anytime."}},
},
# --------------------------------------------------------------- 5. how-it-works
{
 "key": "how-it-works", "name": "How it works", "category": "content", "position": 50,
 "html": """<section class="lp-sec-how-it-works">
 <div class="lp-wrap">
  <h2 class="hw-title" data-lp-text="title">How it works</h2>
  <div class="hw-steps">
   <!--lp-repeat:steps--><div class="hw-step"><div class="hw-num"></div><h3 class="hw-step-title" data-lp-text="title">Create your account</h3><p class="hw-step-text" data-lp-rich="text">Sign up free in under two minutes — no card required.</p></div><!--/lp-repeat:steps-->
  </div>
 </div>
</section>""",
 "css": """.lp-sec-how-it-works{background:var(--lp-surface);padding:88px 0;counter-reset:lpstep}
.lp-sec-how-it-works .hw-title{font-size:2.3rem;font-weight:800;text-align:center;margin:0 0 44px;color:var(--lp-text)}
.lp-sec-how-it-works .hw-steps{display:grid;grid-template-columns:repeat(3,1fr);gap:28px}
.lp-sec-how-it-works .hw-step{background:var(--lp-bg);border-radius:16px;padding:26px;border:1px solid rgba(0,0,0,.05)}
.lp-sec-how-it-works .hw-num{counter-increment:lpstep;width:44px;height:44px;border-radius:999px;background:var(--lp-primary);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;margin-bottom:14px}
.lp-sec-how-it-works .hw-num::before{content:counter(lpstep)}
.lp-sec-how-it-works .hw-step-title{margin:0 0 8px;font-size:1.12rem;font-weight:700;color:var(--lp-text)}
.lp-sec-how-it-works .hw-step-text{margin:0;color:var(--lp-muted);line-height:1.55;font-size:.97rem}
@media (max-width:1199px){.lp-sec-how-it-works .hw-steps{grid-template-columns:repeat(2,1fr)}}
@media (max-width:575px){.lp-sec-how-it-works{padding:60px 0}.lp-sec-how-it-works .hw-steps{grid-template-columns:1fr}.lp-sec-how-it-works .hw-title{font-size:1.7rem}}""",
 "texts": {"en": {"title": "How it works",
                  "steps.0.title": "Create your account", "steps.0.text": "Sign up free in under two minutes — no card required.",
                  "steps.1.title": "Meet your AI guide", "steps.1.text": "Answer a few questions and get a plan matched to your goals.",
                  "steps.2.title": "Start with confidence", "steps.2.text": "Follow clear signals and learn as you go, at your own pace."}},
},
# ------------------------------------------------------------- 6. image-text-split
{
 "key": "image-text", "name": "Image + text split", "category": "content", "position": 60,
 "html": """<section class="lp-sec-image-text">
 <div class="lp-wrap it-grid">
  <div class="it-media"><img data-lp-img="image" src="" alt=""></div>
  <div class="it-copy">
   <h2 class="it-title" data-lp-text="title">See the whole market at a glance</h2>
   <p class="it-text" data-lp-rich="text">Your dashboard turns thousands of signals into one clear picture — what moved, why it matters, and what to consider next.</p>
   <a class="lp-btn it-cta" data-lp-link="cta_href" data-lp-text="cta" href="#signup">Try it free</a>
  </div>
 </div>
</section>""",
 "css": """.lp-sec-image-text{background:var(--lp-bg);padding:88px 0}
.lp-sec-image-text .it-grid{display:grid;grid-template-columns:1fr 1fr;gap:56px;align-items:center}
.lp-sec-image-text .it-media img{width:100%;border-radius:18px;display:block;object-fit:cover;box-shadow:0 24px 60px -18px rgba(0,0,0,.25)}
.lp-sec-image-text .it-title{font-size:2.1rem;font-weight:800;margin:0 0 14px;color:var(--lp-text)}
.lp-sec-image-text .it-text{color:var(--lp-muted);line-height:1.65;font-size:1.05rem;margin:0 0 26px}
@media (max-width:1199px){.lp-sec-image-text .it-grid{gap:36px}}
@media (max-width:575px){.lp-sec-image-text{padding:60px 0}.lp-sec-image-text .it-grid{grid-template-columns:1fr}.lp-sec-image-text .it-title{font-size:1.6rem}}""",
 "texts": {"en": {"title": "See the whole market at a glance",
                  "text": "Your dashboard turns thousands of signals into one clear picture — what moved, why it matters, and what to consider next.",
                  "cta": "Try it free"}},
},
# ---------------------------------------------------------------- 7. advertorial
{
 "key": "advertorial", "name": "Advertorial block", "category": "content", "position": 70,
 "html": """<section class="lp-sec-advertorial">
 <div class="lp-wrap adv-wrap">
  <p class="adv-kicker" data-lp-text="kicker">SPECIAL REPORT</p>
  <h2 class="adv-title" data-lp-text="title">“I never thought investing was for me — until this.”</h2>
  <p class="adv-p" data-lp-rich="p1">Like most people, Sarah assumed investing required years of study, expensive advisors, and nerves of steel. Then a colleague showed her something different: an assistant that watches the market for you and explains every suggestion in plain language.</p>
  <img class="adv-img" data-lp-img="image" src="" alt="">
  <blockquote class="adv-quote" data-lp-text="quote">“The first week, it flagged a move I would never have seen myself.”</blockquote>
  <p class="adv-p" data-lp-rich="p2">Three months later she checks her dashboard with her morning coffee — five minutes, every day. No jargon, no panic, no noise. Just a clear picture and a calm plan.</p>
 </div>
</section>""",
 "css": """.lp-sec-advertorial{background:var(--lp-bg);padding:88px 0}
.lp-sec-advertorial .adv-wrap{max-width:760px}
.lp-sec-advertorial .adv-kicker{letter-spacing:.16em;font-size:.8rem;font-weight:700;color:var(--lp-primary);margin:0 0 12px}
.lp-sec-advertorial .adv-title{font-size:2.1rem;font-weight:800;line-height:1.2;margin:0 0 20px;color:var(--lp-text)}
.lp-sec-advertorial .adv-p{color:var(--lp-text);opacity:.88;line-height:1.75;font-size:1.08rem;margin:0 0 20px}
.lp-sec-advertorial .adv-img{width:100%;border-radius:16px;margin:8px 0 20px;display:block;object-fit:cover}
.lp-sec-advertorial .adv-quote{border-left:4px solid var(--lp-primary);margin:0 0 20px;padding:.4rem 0 .4rem 1.2rem;font-size:1.25rem;font-weight:600;color:var(--lp-text)}
@media (max-width:575px){.lp-sec-advertorial{padding:60px 0}.lp-sec-advertorial .adv-title{font-size:1.55rem}}""",
 "texts": {"en": {"kicker": "SPECIAL REPORT", "title": "“I never thought investing was for me — until this.”",
                  "p1": "Like most people, Sarah assumed investing required years of study, expensive advisors, and nerves of steel. Then a colleague showed her something different: an assistant that watches the market for you and explains every suggestion in plain language.",
                  "quote": "“The first week, it flagged a move I would never have seen myself.”",
                  "p2": "Three months later she checks her dashboard with her morning coffee — five minutes, every day. No jargon, no panic, no noise. Just a clear picture and a calm plan."}},
},
# --------------------------------------------------------------- 8. testimonials
{
 "key": "testimonials", "name": "Testimonials", "category": "social-proof", "position": 80,
 "html": """<section class="lp-sec-testimonials">
 <div class="lp-wrap">
  <h2 class="ts-title" data-lp-text="title">What our members say</h2>
  <div class="ts-grid">
   <!--lp-repeat:reviews--><div class="ts-card"><div class="ts-head"><img class="ts-avatar" data-lp-img="avatar" src="" alt=""><div><p class="ts-name" data-lp-text="name">Amelia R.</p><p class="ts-stars" data-lp-text="stars">★★★★★</p></div></div><p class="ts-quote" data-lp-rich="quote">“Clear, calm and surprisingly simple. I finally understand what I’m doing.”</p></div><!--/lp-repeat:reviews-->
  </div>
 </div>
</section>""",
 "css": """.lp-sec-testimonials{background:var(--lp-surface);padding:88px 0}
.lp-sec-testimonials .ts-title{font-size:2.3rem;font-weight:800;text-align:center;margin:0 0 44px;color:var(--lp-text)}
.lp-sec-testimonials .ts-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}
.lp-sec-testimonials .ts-card{background:var(--lp-bg);border:1px solid rgba(0,0,0,.05);border-radius:16px;padding:24px}
.lp-sec-testimonials .ts-head{display:flex;gap:12px;align-items:center;margin-bottom:14px}
.lp-sec-testimonials .ts-avatar{width:52px;height:52px;border-radius:999px;object-fit:cover;background:#e7eaf2}
.lp-sec-testimonials .ts-name{margin:0;font-weight:700;color:var(--lp-text)}
.lp-sec-testimonials .ts-stars{margin:2px 0 0;color:#F6B01E;font-size:.85rem;letter-spacing:.1em}
.lp-sec-testimonials .ts-quote{margin:0;color:var(--lp-muted);line-height:1.6;font-size:.98rem}
@media (max-width:1199px){.lp-sec-testimonials .ts-grid{grid-template-columns:repeat(2,1fr)}}
@media (max-width:575px){.lp-sec-testimonials{padding:60px 0}.lp-sec-testimonials .ts-grid{grid-template-columns:1fr}.lp-sec-testimonials .ts-title{font-size:1.7rem}}""",
 "texts": {"en": {"title": "What our members say",
                  "reviews.0.name": "Amelia R.", "reviews.0.stars": "★★★★★", "reviews.0.quote": "“Clear, calm and surprisingly simple. I finally understand what I’m doing.”",
                  "reviews.1.name": "Daniel K.", "reviews.1.stars": "★★★★★", "reviews.1.quote": "“The alerts alone are worth it. It caught a dip while I was asleep.”",
                  "reviews.2.name": "Mei L.", "reviews.2.stars": "★★★★☆", "reviews.2.quote": "“I started with nothing but curiosity. The guidance felt like a patient teacher.”"}},
},
# ---------------------------------------------------------------- 9. cards-strip
{
 "key": "cards-strip", "name": "Section cards strip", "category": "social-proof", "position": 90,
 "html": """<section class="lp-sec-cards-strip">
 <div class="lp-wrap">
  <h2 class="cs-title" data-lp-text="title">Inside the platform</h2>
  <div class="cs-grid">
   <!--lp-repeat:cards--><figure class="cs-card"><img data-lp-img="image" src="" alt=""><figcaption data-lp-text="caption">Live market view</figcaption></figure><!--/lp-repeat:cards-->
  </div>
 </div>
</section>""",
 "css": """.lp-sec-cards-strip{background:var(--lp-bg);padding:88px 0}
.lp-sec-cards-strip .cs-title{font-size:2.3rem;font-weight:800;text-align:center;margin:0 0 44px;color:var(--lp-text)}
.lp-sec-cards-strip .cs-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:20px}
.lp-sec-cards-strip .cs-card{margin:0}
.lp-sec-cards-strip .cs-card img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:14px;display:block;background:#e7eaf2}
.lp-sec-cards-strip figcaption{margin-top:10px;text-align:center;color:var(--lp-muted);font-size:.92rem}
@media (max-width:1199px){.lp-sec-cards-strip .cs-grid{grid-template-columns:repeat(2,1fr)}}
@media (max-width:575px){.lp-sec-cards-strip{padding:60px 0}.lp-sec-cards-strip .cs-grid{grid-template-columns:1fr}}""",
 "texts": {"en": {"title": "Inside the platform",
                  "cards.0.caption": "Live market view", "cards.1.caption": "Your AI guide",
                  "cards.2.caption": "Learning center", "cards.3.caption": "Mobile app"}},
},
# ------------------------------------------------------------------ 10. faq
{
 "key": "faq", "name": "FAQ accordion", "category": "conversion", "position": 100,
 "html": """<section class="lp-sec-faq">
 <div class="lp-wrap faq-wrap">
  <h2 class="faq-title" data-lp-text="title">Frequently asked questions</h2>
  <div class="faq-list">
   <!--lp-repeat:faq--><div class="faq-item" data-lp-acc><button class="faq-q" type="button"><span data-lp-text="q">Do I need any experience?</span><span class="faq-x">+</span></button><div class="faq-a"><p data-lp-rich="a">No — the platform was designed for complete beginners. Every suggestion comes with a plain-language explanation.</p></div></div><!--/lp-repeat:faq-->
  </div>
 </div>
</section>""",
 "css": """.lp-sec-faq{background:var(--lp-surface);padding:88px 0}
.lp-sec-faq .faq-wrap{max-width:820px}
.lp-sec-faq .faq-title{font-size:2.3rem;font-weight:800;text-align:center;margin:0 0 40px;color:var(--lp-text)}
.lp-sec-faq .faq-item{background:var(--lp-bg);border:1px solid rgba(0,0,0,.06);border-radius:14px;margin-bottom:12px;overflow:hidden}
.lp-sec-faq .faq-q{width:100%;display:flex;justify-content:space-between;align-items:center;gap:16px;background:none;border:0;padding:18px 20px;font:inherit;font-weight:700;color:var(--lp-text);cursor:pointer;text-align:left}
.lp-sec-faq .faq-x{font-size:1.4rem;color:var(--lp-primary);line-height:1;transition:transform .2s ease}
.lp-sec-faq .faq-item.open .faq-x{transform:rotate(45deg)}
.lp-sec-faq .faq-a{display:none;padding:0 20px 18px;color:var(--lp-muted);line-height:1.6}
.lp-sec-faq .faq-item.open .faq-a{display:block}
.lp-sec-faq .faq-a p{margin:0}
@media (max-width:575px){.lp-sec-faq{padding:60px 0}.lp-sec-faq .faq-title{font-size:1.7rem}}""",
 "texts": {
  "en": {"title": "Frequently asked questions",
         "faq.0.q": "Do I need any experience?", "faq.0.a": "No — the platform was designed for complete beginners. Every suggestion comes with a plain-language explanation.",
         "faq.1.q": "Is it really free to start?", "faq.1.a": "Yes. Creating an account and exploring the platform is free. You decide if and when to fund it.",
         "faq.2.q": "Can I cancel anytime?", "faq.2.a": "Absolutely. There is no lock-in period and no cancellation fee.",
         "faq.3.q": "Is my money at risk?", "faq.3.a": "All investing involves risk. The AI provides guidance, not guarantees — never invest more than you can afford to lose."},
  "ms": {"title": "Soalan lazim",
         "faq.0.q": "Perlukah saya ada pengalaman?", "faq.0.a": "Tidak — platform ini direka untuk pemula. Setiap cadangan disertakan penjelasan mudah.",
         "faq.1.q": "Betul ke percuma untuk bermula?", "faq.1.a": "Ya. Membuka akaun dan meneroka platform adalah percuma.",
         "faq.2.q": "Boleh batal bila-bila masa?", "faq.2.a": "Sudah tentu. Tiada tempoh terikat dan tiada caj pembatalan.",
         "faq.3.q": "Adakah wang saya berisiko?", "faq.3.a": "Semua pelaburan ada risiko. AI memberi panduan, bukan jaminan — jangan labur lebih daripada kemampuan anda."},
  "th": {"title": "คำถามที่พบบ่อย",
         "faq.0.q": "ต้องมีประสบการณ์ไหม?", "faq.0.a": "ไม่จำเป็น แพลตฟอร์มออกแบบมาสำหรับมือใหม่ ทุกคำแนะนำมีคำอธิบายที่เข้าใจง่าย",
         "faq.1.q": "เริ่มต้นฟรีจริงไหม?", "faq.1.a": "ใช่ การสมัครและทดลองใช้งานฟรี คุณตัดสินใจเองว่าจะเติมเงินเมื่อไร",
         "faq.2.q": "ยกเลิกได้ตลอดเวลาไหม?", "faq.2.a": "ได้แน่นอน ไม่มีสัญญาผูกมัดและไม่มีค่าธรรมเนียมยกเลิก",
         "faq.3.q": "เงินของฉันมีความเสี่ยงไหม?", "faq.3.a": "การลงทุนทุกอย่างมีความเสี่ยง AI ให้คำแนะนำ ไม่ใช่การรับประกัน"},
  "ja": {"title": "よくある質問",
         "faq.0.q": "経験は必要ですか？", "faq.0.a": "いいえ。初心者のために設計されており、すべての提案にわかりやすい説明が付きます。",
         "faq.1.q": "本当に無料で始められますか？", "faq.1.a": "はい。アカウント作成と機能の確認は無料です。入金のタイミングはご自身で決められます。",
         "faq.2.q": "いつでも解約できますか？", "faq.2.a": "もちろんです。拘束期間も解約手数料もありません。",
         "faq.3.q": "元本にリスクはありますか？", "faq.3.a": "すべての投資にはリスクがあります。AIは助言を提供しますが、利益を保証するものではありません。"},
  "sv": {"title": "Vanliga frågor",
         "faq.0.q": "Behöver jag erfarenhet?", "faq.0.a": "Nej — plattformen är byggd för nybörjare. Varje förslag förklaras på enkelt språk.",
         "faq.1.q": "Är det verkligen gratis att börja?", "faq.1.a": "Ja. Att skapa ett konto och utforska plattformen är gratis.",
         "faq.2.q": "Kan jag avsluta när som helst?", "faq.2.a": "Absolut. Ingen bindningstid och ingen avgift.",
         "faq.3.q": "Är mina pengar i riskzonen?", "faq.3.a": "All investering innebär risk. AI:n ger vägledning, inte garantier."},
 },
},
# ---------------------------------------------------------------- 11. cta-banner
{
 "key": "cta-banner", "name": "CTA banner", "category": "conversion", "position": 110,
 "html": """<section class="lp-sec-cta-banner">
 <div class="lp-wrap cb-inner">
  <h2 class="cb-title" data-lp-text="title">Ready to see it for yourself?</h2>
  <p class="cb-sub" data-lp-text="subtitle">Join free today — be trading-ready by tomorrow.</p>
  <a class="lp-btn cb-btn" data-lp-link="cta_href" data-lp-text="cta" href="#signup">Get started free</a>
 </div>
</section>""",
 "css": """.lp-sec-cta-banner{background:var(--lp-primary);padding:72px 0;text-align:center}
.lp-sec-cta-banner .cb-title{font-size:2.4rem;font-weight:800;color:#fff;margin:0 0 10px}
.lp-sec-cta-banner .cb-sub{color:rgba(255,255,255,.9);margin:0 0 26px;font-size:1.1rem}
.lp-sec-cta-banner .cb-btn{background:#fff;color:var(--lp-primary)}
@media (max-width:575px){.lp-sec-cta-banner{padding:52px 0}.lp-sec-cta-banner .cb-title{font-size:1.7rem}}""",
 "texts": {"en": {"title": "Ready to see it for yourself?", "subtitle": "Join free today — be trading-ready by tomorrow.",
                  "cta": "Get started free"}},
},
# ------------------------------------------------------------ 12. form-legal-footer
{
 "key": "form-footer", "name": "Signup + legal + footer", "category": "legal", "position": 120,
 "html": """<section class="lp-sec-form-footer" id="signup">
 <div class="lp-wrap">
  <form class="ff-card" data-lp-form>
   <h2 class="ff-title" data-lp-text="form_title">Claim your free access</h2>
   <p class="ff-sub" data-lp-text="form_sub">Fill in your details — it takes less than a minute.</p>
   <div class="ff-row">
    <input class="ff-in" type="text" name="name" data-lp-text="ph_name" placeholder="Full name" required>
    <input class="ff-in" type="email" name="email" data-lp-text="ph_email" placeholder="Email address" required>
    <input class="ff-in" type="tel" name="phone" data-lp-text="ph_phone" placeholder="Phone number" required>
   </div>
   <label class="ff-consent"><input type="checkbox" name="consent" required> <span data-lp-text="consent">I agree to be contacted about this offer and accept the privacy policy.</span></label>
   <button class="lp-btn ff-submit" type="submit" data-lp-text="submit">Get started now</button>
  </form>
  <p class="ff-legal" data-lp-rich="legal">Risk warning: investing involves risk, including the possible loss of capital. Past performance does not guarantee future results. This page is marketing material and does not constitute financial advice.</p>
  <footer class="ff-footer">
   <img class="ff-logo" data-lp-img="logo" src="" alt="">
   <p class="ff-copy" data-lp-text="copyright">© 2026 — All rights reserved.</p>
  </footer>
 </div>
</section>""",
 "css": """.lp-sec-form-footer{background:var(--lp-accent);padding:88px 0 40px;color:#fff}
.lp-sec-form-footer .ff-card{background:#fff;color:var(--lp-text);border-radius:18px;padding:32px;max-width:860px;margin:0 auto;box-shadow:0 30px 80px -20px rgba(0,0,0,.5)}
.lp-sec-form-footer .ff-title{margin:0 0 6px;font-size:1.7rem;font-weight:800;text-align:center}
.lp-sec-form-footer .ff-sub{margin:0 0 22px;color:var(--lp-muted);text-align:center}
.lp-sec-form-footer .ff-row{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:14px}
.lp-sec-form-footer .ff-in{border:1px solid #D7DCE7;border-radius:10px;padding:.85rem 1rem;font-size:1rem;font-family:inherit;width:100%}
.lp-sec-form-footer .ff-consent{display:flex;gap:.6rem;font-size:.8rem;color:var(--lp-muted);align-items:flex-start;line-height:1.45;margin-bottom:16px}
.lp-sec-form-footer .ff-submit{width:100%}
.lp-sec-form-footer .ff-legal{max-width:860px;margin:26px auto 0;font-size:.78rem;line-height:1.6;color:rgba(255,255,255,.55)}
.lp-sec-form-footer .ff-footer{display:flex;align-items:center;justify-content:space-between;gap:16px;border-top:1px solid rgba(255,255,255,.15);margin-top:32px;padding-top:20px}
.lp-sec-form-footer .ff-logo{height:34px;object-fit:contain}
.lp-sec-form-footer .ff-copy{margin:0;font-size:.82rem;color:rgba(255,255,255,.6)}
@media (max-width:1199px){.lp-sec-form-footer .ff-row{grid-template-columns:1fr}}
@media (max-width:575px){.lp-sec-form-footer{padding:56px 0 28px}.lp-sec-form-footer .ff-footer{flex-direction:column;text-align:center}}""",
 "texts": {
  "en": {"form_title": "Claim your free access", "form_sub": "Fill in your details — it takes less than a minute.",
         "ph_name": "Full name", "ph_email": "Email address", "ph_phone": "Phone number",
         "consent": "I agree to be contacted about this offer and accept the privacy policy.",
         "submit": "Get started now",
         "legal": "Risk warning: investing involves risk, including the possible loss of capital. Past performance does not guarantee future results. This page is marketing material and does not constitute financial advice.",
         "copyright": "© 2026 — All rights reserved."},
  "ms": {"form_title": "Dapatkan akses percuma anda", "form_sub": "Isi maklumat anda — kurang dari seminit.",
         "ph_name": "Nama penuh", "ph_email": "Alamat e-mel", "ph_phone": "Nombor telefon",
         "consent": "Saya bersetuju untuk dihubungi mengenai tawaran ini dan menerima dasar privasi.",
         "submit": "Mula sekarang",
         "legal": "Amaran risiko: pelaburan melibatkan risiko, termasuk kemungkinan kehilangan modal. Prestasi lalu tidak menjamin hasil masa hadapan. Halaman ini adalah bahan pemasaran dan bukan nasihat kewangan.",
         "copyright": "© 2026 — Hak cipta terpelihara."},
  "th": {"form_title": "รับสิทธิ์เข้าใช้งานฟรี", "form_sub": "กรอกข้อมูลของคุณ ใช้เวลาไม่ถึงหนึ่งนาที",
         "ph_name": "ชื่อ-นามสกุล", "ph_email": "อีเมล", "ph_phone": "เบอร์โทรศัพท์",
         "consent": "ฉันยินยอมให้ติดต่อเกี่ยวกับข้อเสนอนี้และยอมรับนโยบายความเป็นส่วนตัว",
         "submit": "เริ่มเลย",
         "legal": "คำเตือนความเสี่ยง: การลงทุนมีความเสี่ยง รวมถึงการสูญเสียเงินต้น ผลการดำเนินงานในอดีตไม่ได้รับประกันผลลัพธ์ในอนาคต หน้านี้เป็นสื่อการตลาดและไม่ใช่คำแนะนำทางการเงิน",
         "copyright": "© 2026 — สงวนลิขสิทธิ์"},
  "ja": {"form_title": "無料アクセスを申し込む", "form_sub": "1分もかかりません。以下にご記入ください。",
         "ph_name": "氏名", "ph_email": "メールアドレス", "ph_phone": "電話番号",
         "consent": "本オファーに関する連絡を受け取ることに同意し、プライバシーポリシーに同意します。",
         "submit": "今すぐ始める",
         "legal": "リスク警告：投資には元本割れを含むリスクがあります。過去の実績は将来の結果を保証するものではありません。本ページはマーケティング資料であり、金融アドバイスではありません。",
         "copyright": "© 2026 — 無断転載を禁じます。"},
  "sv": {"form_title": "Få din kostnadsfria åtkomst", "form_sub": "Fyll i dina uppgifter — det tar mindre än en minut.",
         "ph_name": "Fullständigt namn", "ph_email": "E-postadress", "ph_phone": "Telefonnummer",
         "consent": "Jag godkänner att bli kontaktad om erbjudandet och accepterar integritetspolicyn.",
         "submit": "Kom igång nu",
         "legal": "Riskvarning: investeringar innebär risk, inklusive möjlig kapitalförlust. Historisk avkastning är ingen garanti för framtida resultat. Denna sida är marknadsföringsmaterial och utgör inte finansiell rådgivning.",
         "copyright": "© 2026 — Alla rättigheter förbehållna."},
 },
},
]
