// Nav toggle (mobile)
const navToggle = document.getElementById('navToggle');
const primaryNav = document.getElementById('primaryNav');
if (navToggle && primaryNav) {
  navToggle.addEventListener('click', () => {
    const open = primaryNav.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  primaryNav.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => {
      primaryNav.classList.remove('open');
      navToggle.setAttribute('aria-expanded', 'false');
    });
  });
}

// Signature hero element: animate the grade meter climbing to 9.75
const meterFill = document.getElementById('meterFill');
const meterGrade = document.getElementById('meterGrade');
if (meterFill && meterGrade) {
  const target = 9.75;
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration = prefersReduced ? 0 : 2400;
  const start = performance.now();

  function tick(now) {
    const t = duration === 0 ? 1 : Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    const grade = (target * eased).toFixed(2);
    meterFill.style.width = (eased * 100).toFixed(1) + '%';
    meterGrade.innerHTML = grade + ' <small>/ 9.75 to ace</small>';
    if (t < 1) requestAnimationFrame(tick);
    else meterGrade.innerHTML = target.toFixed(2) + ' <small>— aced!</small>';
  }
  requestAnimationFrame(tick);
}

// Scroll reveal for section heads
const revealTargets = document.querySelectorAll('.section-head, .cycle-step, .region-card, .involve-card, .person');
revealTargets.forEach(el => el.classList.add('reveal'));
const io = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('in');
      io.unobserve(entry.target);
    }
  });
}, { threshold: 0.15 });
revealTargets.forEach(el => io.observe(el));
