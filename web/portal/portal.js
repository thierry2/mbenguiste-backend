/* ═══════════════════════════════════════════════════════════════════════════
   Portail partenaire — authentification Supabase + espace en 4 sections
   (Aperçu · Mon lien · Paiements · Ressources).

   Un écran d'authentification = une URL (/partenaires/connexion, /lien-magique,
   /mot-de-passe-oublie, /nouveau-mot-de-passe).

   Les liens d'email Supabase arrivent sous QUATRE formes selon la configuration
   du projet et l'ancienneté du lien. On les gère toutes, sinon un partenaire
   reste bloqué sans comprendre pourquoi :
     1. #access_token=…&type=invite|recovery   (flux implicite)
     2. ?code=…                                (flux PKCE)
     3. ?token_hash=…&type=…                   (modèles d'email récents)
     4. ?error=…&error_description=…           (lien expiré/déjà utilisé)
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var show = function (id) { $(id).classList.remove('hidden'); };
  var hide = function (id) { $(id).classList.add('hidden'); };

  var TIERS = { plus: 'Plus', or: 'Or', prestige: 'Prestige' };
  var eur = function (cents) {
    return (Number(cents || 0) / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
  };

  function notice(el, text, kind) {
    el.innerHTML = '';
    if (!text) return;
    var d = document.createElement('div');
    d.className = 'notice notice-' + (kind || 'err');
    d.textContent = text;
    el.appendChild(d);
  }
  function toast(text, kind) {
    var t = document.createElement('div');
    t.className = 'toast' + (kind ? ' toast-' + kind : '');
    t.textContent = text;
    $('toasts').appendChild(t);
    setTimeout(function () { t.remove(); }, 5200);
  }

  /* ── Paramètres du lien, capturés AVANT que supabase-js ne nettoie l'URL ── */
  function parseParams() {
    var out = {};
    var take = function (str) {
      if (!str) return;
      new URLSearchParams(str.replace(/^[#?]/, '')).forEach(function (v, k) { out[k] = v; });
    };
    take(window.location.search);
    take(window.location.hash);
    return out;
  }
  var linkParams = parseParams();

  function cleanUrl(path) {
    window.history.replaceState(null, '', path || window.location.pathname);
  }

  /**
   * Supabase renvoie ses motifs d'échec en anglais. Les afficher tels quels à un
   * partenaire francophone, c'est le laisser devant un message qu'il ne comprend
   * pas au moment précis où il est déjà bloqué.
   */
  function raisonFr(p) {
    var brut = (p.error_description || p.error || '').replace(/\+/g, ' ').toLowerCase();
    var suite = ' Demande un nouveau lien : il arrive tout de suite.';
    if (brut.indexOf('expired') !== -1 || p.error_code === 'otp_expired') {
      return 'Ce lien a expiré — ils ne durent qu\'un moment, par sécurité.' + suite;
    }
    if (brut.indexOf('already') !== -1 || brut.indexOf('used') !== -1) {
      return 'Ce lien a déjà servi : chacun ne fonctionne qu\'une seule fois.' + suite;
    }
    if (brut.indexOf('invalid') !== -1) {
      return 'Ce lien est incomplet ou abîmé — souvent parce qu\'il a été recopié à la main.' + suite;
    }
    return 'Ce lien n\'a pas pu être validé.' + suite;
  }

  /* ── Vues d'authentification ─────────────────────────────────────────── */
  var VIEWS = ['view-login', 'view-magic', 'view-forgot', 'view-setpass', 'view-expired', 'view-notpartner'];
  function showAuth(view) {
    hide('boot'); hide('app'); show('auth');
    VIEWS.forEach(function (v) { hide(v); });
    show(view);
    var focus = { 'view-login': 'login-email', 'view-magic': 'magic-email',
      'view-forgot': 'forgot-email', 'view-setpass': 'set-password' }[view];
    if (focus && $(focus)) $(focus).focus();
  }

  function viewForPath() {
    var p = window.location.pathname.replace(/\/$/, '');
    if (p === '/partenaires/lien-magique') return 'view-magic';
    if (p === '/partenaires/mot-de-passe-oublie') return 'view-forgot';
    if (p === '/partenaires/nouveau-mot-de-passe') return 'view-setpass';
    return 'view-login';
  }

  /* ── Démarrage ───────────────────────────────────────────────────────── */
  var sb = null;

  function boot() {
    fetch('/partenaires/config.json')
      .then(function (r) { return r.json(); })
      .then(function (cfg) {
        if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
          $('boot').textContent = "L'authentification n'est pas encore configurée "
            + '(SUPABASE_ANON_KEY manquante côté serveur).';
          return;
        }
        sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
          auth: { detectSessionInUrl: true, persistSession: true, autoRefreshToken: true, flowType: 'pkce' },
        });
        wire();
        route();
      })
      .catch(function () { $('boot').textContent = 'Configuration indisponible.'; });
  }

  function route() {
    if (linkParams.error || linkParams.error_code) {
      $('expired-reason').textContent = raisonFr(linkParams);
      cleanUrl('/partenaires/connexion');
      showAuth('view-expired');
      return;
    }

    if (linkParams.token_hash && linkParams.type) {
      sb.auth.verifyOtp({ token_hash: linkParams.token_hash, type: linkParams.type })
        .then(function (res) {
          cleanUrl('/partenaires');
          if (res.error) { showAuth('view-expired'); return; }
          afterLink(linkParams.type);
        });
      return;
    }

    sb.auth.getSession().then(function (res) {
      var session = res.data.session;
      var type = linkParams.type;
      if (session && (type === 'invite' || type === 'recovery')) { afterLink(type); return; }
      if (session) { openApp(); return; }
      showAuth(viewForPath());
    });
  }

  function afterLink(type) {
    cleanUrl('/partenaires/nouveau-mot-de-passe');
    if (type === 'recovery') {
      $('setpass-title').textContent = 'Choisis un nouveau mot de passe.';
      $('setpass-lede').textContent = 'Ton ancien mot de passe ne fonctionnera plus une fois celui-ci enregistré.';
    }
    showAuth('view-setpass');
  }

  function api(path) {
    return sb.auth.getSession().then(function (res) {
      var s = res.data.session;
      return fetch('/api/v1/partner' + path, {
        headers: { Authorization: 'Bearer ' + (s ? s.access_token : '') },
      }).then(function (r) {
        if (!r.ok) { var e = new Error('api'); e.status = r.status; throw e; }
        return r.json().then(function (j) { return j.data; });
      });
    });
  }

  /* ── Formulaires ─────────────────────────────────────────────────────── */
  function wire() {
    $('form-login').addEventListener('submit', function (e) {
      e.preventDefault();
      var email = $('login-email').value.trim();
      var password = $('login-password').value;
      if (!email || !password) return notice($('login-msg'), 'Renseigne ton email et ton mot de passe.', 'err');
      $('btn-login').disabled = true;
      notice($('login-msg'), '', '');
      sb.auth.signInWithPassword({ email: email, password: password }).then(function (res) {
        $('btn-login').disabled = false;
        if (res.error) {
          notice($('login-msg'),
            'Connexion impossible. Vérifie ton email et ton mot de passe — ou demande un lien de connexion.', 'err');
          return;
        }
        openApp();
      });
    });

    $('form-magic').addEventListener('submit', function (e) {
      e.preventDefault();
      var email = $('magic-email').value.trim();
      if (!email) return notice($('magic-msg'), 'Indique ton email.', 'err');
      $('btn-magic').disabled = true;
      sb.auth.signInWithOtp({
        email: email,
        options: { emailRedirectTo: window.location.origin + '/partenaires' },
      }).then(function (res) {
        $('btn-magic').disabled = false;
        // On ne révèle jamais si l'adresse existe (énumération de comptes).
        notice($('magic-msg'), res.error
          ? 'Envoi impossible pour le moment. Réessaie dans quelques minutes.'
          : "Si cette adresse est celle d'un partenaire, le lien vient de partir. Regarde tes emails (et les indésirables).",
        res.error ? 'err' : 'ok');
      });
    });

    $('form-forgot').addEventListener('submit', function (e) {
      e.preventDefault();
      var email = $('forgot-email').value.trim();
      if (!email) return notice($('forgot-msg'), 'Indique ton email.', 'err');
      $('btn-forgot').disabled = true;
      sb.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/partenaires/nouveau-mot-de-passe',
      }).then(function (res) {
        $('btn-forgot').disabled = false;
        notice($('forgot-msg'), res.error
          ? 'Envoi impossible pour le moment. Réessaie dans quelques minutes.'
          : "Si cette adresse est celle d'un partenaire, l'email est parti. Regarde tes emails (et les indésirables).",
        res.error ? 'err' : 'ok');
      });
    });

    $('set-password').addEventListener('input', function () {
      var v = $('set-password').value;
      var score = 0;
      if (v.length >= 10) score += 1;
      if (v.length >= 14) score += 1;
      if (/[^A-Za-z0-9]/.test(v) || (/[A-Z]/.test(v) && /[0-9]/.test(v))) score += 1;
      var m = $('pw-meter');
      m.className = 'meter-fill' + (score >= 3 ? ' ok' : score === 2 ? ' mid' : '');
      m.style.width = (v.length ? Math.max(12, (score / 3) * 100) : 0) + '%';
    });

    $('form-setpass').addEventListener('submit', function (e) {
      e.preventDefault();
      var p1 = $('set-password').value;
      var p2 = $('set-password2').value;
      if (p1.length < 10) return notice($('setpass-msg'), 'Au moins 10 caractères.', 'err');
      if (p1 !== p2) return notice($('setpass-msg'), 'Les deux mots de passe ne sont pas identiques.', 'err');
      $('btn-setpass').disabled = true;
      sb.auth.updateUser({ password: p1 }).then(function (res) {
        $('btn-setpass').disabled = false;
        if (res.error) {
          notice($('setpass-msg'),
            "Impossible d'enregistrer : ton lien a probablement expiré. Demande-en un nouveau.", 'err');
          return;
        }
        cleanUrl('/partenaires');
        toast('Mot de passe enregistré.', 'ok');
        openApp();
      });
    });

    var deconnecter = function () {
      sb.auth.signOut().then(function () { window.location.href = '/partenaires/connexion'; });
    };
    $('btn-logout').addEventListener('click', deconnecter);
    $('btn-logout-mobile').addEventListener('click', deconnecter);
    $('btn-signout-other').addEventListener('click', deconnecter);

    // Navigation entre sections.
    Array.prototype.forEach.call(document.querySelectorAll('.nav-item'), function (b) {
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(document.querySelectorAll('.nav-item'), function (x) {
          x.classList.remove('nav-on');
        });
        b.classList.add('nav-on');
        var cible = b.dataset.section;
        Array.prototype.forEach.call(document.querySelectorAll('.section'), function (s) {
          s.classList.toggle('hidden', s.dataset.panel !== cible);
        });
        window.scrollTo(0, 0);
      });
    });
  }

  /* ── Courbe (SVG tracé à la main : aucune librairie à charger) ────────── */
  function drawChart(series) {
    var svg = $('chart');
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!series || !series.length) return;

    var W = 640, H = 180, PAD = 8;
    var max = Math.max.apply(null, series.map(function (p) { return p.cents; }));
    if (max <= 0) max = 1;
    var pas = series.length > 1 ? (W - PAD * 2) / (series.length - 1) : 0;
    var y = function (c) { return H - PAD - (c / max) * (H - PAD * 2); };

    var pts = series.map(function (p, i) { return [PAD + i * pas, y(p.cents)]; });

    // Courbe lissée (Catmull-Rom → Bézier) : une ligne brisée ferait « graphique
    // de tableur », pas produit soigné.
    var d = 'M' + pts[0][0].toFixed(1) + ',' + pts[0][1].toFixed(1);
    for (var i = 0; i < pts.length - 1; i += 1) {
      var p0 = pts[i === 0 ? 0 : i - 1], p1 = pts[i], p2 = pts[i + 1];
      var p3 = pts[i + 2] || p2;
      var c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
      var c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += 'C' + c1x.toFixed(1) + ',' + c1y.toFixed(1) + ' ' + c2x.toFixed(1) + ',' + c2y.toFixed(1)
        + ' ' + p2[0].toFixed(1) + ',' + p2[1].toFixed(1);
    }

    var NS = 'http://www.w3.org/2000/svg';
    var el = function (tag, attrs) {
      var n = document.createElementNS(NS, tag);
      Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
      return n;
    };

    var defs = el('defs', {});
    var grad = el('linearGradient', { id: 'aire', x1: '0', x2: '0', y1: '0', y2: '1' });
    grad.appendChild(el('stop', { offset: '0', 'stop-color': '#3A6B63', 'stop-opacity': '.26' }));
    grad.appendChild(el('stop', { offset: '1', 'stop-color': '#3A6B63', 'stop-opacity': '0' }));
    defs.appendChild(grad);
    svg.appendChild(defs);

    [0.33, 0.66].forEach(function (f) {
      svg.appendChild(el('line', { x1: 0, x2: W, y1: (H * f).toFixed(0), y2: (H * f).toFixed(0),
        stroke: 'rgba(20,18,22,.07)', 'stroke-width': '1' }));
    });

    svg.appendChild(el('path', { d: d + 'L' + W + ',' + H + 'L0,' + H + 'Z', fill: 'url(#aire)' }));
    svg.appendChild(el('path', { d: d, fill: 'none', stroke: '#3A6B63', 'stroke-width': '2.4',
      'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));

    var last = pts[pts.length - 1];
    svg.appendChild(el('circle', { cx: last[0], cy: last[1], r: '7', fill: '#3A6B63', 'fill-opacity': '.18' }));
    svg.appendChild(el('circle', { cx: last[0], cy: last[1], r: '3.6', fill: '#3A6B63' }));
  }

  var moisCourt = function (iso) {
    return new Date(iso + 'T00:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  };

  /* ── Chargement de l'espace ──────────────────────────────────────────── */
  function openApp() {
    hide('auth'); hide('app');
    $('boot').textContent = 'Chargement de ton espace…';
    show('boot');

    api('/me').then(function (d) {
      var p = d.partner;
      hide('boot');
      show('app');

      $('d-name').textContent = p.displayName || 'Partenaire';
      var taux = (p.rateBps / 100).toFixed(0) + ' %';
      $('k-rate').textContent = taux;
      $('r-rate').textContent = taux;
      if (p.isFounder) {
        show('d-founder');
        $('k-rate-sub').textContent = 'du revenu net · Fondateur';
      }

      var code = p.code || '—';
      $('d-code').textContent = code;
      var shareMsg = 'Rejoins-moi sur Mbenguiste avec mon code ' + code
        + ' : tu reçois 7 jours en Plus et un Boost offerts.';
      $('share-text').textContent = shareMsg;
      $('btn-copy-code').addEventListener('click', function () { copy(code, 'Code copié.'); });
      $('btn-copy-msg').addEventListener('click', function () { copy(shareMsg, 'Message copié.'); });

      return api('/stats');
    }).then(function (s) {
      $('k-signups').textContent = s.signups;
      $('k-active').textContent = s.activeSubscribers;
      $('k-month').textContent = eur(s.monthCents);
      $('b-pending').textContent = eur(s.balance.pendingCents);
      $('b-valid').textContent = eur(s.balance.validatedCents);
      $('b-paid').textContent = eur(s.balance.paidCents);
      $('p-next').textContent = eur(s.balance.validatedCents);
      $('p-pending').textContent = eur(s.balance.pendingCents);

      if (s.series && s.series.length) {
        drawChart(s.series);
        $('axis-start').textContent = moisCourt(s.series[0].date);
        $('axis-end').textContent = moisCourt(s.series[s.series.length - 1].date);
      }
      if (s.trendPct !== null && s.trendPct !== undefined) {
        var t = $('trend');
        t.textContent = (s.trendPct >= 0 ? '+' : '') + s.trendPct + ' %';
        t.className = 'trend' + (s.trendPct < 0 ? ' down' : '');
      }
      return api('/referrals');
    }).then(function (d) {
      var tb = $('t-referrals');
      tb.innerHTML = '';
      if (!d.referrals.length) show('referrals-empty');
      d.referrals.forEach(function (r) {
        var tr = document.createElement('tr');

        // Membre : pastille d'initiale + pseudonyme masqué. La pastille ne sert
        // qu'au mobile (elle donne le rythme de la liste), masquée en tableau.
        var who = document.createElement('td');
        var ava = document.createElement('span');
        ava.className = 'ava';
        ava.textContent = String(r.member || '?').charAt(0);
        var nom = document.createElement('span');
        nom.className = 'mname';
        nom.textContent = r.member;
        who.appendChild(ava);
        who.appendChild(nom);
        tr.appendChild(who);

        tr.appendChild(cell(new Date(r.attributedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })));

        // Cellules VIDES quand la donnée n'existe pas — jamais un « — » posé dans
        // le texte : sur mobile on masque la cellule (un tiret orphelin au milieu
        // d'une ligne ne veut rien dire), en tableau le CSS remet le tiret.
        tr.appendChild(cell(TIERS[r.tier] || ''));

        var st = document.createElement('td');
        var pill = document.createElement('span');
        pill.className = 'pill ' + (r.active ? 'pill-ok' : 'pill-off');
        pill.textContent = r.active ? 'Abonné' : 'Inscrit';
        st.appendChild(pill);
        tr.appendChild(st);

        var part = cell(r.shareCents ? '+' + eur(r.shareCents) : '');
        part.className = 'tright tnum part';
        tr.appendChild(part);
        tb.appendChild(tr);
      });
      return api('/payouts');
    }).then(function (d) {
      var pb = $('t-payouts');
      pb.innerHTML = '';
      if (!d.payouts.length) show('payouts-empty');
      d.payouts.forEach(function (p) {
        var tr = document.createElement('tr');
        tr.appendChild(cell(new Date(p.paidAt).toLocaleDateString('fr-FR',
          { day: 'numeric', month: 'short', year: 'numeric' })));
        tr.appendChild(cell(p.method || 'Versement manuel'));
        tr.appendChild(cell(p.reference || '—'));
        var amt = cell(eur(p.amountCents));
        amt.className = 'tright tnum';
        tr.appendChild(amt);
        pb.appendChild(tr);
      });
    }).catch(function (e) {
      hide('boot');
      hide('app');
      if (e && e.status === 403) { showAuth('view-notpartner'); return; }
      if (e && e.status === 401) { showAuth('view-login'); return; }
      showAuth('view-login');
      notice($('login-msg'), 'Impossible de charger ton espace pour le moment.', 'err');
    });
  }

  function cell(text) { var td = document.createElement('td'); td.textContent = text; return td; }

  function copy(text, done) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(function () { toast(done, 'ok'); },
        function () { toast('Copie impossible.', 'err'); });
    } else { toast('Copie impossible sur ce navigateur.', 'err'); }
  }

  boot();
})();
