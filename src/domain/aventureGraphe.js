'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// LE GRAPHE D'AVENTURE — côté serveur, la partie ROUTAGE uniquement.
//
// Le serveur est autoritaire sur la RÉSOLUTION (décision produit 20/07) : c'est
// lui qui, à partir des deux réponses, dit où l'on va. Il n'a donc besoin QUE du
// routage (quel nœud suit quelle combinaison, quel indice se gagne, quelle fin),
// pas de la présentation (clips, questions, textes) qui reste au client.
//
// ⚠ CE GRAPHE DOIT RESTER SYNCHRONE avec `adventureMock.ts` (frontend) : mêmes
// ids de nœuds, mêmes routes. Duplication assumée le temps du mock ; la vraie
// solution est un graphe UNIQUE (en base) quand les vrais clips existeront.
// Voir `docs/mystere-deroule.md`.
// ─────────────────────────────────────────────────────────────────────────────

// Routage de « la grotte » — miroir de MOCK_ADVENTURE (routes seules).
const GROTTE = {
  id: 'grotte-ci',
  start: 'n1',
  nodes: {
    n1: { kind: 'epreuve', accord: { survie: { next: 'n2' }, mort: { next: 'fin_mort' } },
      desaccord: { maxTours: 6, mort: 'fin_desaccord' } },
    n2: { kind: 'epreuve', reveal: 'ville', accord: { survie: { next: 'n3' }, mort: { next: 'fin_mort' } },
      desaccord: { maxTours: 6, mort: 'fin_desaccord' } },
    n3: { kind: 'epreuve', reveal: 'gout', accord: { survie: { next: 'n4' }, mort: { next: 'fin_mort' } },
      desaccord: { maxTours: 6, mort: 'fin_desaccord' } },
    n4: { kind: 'intime', reveal: 'aveu', next: 'n4b' },
    n4b: { kind: 'consentement', oui: 'n5', non: 'fin_separes' },
    n5: { kind: 'epreuve', reveal: 'prenom', accord: { survie: { next: 'n6' }, mort: { next: 'fin_mort' } },
      desaccord: { maxTours: 6, mort: 'fin_desaccord' } },
    n6: { kind: 'epreuve', reveal: 'age', accord: { survie: { next: 'n7' }, mort: { next: 'fin_mort' } },
      desaccord: { maxTours: 6, mort: 'fin_desaccord' } },
    n7: { kind: 'epreuve', accord: { survie: { next: 'fin_plage' }, mort: { next: 'fin_mort' } },
      desaccord: { maxTours: 6, mort: 'fin_desaccord' } },
    fin_plage: { kind: 'end', end: 'match', reveal: 'visage' },
    fin_mort: { kind: 'end', end: 'echec' },
    fin_desaccord: { kind: 'end', end: 'echec' },
    fin_separes: { kind: 'end', end: 'left' },
  },
};

const GRAPHES = { 'grotte-ci': GROTTE };

/** Le graphe par son id (ou null). */
function graphe(id) { return GRAPHES[id] || null; }

module.exports = { GROTTE, GRAPHES, graphe };
