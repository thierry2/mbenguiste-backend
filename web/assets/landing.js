(function () {
  'use strict';
  var REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── La ligne qui respire (comportement réel de app/index.tsx) ────────── */
  var LINES = [
    'Quelqu’un, quelque part, te ressemble.',
    'Cette fois, prends ton temps.',
    'Des rencontres qui te ressemblent.',
    'On ne compte pas les matchs. On compte les histoires.'
  ];
  var bre = document.getElementById('breathe'), li = 0;
  if (bre && !REDUCE) {
    setInterval(function () {
      bre.style.opacity = '0';
      setTimeout(function () {
        li = (li + 1) % LINES.length;
        bre.textContent = LINES[li];
        bre.style.opacity = '';
      }, 560);
    }, 4200);
  }

  /* ── Filet sous la nav ────────────────────────────────────────────────── */
  var nav = document.getElementById('nav');
  addEventListener('scroll', function () {
    nav.classList.toggle('stuck', scrollY > 10);
  }, { passive: true });

  /* ── Révélations au scroll ────────────────────────────────────────────── */
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, { threshold: .1, rootMargin: '0px 0px -8% 0px' });
  document.querySelectorAll('.rise').forEach(function (n) { io.observe(n); });

  /* ═══ LE DECK JOUABLE ═════════════════════════════════════════════════
     Le geste central de l'app, rejouable avant installation. Physique
     simple et lisible : déplacement → inclinaison proportionnelle, tampons
     dont l'opacité suit la course, relâché au-delà du seuil → envol.
     Pas de photo inventée : des dégradés tiennent lieu de présence.      */
  var PROFILES = [
    { g: 'g1', nm: 'Fatou, 27',  qt: '« Je ris trop fort au cinéma. »' },
    { g: 'g2', nm: 'Aïcha, 29',  qt: '« Je cuisine pour réfléchir. »' },
    { g: 'g3', nm: 'Nadia, 31',  qt: '« Je pose trop de questions. »' },
    { g: 'g4', nm: 'Sofia, 26',  qt: '« Je marche pour m’endormir. »' }
  ];

  var deck = document.getElementById('deck');
  var myst = document.getElementById('myst');
  var again = document.getElementById('again');
  var btnLike = document.getElementById('btnLike');
  var btnPass = document.getElementById('btnPass');
  var btnSuper = document.getElementById('btnSuper');
  var cards = [];
  var idx = 0;
  var busy = false;

  function build() {
    cards.forEach(function (c) { c.remove(); });
    cards = [];
    // Empilées à l'envers : la première du tableau est au-dessus.
    for (var i = PROFILES.length - 1; i >= 0; i--) {
      var p = PROFILES[i];
      var el = document.createElement('article');
      el.className = 'card rest';
      el.innerHTML =
        '<div class="pf ' + p.g + '"></div>' +
        '<div class="veil"></div>' +
        '<span class="stamp like">AIMÉ</span>' +
        '<span class="stamp pass">PASSÉ</span>' +
        '<div class="meta"><div class="nm">' + p.nm + '</div><div class="qt">' + p.qt + '</div></div>';
      deck.insertBefore(el, myst);
      cards.unshift(el);
    }
    idx = 0;
    layout();
  }

  /* Pile : la carte du dessus à plat, les suivantes reculées et réduites. */
  function layout() {
    cards.forEach(function (c, i) {
      var d = i - idx;
      c.classList.toggle('top', d === 0);
      if (d < 0) return;
      if (d > 2) { c.style.opacity = '0'; c.style.transform = 'translateY(26px) scale(.9)'; return; }
      c.style.opacity = '1';
      c.style.zIndex = String(10 - d);
      /* La pile recule vers le HAUT : le bas de la carte reste net sous la
         rangée de décision, au lieu de laisser dépasser des tranches. */
      c.style.transform = 'translateY(' + (-d * 9) + 'px) scale(' + (1 - d * .045) + ')';
    });
  }

  function stamps(c, dx) {
    var l = c.querySelector('.stamp.like'), p = c.querySelector('.stamp.pass');
    var t = Math.min(Math.abs(dx) / 110, 1);
    if (l) l.style.opacity = dx > 0 ? t : 0;
    if (p) p.style.opacity = dx < 0 ? t : 0;
  }

  /* dir : 1 aimer · -1 passer · 0 super like (la carte part vers le haut,
     comme partout ailleurs dans le genre). */
  function decide(dir) {
    if (busy) return;
    var c = cards[idx];
    if (!c) return;
    busy = true;

    if (dir > 0 && btnLike) {
      btnLike.classList.add('beating');
      setTimeout(function () { btnLike.classList.remove('beating'); }, 440);
    }

    c.classList.remove('rest'); c.classList.add('fly');
    if (dir === 0) {
      c.style.transform = 'translateY(-760px) scale(.92)';
    } else {
      c.style.transform = 'translate(' + (dir * 620) + 'px,-70px) rotate(' + (dir * 26) + 'deg)';
      stamps(c, dir * 200);
    }
    c.style.opacity = '0';

    setTimeout(function () {
      idx++;
      busy = false;
      if (idx >= cards.length) { openMystere(); return; }
      layout();
    }, 420);
  }

  function openMystere() { myst.classList.add('on'); }

  if (again) {
    again.addEventListener('click', function () {
      myst.classList.remove('on');
      build();
    });
  }

  /* Glissement — Pointer Events : souris, tactile et stylet d'un seul tenant. */
  var startX = 0, startY = 0, dragging = false, cur = null;

  function onDown(e) {
    if (busy) return;
    cur = cards[idx];
    if (!cur || !cur.classList.contains('top')) return;
    dragging = true;
    startX = e.clientX; startY = e.clientY;
    cur.classList.remove('rest');
    cur.setPointerCapture(e.pointerId);
  }
  function onMove(e) {
    if (!dragging || !cur) return;
    var dx = e.clientX - startX, dy = e.clientY - startY;
    cur.style.transform = 'translate(' + dx + 'px,' + dy + 'px) rotate(' + (dx * .06) + 'deg)';
    stamps(cur, dx);
  }
  function onUp(e) {
    if (!dragging || !cur) return;
    dragging = false;
    var dx = e.clientX - startX;
    var c = cur; cur = null;
    if (Math.abs(dx) > 96) { decide(dx > 0 ? 1 : -1); return; }
    c.classList.add('rest');
    c.style.transform = '';
    stamps(c, 0);
    layout();
  }

  if (deck) {
    deck.addEventListener('pointerdown', onDown);
    deck.addEventListener('pointermove', onMove);
    deck.addEventListener('pointerup', onUp);
    deck.addEventListener('pointercancel', onUp);
    /* Clavier : le deck est atteignable et jouable sans souris. */
    deck.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { e.preventDefault(); decide(1); }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); decide(-1); }
      if (e.key === 'ArrowUp')    { e.preventDefault(); decide(0); }
    });
  }
  if (btnLike)  btnLike.addEventListener('click', function () { decide(1); });
  if (btnPass)  btnPass.addEventListener('click', function () { decide(-1); });
  if (btnSuper) btnSuper.addEventListener('click', function () { decide(0); });

  build();

  /* ═══ LA CARTE QUI SE MÉTAMORPHOSE AU SCROLL ═════════════════════════ */
  var mcs = {};
  document.querySelectorAll('[data-card]').forEach(function (c) { mcs[c.dataset.card] = c; });
  var heart = document.getElementById('heart');

  function show(state) {
    Object.keys(mcs).forEach(function (k) { mcs[k].classList.toggle('on', k === state); });
    if (heart) heart.classList.toggle('on', state === 'match');
  }
  show('mystere');

  var spy = new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) show(e.target.dataset.state); });
  }, { threshold: .45 });
  document.querySelectorAll('[data-state]').forEach(function (n) { spy.observe(n); });
})();
