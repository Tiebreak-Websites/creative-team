/* =================================================================
   STARFIELD
   ================================================================= */
(function starfield() {
  const canvas = document.getElementById('starfield');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let stars = [];
  let w, h, dpr;

  function resize() {
    dpr = window.devicePixelRatio || 1;
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    seed();
  }

  function seed() {
    const count = Math.floor((w * h) / 6000);
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() * 1.3 + 0.2,
      a: Math.random() * 0.8 + 0.2,
      twinkleSpeed: Math.random() * 0.015 + 0.003,
      phase: Math.random() * Math.PI * 2,
    }));
  }

  let t = 0;
  function draw() {
    ctx.clearRect(0, 0, w, h);
    t += 0.01;
    for (const s of stars) {
      const alpha = s.a * (0.6 + 0.4 * Math.sin(t * s.twinkleSpeed * 100 + s.phase));
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.fill();
    }
    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize);
  resize();
  draw();
})();

/* =================================================================
   NAV — switch styling once we leave the dark hero
   ================================================================= */
(function nav() {
  const navEl = document.getElementById('nav');
  if (!navEl) return;
  const onScroll = () => {
    const passed = window.scrollY > window.innerHeight * 0.85;
    navEl.classList.toggle('scrolled', passed);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();

/* =================================================================
   HERO ENTRANCE + SCROLL REVEALS
   ================================================================= */
window.addEventListener('load', () => {
  if (typeof gsap === 'undefined') return;
  gsap.registerPlugin(ScrollTrigger);

  const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
  tl.from('#badge', { y: 20, opacity: 0, duration: 0.35 })
    .from('.hero-headline span', { y: 60, opacity: 0, duration: 0.55, stagger: 0.07 }, '-=0.2')
    .from('.moon-3d-container', { scale: 0.7, opacity: 0, duration: 0.75, ease: 'power2.out' }, '-=0.35')
    .to('.float-card', {
      opacity: 1,
      y: 0,
      duration: 0.45,
      stagger: 0.06,
      ease: 'power2.out',
      onComplete: () => {
        document.querySelectorAll('.float-card').forEach((c) => c.classList.add('in-view'));
      },
    }, '-=0.5')
    .from('.moon-toggle-wrap', { y: 20, opacity: 0, duration: 0.35 }, '-=0.3');

  gsap.utils.toArray('.reveal').forEach((el) => {
    gsap.to(el, {
      opacity: 1,
      y: 0,
      duration: 0.9,
      ease: 'power2.out',
      scrollTrigger: {
        trigger: el,
        start: 'top 85%',
        toggleActions: 'play none none none',
      },
    });
  });
});

/* =================================================================
   SEGMENTED LIGHT / DARK TOGGLE
   ================================================================= */
(function segToggle() {
  const stage = document.getElementById('moonStage');
  const toggle = document.getElementById('moonToggle');
  if (!stage || !toggle) return;
  const segs = toggle.querySelectorAll('.seg-btn');

  function setSide(side) {
    const isDark = side === 'dark';
    stage.classList.toggle('is-dark', isDark);
    stage.classList.toggle('is-bright', !isDark);
    segs.forEach((s) => {
      const active = s.dataset.side === side;
      s.classList.toggle('active', active);
      s.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('.float-card').forEach((card) => {
      card.style.transition = 'opacity 0.3s ease';
      card.style.opacity = '0.35';
      setTimeout(() => { card.style.opacity = '1'; }, 320);
    });
  }

  segs.forEach((s) => s.addEventListener('click', () => setSide(s.dataset.side)));
})();
