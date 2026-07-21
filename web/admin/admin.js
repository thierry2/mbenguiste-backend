/* ═══════════════════════════════════════════════════════════════════════════
   Console interne Mbenguiste — modération + partenaires.

   Sécurité de cette page :
   • le SECRET ne circule qu'une fois (POST /admin/session) et n'est jamais
     stocké ; seul un jeton court vit en sessionStorage (mort à la fermeture) ;
   • tout le contenu affiché est posé en textContent, JAMAIS en innerHTML : cette
     console affiche des récits écrits par des utilisatrices, donc du texte
     hostile potentiel. Aucune chaîne de données ne devient du HTML ;
   • toute action irréversible passe par une confirmation explicite.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var show = function (id) { $(id).classList.remove('hidden'); };
  var hide = function (id) { $(id).classList.add('hidden'); };
  var KEY = 'mb_admin_token';

  var tab = 'dossiers';
  var GRAVITE_LABEL = { critique: 'Critique', eleve: 'Élevé', standard: 'Standard' };
  var ACTION_LABEL = { retirer: 'Retirer de la découverte', restaurer: 'Restaurer', rejeter: 'Rejeter' };

  /* ── Petits utilitaires DOM (tout en textContent) ─────────────────────── */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function toast(text, kind) {
    var t = el('div', 'toast' + (kind ? ' toast-' + kind : ''), text);
    $('toasts').appendChild(t);
    setTimeout(function () { t.remove(); }, 5600);
  }
  function notice(zone, text, kind) {
    zone.innerHTML = '';
    if (text) zone.appendChild(el('div', 'notice notice-' + (kind || 'err'), text));
  }
  function dateFr(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('fr-FR',
      { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  var eur = function (c) {
    return (Number(c || 0) / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
  };

  /* ── Confirmation ─────────────────────────────────────────────────────── */
  function confirmer(titre, texte, libelle) {
    return new Promise(function (resolve) {
      $('modal-title').textContent = titre;
      $('modal-text').textContent = texte;
      $('modal-ok').textContent = libelle || 'Confirmer';
      show('modal');
      var done = function (v) {
        hide('modal');
        $('modal-ok').onclick = null;
        $('modal-cancel').onclick = null;
        resolve(v);
      };
      $('modal-ok').onclick = function () { done(true); };
      $('modal-cancel').onclick = function () { done(false); };
    });
  }

  /* ── Session ──────────────────────────────────────────────────────────── */
  function token() { return sessionStorage.getItem(KEY) || ''; }

  function api(path, opts) {
    opts = opts || {};
    return fetch('/api/v1/admin' + path, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (r) {
      if (r.status === 401) {
        sessionStorage.removeItem(KEY);
        ouvrirGate("Ta session a expiré. Ouvre-la à nouveau.");
        var e = new Error('unauthorized'); e.handled = true; throw e;
      }
      return r.json().then(function (j) {
        if (!r.ok || j.success === false) throw new Error(j.message || ('HTTP ' + r.status));
        return j.data;
      });
    });
  }

  function ouvrirGate(message) {
    hide('console'); show('gate');
    if (message) notice($('gate-msg'), message, 'wait');
    $('gate-secret').focus();
  }

  $('form-gate').addEventListener('submit', function (e) {
    e.preventDefault();
    var secret = $('gate-secret').value;
    if (!secret) return notice($('gate-msg'), 'Entre le secret.', 'err');
    $('btn-gate').disabled = true;
    notice($('gate-msg'), '', '');
    fetch('/api/v1/admin/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: secret }),
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, j: j }; });
    }).then(function (res) {
      $('btn-gate').disabled = false;
      if (!res.ok || !res.j.data || !res.j.data.token) {
        notice($('gate-msg'), res.j.message || 'Secret refusé.', 'err');
        return;
      }
      sessionStorage.setItem(KEY, res.j.data.token);
      $('gate-secret').value = '';
      entrer();
    }).catch(function () {
      $('btn-gate').disabled = false;
      notice($('gate-msg'), 'Serveur injoignable.', 'err');
    });
  });

  $('btn-close-session').addEventListener('click', function () {
    sessionStorage.removeItem(KEY);
    ouvrirGate('Session fermée.');
  });
  $('btn-refresh').addEventListener('click', function () { charger(); });

  function entrer() { hide('gate'); show('console'); charger(); }

  /* ── Onglets & filtre ─────────────────────────────────────────────────── */
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
    t.addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (x) {
        x.classList.remove('tab-on');
      });
      t.classList.add('tab-on');
      tab = t.dataset.tab;
      var partenaires = tab === 'partenaires';
      var graphes = tab === 'graphes';
      // Le filtre « à traiter / traités » ne parle que des dossiers de modération.
      // La file de vérification n'a qu'un seul état visible : ce qui attend une décision.
      var moderation = tab === 'dossiers' || tab === 'libres';
      $('filters').classList.toggle('hidden', !moderation);
      $('panel-partners').classList.toggle('hidden', !partenaires);
      $('stats').classList.toggle('hidden', partenaires || graphes);
      charger();
    });
  });
  $('status').addEventListener('change', charger);

  /* ── Chargement ───────────────────────────────────────────────────────── */
  function squelette(n) {
    var box = el('div', 'card');
    for (var i = 0; i < (n || 3); i += 1) {
      var row = el('div', 'skel-row');
      row.appendChild(el('div', 'skeleton'));
      row.appendChild(el('div', 'skeleton'));
      box.appendChild(row);
    }
    $('out').innerHTML = '';
    $('out').appendChild(box);
  }

  function vide(titre, sous) {
    var box = el('div', 'card empty');
    box.appendChild(el('p', 'empty-title', titre));
    box.appendChild(el('p', 'empty-sub', sous));
    $('out').innerHTML = '';
    $('out').appendChild(box);
  }

  function erreur(msg) {
    $('out').innerHTML = '';
    var box = el('div', 'card card-pad');
    notice(box, msg, 'err');
    $('out').appendChild(box);
  }

  function charger() {
    if (!token()) return ouvrirGate();
    revoquerBlobs(); // les images de la vue précédente ne servent plus
    squelette();
    if (tab === 'partenaires') return chargerPartenaires();
    if (tab === 'graphes') return chargerGraphes();

    api('/moderation/counts').then(function (c) {
      $('s-dossiers').textContent = c.dossiers;
      $('s-signalements').textContent = c.signalements;
      $('s-libres').textContent = c.dossiersLibres;
    }).catch(function () { /* les compteurs ne doivent pas bloquer la liste */ });

    api('/verifications/count').then(function (c) {
      $('s-verifs').textContent = c.enAttente;
    }).catch(function () { /* idem */ });

    if (tab === 'verifications') return chargerVerifications();

    var statut = $('status').value;
    if (tab === 'dossiers') {
      api('/moderation/dossiers?status=' + statut)
        .then(function (d) { rendreDossiers(d.dossiers || []); })
        .catch(function (e) { if (!e.handled) erreur('Chargement impossible : ' + e.message); });
    } else {
      api('/moderation/dossiers-libres?status=' + statut)
        .then(function (d) { rendreLibres(d.dossiers || []); })
        .catch(function (e) { if (!e.handled) erreur('Chargement impossible : ' + e.message); });
    }
  }

  /* ── Dossiers (par personne) ──────────────────────────────────────────── */
  function rendreDossiers(dossiers) {
    if (!dossiers.length) {
      return vide('Rien à traiter', 'Aucun dossier ne correspond à ce filtre.');
    }
    var frag = document.createDocumentFragment();

    dossiers.forEach(function (d) {
      var card = el('div', 'card dossier');

      var head = el('div', 'dossier-head');
      head.appendChild(el('div', 'grav grav-' + d.gravite));

      var id = el('div', 'dossier-id');
      var nom = el('p', 'dossier-name', d.prenom);
      id.appendChild(nom);
      var meta = d.signalants + (d.signalants > 1 ? ' personnes distinctes' : ' personne')
        + ' · dernier signalement ' + dateFr(d.dernierLe);
      id.appendChild(el('p', 'dossier-meta', meta));

      var motifs = el('div', 'motifs');
      motifs.appendChild(el('span', 'pill ' + (d.gravite === 'critique' ? 'pill-danger'
        : d.gravite === 'eleve' ? 'pill-wait' : 'pill-off'), GRAVITE_LABEL[d.gravite] || d.gravite));
      if (d.dejaRetire) motifs.appendChild(el('span', 'pill pill-wait', 'Déjà retiré'));
      (d.motifs || []).forEach(function (m) {
        motifs.appendChild(el('span', 'pill pill-off', m.code + (m.nombre > 1 ? ' ×' + m.nombre : '')));
      });
      id.appendChild(motifs);
      head.appendChild(id);
      card.appendChild(head);

      // Les signalements, texte brut inclus.
      var liste = el('div', 'signalements');
      (d.signalements || []).forEach(function (s) {
        var sig = el('div', 'sig');
        var sh = el('div', 'sig-head');
        sh.appendChild(el('span', 'sig-motif', s.motifLabel || s.motif));
        sh.appendChild(el('span', 'sig-date', dateFr(s.le)));
        if (s.statut && s.statut !== 'open') sh.appendChild(el('span', 'pill pill-off', s.statut));
        sig.appendChild(sh);
        if (s.details) sig.appendChild(el('p', 'sig-details', s.details));
        liste.appendChild(sig);
      });
      card.appendChild(liste);

      // Actions
      var bar = el('div', 'actions-bar');
      var note = document.createElement('input');
      note.type = 'text';
      note.placeholder = 'Note de décision (facultative, conservée)';
      bar.appendChild(note);

      ['retirer', 'restaurer', 'rejeter'].forEach(function (action) {
        var cls = action === 'retirer' ? 'btn-danger' : action === 'restaurer' ? 'btn-ok' : 'btn';
        var b = el('button', cls + ' btn-sm', ACTION_LABEL[action]);
        b.addEventListener('click', function () {
          var texte = action === 'retirer'
            ? 'Le profil de ' + d.prenom + ' sortira de la découverte et tous ses signalements ouverts seront clos. Réversible.'
            : action === 'restaurer'
              ? d.prenom + ' réapparaîtra dans la découverte et le dossier sera clos.'
              : 'Le dossier de ' + d.prenom + ' sera clos sans action sur son profil.';
          confirmer(ACTION_LABEL[action] + ' ?', texte, ACTION_LABEL[action]).then(function (ok) {
            if (!ok) return;
            b.disabled = true;
            api('/moderation/dossiers/' + d.profileId, {
              method: 'POST', body: { action: action, note: note.value || null },
            }).then(function () {
              toast('Dossier traité : ' + ACTION_LABEL[action].toLowerCase() + '.', 'ok');
              charger();
            }).catch(function (e) {
              b.disabled = false;
              if (!e.handled) toast('Échec : ' + e.message, 'err');
            });
          });
        });
        bar.appendChild(b);
      });
      card.appendChild(bar);
      frag.appendChild(card);
    });

    $('out').innerHTML = '';
    $('out').appendChild(frag);
  }

  /* ── Dossiers libres (récits) ─────────────────────────────────────────── */
  function rendreLibres(dossiers) {
    if (!dossiers.length) {
      return vide('Aucun dossier libre', 'Personne n\'a écrit de récit pour ce filtre.');
    }
    var frag = document.createDocumentFragment();

    dossiers.forEach(function (f) {
      var card = el('div', 'card dossier');

      var head = el('div', 'dossier-head');
      head.appendChild(el('div', 'grav grav-eleve'));
      var id = el('div', 'dossier-id');
      id.appendChild(el('p', 'dossier-name', f.signalantePrenom || 'Anonyme'));
      id.appendChild(el('p', 'dossier-meta', 'Écrit le ' + dateFr(f.le)));
      if (f.statut && f.statut !== 'open') {
        var m = el('div', 'motifs');
        m.appendChild(el('span', 'pill pill-off', 'Traité'));
        id.appendChild(m);
      }
      head.appendChild(id);
      card.appendChild(head);

      var corps = el('div', 'sig');
      corps.appendChild(el('p', 'recit', f.texte || ''));
      card.appendChild(corps);

      if (f.statut === 'open') {
        var bar = el('div', 'actions-bar');
        var note = document.createElement('input');
        note.type = 'text';
        note.placeholder = 'Note de décision (facultative, conservée)';
        bar.appendChild(note);
        [['retirer', 'btn-danger'], ['rejeter', 'btn']].forEach(function (pair) {
          var b = el('button', pair[1] + ' btn-sm', ACTION_LABEL[pair[0]]);
          b.addEventListener('click', function () {
            confirmer(ACTION_LABEL[pair[0]] + ' ?',
              'Ce récit sera clos et ta note conservée.', ACTION_LABEL[pair[0]]).then(function (ok) {
              if (!ok) return;
              b.disabled = true;
              api('/moderation/dossiers-libres/' + f.id, {
                method: 'POST', body: { action: pair[0], note: note.value || null },
              }).then(function () { toast('Récit traité.', 'ok'); charger(); })
                .catch(function (e) { b.disabled = false; if (!e.handled) toast('Échec : ' + e.message, 'err'); });
            });
          });
          bar.appendChild(b);
        });
        card.appendChild(bar);
      } else if (f.note || f.traiteLe) {
        card.appendChild(el('div', 'treated',
          'Traité le ' + dateFr(f.traiteLe) + (f.note ? ' — « ' + f.note + ' »' : '')));
      }

      frag.appendChild(card);
    });

    $('out').innerHTML = '';
    $('out').appendChild(frag);
  }

  /* ── Vérifications par selfie ─────────────────────────────────────────── */
  // Le geste attendu : comparer le selfie (pose imposée, tirée au hasard par le
  // serveur) aux photos du profil. Deux questions, une seule décision :
  //   1. est-ce la même personne que sur les photos ?
  //   2. la pose demandée est-elle bien faite ?
  // Si l'une des deux est non → refuser avec un motif, qui s'affiche dans l'app.
  function chargerVerifications() {
    api('/verifications').then(function (d) { rendreVerifications(d.demandes || []); })
      .catch(function (e) { if (!e.handled) erreur('Chargement impossible : ' + e.message); });
  }

  var MOTIFS_REFUS = [
    'Le visage n\'est pas visible',
    'La pose demandée n\'est pas respectée',
    'Photo floue ou trop sombre',
    'Ce n\'est pas la même personne que sur le profil',
    'Photo d\'écran ou photo d\'une photo',
  ];

  function rendreVerifications(demandes) {
    if (!demandes.length) {
      return vide('Aucune vérification en attente', 'La file est vide — tout est traité.');
    }
    var frag = document.createDocumentFragment();

    demandes.forEach(function (v) {
      var card = el('div', 'card dossier');

      // En-tête : qui, quelle tentative, depuis quand.
      var head = el('div', 'dossier-head');
      // Avatar : la 1re photo du profil D'ABORD, `avatar_url` seulement en repli.
      // `avatar_url` est figé à l'ajout de la toute première photo et n'est pas
      // remis à jour quand elle est supprimée : il pointe donc régulièrement sur
      // un fichier qui n'existe plus. C'était ça, la pastille cassée en haut.
      head.appendChild(photoOuPastille((v.photos || [])[0] || v.avatarUrl, 'verif-avatar'));

      var id = el('div', 'dossier-id');
      id.appendChild(el('p', 'dossier-name', v.prenom || 'Sans prénom'));
      id.appendChild(el('p', 'dossier-meta',
        'Envoyé le ' + dateFr(v.soumisLe)
        + (v.tentative > 1 ? ' · tentative n° ' + v.tentative : '')));
      if (v.dejaVerifiee) {
        var pills = el('div', 'motifs');
        pills.appendChild(el('span', 'pill pill-off', 'Déjà vérifiée'));
        id.appendChild(pills);
      }
      head.appendChild(id);
      card.appendChild(head);

      // La consigne imposée — sans elle, impossible de juger la pose.
      var consigne = el('div', 'verif-consigne');
      consigne.appendChild(el('p', 'verif-consigne-lab', 'Pose demandée'));
      consigne.appendChild(el('p', 'verif-consigne-txt', v.poseInstruction));
      if (v.poseHint) consigne.appendChild(el('p', 'verif-consigne-hint', v.poseHint));
      card.appendChild(consigne);

      // Face à face : le selfie à gauche, les photos du profil à droite.
      var duel = el('div', 'verif-duel');

      var gauche = el('div', 'verif-col');
      gauche.appendChild(el('p', 'verif-col-lab', 'Selfie de vérification'));
      if (v.aSelfie) {
        // Squelette pendant le téléchargement. Contrairement aux photos du
        // profil (<img src> direct, peintes au fil des octets), le selfie passe
        // par un fetch authentifié : rien ne s'affiche tant que le fichier
        // entier n'est pas là. Sans ce repère, l'attente ressemble à une panne.
        var attente = el('div', 'verif-selfie skeleton');
        gauche.appendChild(attente);
        chargerSelfie(v.id, attente, gauche);
      } else {
        // Aucun fichier attaché. On affiche la ligne au lieu de la masquer :
        // une demande invisible resterait « en attente » pour toujours.
        gauche.appendChild(el('p', 'verif-missing',
          'Aucun selfie attaché. Refuse la demande : la personne pourra recommencer.'));
      }
      duel.appendChild(gauche);

      var droite = el('div', 'verif-col');
      droite.appendChild(el('p', 'verif-col-lab', 'Photos du profil'));
      var grille = el('div', 'verif-photos');
      (v.photos || []).forEach(function (url) {
        var p = photoOuPastille(url, 'verif-photo');
        if (p.tagName === 'IMG') {
          p.addEventListener('click', function () { window.open(url, '_blank', 'noopener'); });
        }
        grille.appendChild(p);
      });
      if (!(v.photos || []).length) {
        grille.appendChild(el('p', 'verif-missing', 'Aucune photo de profil à comparer.'));
      }
      droite.appendChild(grille);
      duel.appendChild(droite);
      card.appendChild(duel);

      // Décision : valider, ou refuser avec un motif (obligatoire côté serveur).
      var bar = el('div', 'actions-bar');
      var motif = document.createElement('select');
      motif.className = 'verif-motif';
      var vide0 = document.createElement('option');
      vide0.value = '';
      vide0.textContent = 'Motif de refus…';
      motif.appendChild(vide0);
      MOTIFS_REFUS.forEach(function (m) {
        var o = document.createElement('option');
        o.value = m; o.textContent = m;
        motif.appendChild(o);
      });
      bar.appendChild(motif);

      var refuser = el('button', 'btn-danger btn-sm', 'Refuser');
      refuser.addEventListener('click', function () {
        if (!motif.value) return toast('Choisis un motif de refus.', 'err');
        confirmer('Refuser la vérification ?',
          'La personne verra ce motif et pourra recommencer avec une NOUVELLE pose.',
          'Refuser').then(function (ok) {
          if (!ok) return;
          decider(v, card, 'refuser', motif.value);
        });
      });
      bar.appendChild(refuser);

      var valider = el('button', 'btn-accent btn-sm', 'Valider');
      valider.addEventListener('click', function () {
        confirmer('Valider la vérification ?',
          'Le sceau « vérifié » sera accordé à ' + (v.prenom || 'cette personne') + '.',
          'Valider').then(function (ok) {
          if (!ok) return;
          decider(v, card, 'valider', null);
        });
      });
      bar.appendChild(valider);
      card.appendChild(bar);

      frag.appendChild(card);
    });

    $('out').innerHTML = '';
    $('out').appendChild(frag);
  }

  /**
   * Une image de profil, ou une pastille neutre si elle manque OU si elle casse.
   *
   * Le `onerror` n'est pas décoratif : les URL de photos peuvent pointer sur un
   * fichier supprimé. Sans lui, le navigateur affiche son icône « image
   * cassée », qui donne l'air d'une panne de la console alors que c'est une
   * donnée périmée. Une pastille grise dit la même chose sans accuser à tort.
   */
  function photoOuPastille(url, classe) {
    if (!url) return el('div', classe);
    var img = document.createElement('img');
    img.className = classe;
    img.alt = '';
    img.addEventListener('error', function () {
      var vide = el('div', classe);
      if (img.parentNode) img.parentNode.replaceChild(vide, img);
    });
    img.src = url;
    return img;
  }

  // Les blobs posés dans le DOM tiennent la mémoire tant qu'on ne les révoque
  // pas. La file se recharge à chaque décision : sans ce ménage, une session de
  // modération d'une heure accumulerait toutes les photos jamais affichées.
  var blobsPoses = [];
  function revoquerBlobs() {
    blobsPoses.forEach(function (u) { URL.revokeObjectURL(u); });
    blobsPoses = [];
  }

  /**
   * Récupère le selfie en fetch AUTHENTIFIÉ, puis le pose en blob.
   *
   * Pourquoi pas une simple URL dans le src : la CSP de la console interdit
   * toute origine externe (`img-src 'self' data: blob:`), et surtout une URL
   * signée déposée dans le DOM est copiable — elle ouvrirait une photo
   * biométrique sans aucune authentification jusqu'à son expiration.
   */
  function chargerSelfie(id, attente, zone) {
    fetch('/api/v1/admin/verifications/' + id + '/selfie', {
      headers: { Authorization: 'Bearer ' + token() },
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.blob();
    }).then(function (blob) {
      var url = URL.createObjectURL(blob);
      blobsPoses.push(url);

      var img = document.createElement('img');
      img.className = 'verif-selfie';
      img.alt = 'Selfie de vérification';
      // On ne remplace le squelette qu'une fois l'image DÉCODÉE : l'échanger
      // dès l'affectation du src laisserait un cadre blanc le temps du décodage.
      img.addEventListener('load', function () {
        if (attente.parentNode) attente.parentNode.replaceChild(img, attente);
      });
      // Plein écran au clic : juger une pose sur une vignette est impossible.
      img.addEventListener('click', function () { window.open(url, '_blank', 'noopener'); });
      img.src = url;
    }).catch(function () {
      // Fichier effacé, storage injoignable : on le DIT, sinon l'admin reste
      // devant un squelette qui tourne sans savoir s'il doit attendre ou trancher.
      attente.remove();
      zone.appendChild(el('p', 'verif-missing',
        'Selfie illisible. Refuse la demande : la personne pourra recommencer.'));
    });
  }

  function decider(v, card, action, motif) {
    Array.prototype.forEach.call(card.querySelectorAll('button'), function (b) { b.disabled = true; });
    api('/verifications/' + v.id, { method: 'POST', body: { action: action, motif: motif } })
      .then(function () {
        toast(action === 'valider' ? 'Profil vérifié.' : 'Vérification refusée.', 'ok');
        charger();
      })
      .catch(function (e) {
        Array.prototype.forEach.call(card.querySelectorAll('button'), function (b) { b.disabled = false; });
        if (!e.handled) toast('Échec : ' + e.message, 'err');
      });
  }

  /* ── Partenaires ──────────────────────────────────────────────────────── */
  function chargerPartenaires() {
    api('/partners').then(function (d) { rendrePartenaires(d.partners || []); })
      .catch(function (e) { if (!e.handled) erreur('Chargement impossible : ' + e.message); });
  }

  function rendrePartenaires(partners) {
    if (!partners.length) {
      return vide('Aucun partenaire', 'Invite ton premier créateur avec le formulaire ci-dessus.');
    }
    var card = el('div', 'card');

    partners.forEach(function (p) {
      var gele = p.status === 'frozen';
      var row = el('div', 'partner');

      var id = el('div', 'partner-id');
      var nom = el('p', 'partner-name');
      nom.appendChild(document.createTextNode(p.displayName));
      if (p.isFounder) nom.appendChild(el('span', 'pill pill-ok', 'Fondateur'));
      nom.appendChild(el('span', 'pill ' + (gele ? 'pill-danger'
        : p.status === 'active' ? 'pill-ok' : 'pill-wait'),
      gele ? 'Gelé' : p.status === 'active' ? 'Actif' : 'Invité'));
      id.appendChild(nom);

      var meta = el('p', 'partner-meta');
      meta.appendChild(document.createTextNode(p.email + ' · code '));
      meta.appendChild(el('b', null, p.code || '—'));
      meta.appendChild(document.createTextNode(' · ' + (p.rateBps / 100) + ' %'));
      id.appendChild(meta);
      row.appendChild(id);

      var actions = el('div', 'partner-actions');

      var reinv = el('button', 'btn btn-sm', 'Réinviter');
      reinv.addEventListener('click', function () {
        reinv.disabled = true;
        // Aucune URL envoyée : c'est le serveur (PUBLIC_BASE_URL) qui décide où
        // le lien ramène. Inviter depuis une console locale ne fabrique donc plus
        // un lien vers localhost.
        api('/partners/' + p.id + '/invite', { method: 'POST', body: {} }).then(function (d) {
          reinv.disabled = false;
          if (d.invited) {
            toast('Invitation renvoyée à ' + d.email + '.'
              + (d.redirectTo ? '\nLe lien ramènera sur : ' + d.redirectTo
                : '\n⚠ PUBLIC_BASE_URL non définie : Supabase utilisera son « Site URL ».'), 'ok');
            return;
          }
          toast('Invitation NON envoyée.\nRaison : ' + (d.inviteError || 'inconnue')
            + '\nPistes : SMTP non configuré dans Supabase, URL de retour non autorisée, ou email déjà inscrit.',
          'err');
        }).catch(function (e) { reinv.disabled = false; if (!e.handled) toast('Échec : ' + e.message, 'err'); });
      });
      actions.appendChild(reinv);

      var verser = el('button', 'btn-ok btn-sm', 'Verser');
      verser.addEventListener('click', function () {
        confirmer('Enregistrer un versement ?',
          'Toutes les commissions validées de ' + p.displayName
          + ' seront marquées « versées ». À ne faire qu\'une fois le virement réellement effectué.',
          'Marquer versé').then(function (ok) {
          if (!ok) return;
          verser.disabled = true;
          api('/partners/' + p.id + '/payout', { method: 'POST', body: { method: 'Versement manuel' } })
            .then(function (d) {
              verser.disabled = false;
              toast(d.count
                ? 'Versé : ' + eur(d.amountCents) + ' (' + d.count + ' commissions).'
                : 'Rien à verser pour l\'instant.', d.count ? 'ok' : null);
              chargerPartenaires();
            }).catch(function (e) { verser.disabled = false; if (!e.handled) toast('Échec : ' + e.message, 'err'); });
        });
      });
      actions.appendChild(verser);

      var bascule = el('button', (gele ? 'btn-ok' : 'btn-danger') + ' btn-sm', gele ? 'Réactiver' : 'Geler');
      bascule.addEventListener('click', function () {
        confirmer(gele ? 'Réactiver ce partenaire ?' : 'Geler ce partenaire ?',
          gele ? 'Son accès au portail et ses commissions reprennent.'
            : 'Son accès au portail est coupé et ses nouvelles commissions cessent d\'être comptées. Réversible.',
          gele ? 'Réactiver' : 'Geler').then(function (ok) {
          if (!ok) return;
          bascule.disabled = true;
          api('/partners/' + p.id, { method: 'PATCH', body: { status: gele ? 'active' : 'frozen' } })
            .then(function () { toast(gele ? 'Partenaire réactivé.' : 'Partenaire gelé.', 'ok'); chargerPartenaires(); })
            .catch(function (e) { bascule.disabled = false; if (!e.handled) toast('Échec : ' + e.message, 'err'); });
        });
      });
      actions.appendChild(bascule);

      row.appendChild(actions);
      card.appendChild(row);
    });

    $('out').innerHTML = '';
    $('out').appendChild(card);
  }

  $('p-create').addEventListener('click', function () {
    var nom = $('p-name').value.trim();
    var email = $('p-email').value.trim();
    if (!nom || !email) return toast('Nom et email sont requis.', 'err');
    var body = { displayName: nom, email: email, isFounder: $('p-founder').checked };
    if ($('p-code').value.trim()) body.code = $('p-code').value.trim();
    if ($('p-rate').value) body.rateBps = Math.round(Number($('p-rate').value) * 100);

    $('p-create').disabled = true;
    api('/partners', { method: 'POST', body: body }).then(function (d) {
      $('p-create').disabled = false;
      ['p-name', 'p-email', 'p-code', 'p-rate'].forEach(function (i) { $(i).value = ''; });
      $('p-founder').checked = false;
      if (d.invited) {
        toast('Partenaire créé (code ' + d.partner.code + ').\nInvitation envoyée par email.', 'ok');
      } else {
        toast('Partenaire créé (code ' + d.partner.code + ') — mais l\'invitation N\'EST PAS partie.\n'
          + 'Raison : ' + (d.inviteError || 'inconnue') + '\nUtilise « Réinviter » une fois la cause corrigée.', 'err');
      }
      chargerPartenaires();
    }).catch(function (e) {
      $('p-create').disabled = false;
      if (!e.handled) toast('Création impossible : ' + e.message, 'err');
    });
  });

  /* ── Démarrage ────────────────────────────────────────────────────────── */

  // Hygiène : l'ANCIENNE console stockait le secret admin EN CLAIR dans
  // localStorage, de façon permanente. Il y dort encore dans les navigateurs qui
  // l'ont utilisée. On l'efface au premier passage ici — le laisser traîner
  // annulerait tout le bénéfice du jeton de session.
  try {
    ['mb_admin_secret', 'mb_admin_api'].forEach(function (k) {
      if (localStorage.getItem(k) !== null) localStorage.removeItem(k);
    });
  } catch (e) { /* stockage indisponible : rien à purger */ }

  /* ── Graphes d'aventure (éditeur) ─────────────────────────────────────── */
  // Un graphe modèle valide (nœuds + routage + clips) pour partir d'une base.
  var TEMPLATE_GRAPHE = {
    start: 'n1',
    nodes: {
      n1: { kind: 'epreuve', ambiance: 'grotte', question: 'Un guide sort de l’ombre. Qui suivez-vous ?', options: ['Alain', 'Richard'], clip: 'n1',
        accord: { survie: { next: 'n2', clip: 'n1_succes' }, mort: { next: 'fin_mort', clip: 'n1_mort' } },
        desaccord: { maxTours: 6, clip: 'n1_reprise', mort: 'fin_desaccord' } },
      n2: { kind: 'intime', ambiance: 'nuit', question: 'Où iriez-vous ensemble ?', clip: 'n2', reveal: 'aveu', next: 'n2b' },
      n2b: { kind: 'consentement', ambiance: 'nuit', question: 'Après ça… vous continuez l’aventure ensemble ?', options: ['On continue', 'On s’arrête là'], clip: 'n2b', oui: 'n3', non: 'fin_separes' },
      n3: { kind: 'epreuve', ambiance: 'nuit', question: 'Le sol s’effondre. Vous sautez… ensemble ?', options: ['On saute', 'On attend'], clip: 'n3',
        accord: { survie: { next: 'fin_plage', clip: 'n3_succes' }, mort: { next: 'fin_mort', clip: 'n3_mort' } },
        desaccord: { maxTours: 6, clip: 'n3_reprise', mort: 'fin_desaccord' } },
      fin_plage: { kind: 'end', end: 'match', reveal: 'visage' },
      fin_mort: { kind: 'end', end: 'echec' },
      fin_desaccord: { kind: 'end', end: 'echec' },
      fin_separes: { kind: 'end', end: 'left' }
    }
  };

  function champ(id, label, placeholder) {
    var wrap = el('div', 'field mt14');
    wrap.appendChild(el('label', null, label));
    var input = el('input');
    input.id = id; input.autocomplete = 'off';
    if (placeholder) input.placeholder = placeholder;
    wrap.appendChild(input);
    return wrap;
  }

  function chargerGraphes() {
    api('/graphs')
      .then(function (d) { rendreEditeurGraphe(d.graphs || []); })
      .catch(function (e) { if (!e.handled) erreur('Chargement impossible : ' + e.message); });
  }

  function rendreEditeurGraphe(graphs) {
    $('out').innerHTML = '';
    var box = el('div', 'card card-pad');
    box.appendChild(el('h2', null, 'Graphes d’aventure'));
    box.appendChild(el('p', 'hint', 'Le graphe pilote le routage (serveur) et la présentation (clips, questions). Enregistré ici, il remplace le graphe en dur — validé avant écriture. La clé « clip » d’un nœud est l’identifiant de sa vidéo.'));

    var row = el('div', 'row mt14');
    var sel = el('select'); sel.id = 'g-select';
    var optNew = el('option', null, '➕ Nouveau graphe'); optNew.value = '__new__'; sel.appendChild(optNew);
    graphs.forEach(function (g) {
      var o = el('option', null, g.id + (g.title ? ' — ' + g.title : '')); o.value = g.id; sel.appendChild(o);
    });
    row.appendChild(sel);
    box.appendChild(row);

    box.appendChild(champ('g-id', 'Identifiant', 'grotte-ci'));
    box.appendChild(champ('g-title', 'Titre', 'Grotte de Yamoussoukro'));

    var taWrap = el('div', 'field mt14');
    taWrap.appendChild(el('label', null, 'Graphe (JSON) — nœuds, routage, clips'));
    var ta = el('textarea'); ta.id = 'g-json'; ta.rows = 22; ta.spellcheck = false;
    ta.style.width = '100%'; ta.style.fontFamily = 'ui-monospace, monospace'; ta.style.fontSize = '12px';
    taWrap.appendChild(ta);
    box.appendChild(taWrap);

    var msg = el('div', 'msgzone'); msg.id = 'g-msg'; box.appendChild(msg);

    var actions = el('div', 'row mt14');
    actions.appendChild(el('span', 'spacer'));
    var save = el('button', 'btn-accent', 'Enregistrer'); save.id = 'g-save';
    actions.appendChild(save);
    box.appendChild(actions);

    $('out').appendChild(box);

    // Nouveau graphe par défaut.
    ta.value = JSON.stringify(TEMPLATE_GRAPHE, null, 2);

    sel.addEventListener('change', function () {
      notice($('g-msg'), '', '');
      if (sel.value === '__new__') {
        $('g-id').value = ''; $('g-title').value = ''; ta.value = JSON.stringify(TEMPLATE_GRAPHE, null, 2);
        return;
      }
      api('/graphs/' + encodeURIComponent(sel.value)).then(function (d) {
        $('g-id').value = d.graph.id;
        $('g-title').value = d.graph.title || '';
        ta.value = JSON.stringify(d.graph.data, null, 2);
      }).catch(function (e) { if (!e.handled) notice($('g-msg'), e.message, 'err'); });
    });

    save.addEventListener('click', function () {
      var id = $('g-id').value.trim();
      if (!id) return notice($('g-msg'), 'Donne un identifiant (ex. grotte-ci).', 'err');
      var data;
      try { data = JSON.parse(ta.value); }
      catch (e) { return notice($('g-msg'), 'JSON invalide : ' + e.message, 'err'); }
      save.disabled = true; notice($('g-msg'), '', '');
      api('/graphs/' + encodeURIComponent(id), { method: 'PUT', body: { title: $('g-title').value.trim() || null, data: data } })
        .then(function () { save.disabled = false; toast('Graphe enregistré : ' + id, 'ok'); chargerGraphes(); })
        .catch(function (e) { save.disabled = false; if (!e.handled) notice($('g-msg'), e.message, 'err'); });
    });
  }

  if (token()) entrer(); else ouvrirGate();
})();
