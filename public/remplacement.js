/*
 * Remplacement : assemblage des détections, étiquettes stables, décalage des dates.
 *  - analyser()  : toutes les détections candidates d'un document (elles peuvent se chevaucher) ;
 *  - resoudre()  : parmi les détections cochées, la plus longue l'emporte ;
 *  - remplacer() : texte de sortie et plan des substitutions.
 * La session garde en mémoire la table de correspondance et le décalage des dates ;
 * rien n'est écrit ailleurs, tout disparaît au rechargement de la page.
 */
(function (racine, fabrique) {
  'use strict';
  var node = typeof module === 'object' && module.exports;
  var api = fabrique(
    node ? require('./detecteurs.js') : racine.Anonymiseur.detecteurs,
    node ? require('./noms.js') : racine.Anonymiseur.noms,
    racine
  );
  if (node) {
    module.exports = api;
  } else {
    racine.Anonymiseur.remplacement = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self, function (detecteurs, noms, racine) {
  'use strict';

  var LIBELLES = {
    NOM: 'NOM',
    COURRIEL: 'COURRIEL',
    URL: 'ADRESSE WEB',
    TELEPHONE: 'TÉLÉPHONE',
    IBAN: 'IBAN',
    NIR: 'N° SÉCU',
    SIRET: 'SIRET',
    SIREN: 'SIREN',
    IMMATRICULATION: 'IMMATRICULATION',
    DATE: 'DATE',
    MONTANT: 'MONTANT',
    ADRESSE: 'ADRESSE',
    NUMERO: 'NUMÉRO',
  };

  /* ---------- Session ---------- */

  function aleaDuNavigateur() {
    var tampon = new Uint32Array(1);
    racine.crypto.getRandomValues(tampon);
    return tampon[0] / 4294967296;
  }

  // Décalage commun à toutes les dates de la session : 30 à 365 jours, dans un sens ou l'autre.
  function tirerDecalage(alea) {
    var jours = 30 + Math.floor(alea() * 336);
    return alea() < 0.5 ? -jours : jours;
  }

  function creerSession(options) {
    var alea = (options && options.alea) || aleaDuNavigateur;
    return {
      etiquettes: new Map(), // entité ou valeur -> étiquette
      compteurs: Object.create(null), // catégorie -> dernier numéro attribué
      decalage: tirerDecalage(alea),
      datesProduites: new Set(), // dates écrites par le décalage, admises au contrôle de sortie
      documents: 0,
    };
  }

  function etiquettePour(session, detection) {
    var cle = detection.entite || detection.cle;
    var connue = session.etiquettes.get(cle);
    if (connue) return connue;
    var numero = (session.compteurs[detection.categorie] || 0) + 1;
    session.compteurs[detection.categorie] = numero;
    var etiquette = '[' + LIBELLES[detection.categorie] + ' ' + numero + ']';
    session.etiquettes.set(cle, etiquette);
    return etiquette;
  }

  /* ---------- Analyse ---------- */

  function rang(d) {
    if (d.categorie === 'NOM') {
      if (d.source === 'liste') return 0;
      return d.directe ? 60 : 50;
    }
    return 1 + detecteurs.CATEGORIES.indexOf(d.categorie);
  }

  function chevauche(a, b) {
    return a.debut < b.fin && b.debut < a.fin;
  }

  function departager(candidats) {
    var tries = candidats.slice().sort(function (a, b) {
      return b.fin - b.debut - (a.fin - a.debut) || rang(a) - rang(b) || a.debut - b.debut;
    });
    var gardes = [];
    tries.forEach(function (c) {
      if (!gardes.some(function (g) { return chevauche(g, c); })) gardes.push(c);
    });
    return gardes.sort(function (a, b) {
      return a.debut - b.debut;
    });
  }

  /*
   * Analyse un document découpé en blocs de texte (paragraphes d'un fichier Word, ou un texte entier).
   * Rend, pour chaque bloc, la liste de ses détections candidates.
   * Les suggestions de noms relevées dans un bloc sont recherchées dans tous les blocs.
   */
  function analyser(blocs, termes) {
    // Un bloc est un texte, ou { texte, technique } ; un bloc technique (code de champ,
    // cible de lien) suit les règles et la liste, sans suggestion tirée de sa forme.
    var techniques = blocs.map(function (b) {
      return typeof b !== 'string' && Boolean(b.technique);
    });
    blocs = blocs.map(function (b) {
      return typeof b === 'string' ? b : b.texte;
    });
    var suggestionsParBloc = blocs.map(function (texte, i) {
      return techniques[i] ? [] : noms.suggerer(texte);
    });
    var registre = (termes || []).map(function (t) {
      return { valeur: t, source: 'liste' };
    });
    suggestionsParBloc.forEach(function (liste) {
      liste.forEach(function (s) {
        registre.push({ valeur: s.valeur, source: 'suggestion' });
      });
    });
    var prepares = noms.preparer(registre);

    return blocs.map(function (texte, i) {
      var candidats = detecteurs.detecter(texte);
      var parTermes = noms.chercher(texte, prepares);
      // Une suggestion relevée sur place et absente de la recherche (mot sans majuscule après « né à »).
      var directes = suggestionsParBloc[i].filter(function (s) {
        return !parTermes.some(function (t) { return chevauche(t, s); });
      });
      directes.forEach(function (s) {
        s.directe = true;
      });
      return candidats.concat(parTermes, directes).sort(function (a, b) {
        return a.debut - b.debut || b.fin - a.fin;
      });
    });
  }

  function cocheParDefaut(detection, options) {
    if (detection.categorie === 'MONTANT') return Boolean(options && options.masquerMontants);
    if (detection.categorie === 'DATE') return !options || options.modeDates !== 'conserver';
    return true;
  }

  function estCochee(detection, options, coches) {
    if (coches && coches.has(detection.cle)) return coches.get(detection.cle);
    return cocheParDefaut(detection, options);
  }

  // Morceaux d'une détection évincée qui dépassent des détections retenues.
  function restes(perdante, retenues) {
    var morceaux = [{ debut: perdante.debut, fin: perdante.fin }];
    retenues.forEach(function (g) {
      var suivants = [];
      morceaux.forEach(function (m) {
        if (!chevauche(m, g)) {
          suivants.push(m);
          return;
        }
        if (m.debut < g.debut) suivants.push({ debut: m.debut, fin: g.debut });
        if (m.fin > g.fin) suivants.push({ debut: g.fin, fin: m.fin });
      });
      morceaux = suivants;
    });
    return morceaux
      .map(function (m) {
        // Les espaces et la ponctuation de bord sortent du morceau gardé.
        var portion = perdante.valeur.slice(m.debut - perdante.debut, m.fin - perdante.debut);
        var avant = portion.length - portion.replace(/^[^\p{L}\p{N}]+/u, '').length;
        var apres = portion.length - portion.replace(/[^\p{L}\p{N}]+$/u, '').length;
        return Object.assign({}, perdante, {
          debut: m.debut + avant,
          fin: m.fin - apres,
          valeur: portion.slice(avant, portion.length - apres),
          reste: true,
        });
      })
      .filter(function (d) {
        return d.fin - d.debut >= 2;
      });
  }

  /*
   * Choisit les détections appliquées. Rend { actives, gardees } :
   * actives : détections cochées, disjointes ; gardees : détections décochées visibles, laissées dans le texte.
   */
  function resoudre(candidats, coche) {
    var cochees = candidats.filter(coche);
    var actives = departager(cochees);
    // Reste des noms évincés par un chevauchement partiel.
    var complements = [];
    cochees.forEach(function (c) {
      if (c.categorie !== 'NOM' || actives.indexOf(c) >= 0) return;
      var contenue = actives.some(function (g) { return g.debut <= c.debut && c.fin <= g.fin; });
      if (contenue) return;
      restes(c, actives).forEach(function (r) {
        complements.push(r);
      });
    });
    if (complements.length) {
      actives = actives.concat(departager(complements)).sort(function (a, b) {
        return a.debut - b.debut;
      });
    }
    var decochees = candidats.filter(function (c) {
      return !coche(c) && !actives.some(function (g) { return chevauche(g, c); });
    });
    return { actives: actives, gardees: departager(decochees) };
  }

  /* ---------- Dates ---------- */

  function deuxChiffres(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function decaler(date, jours) {
    var d = new Date(Date.UTC(date.annee, date.mois - 1, date.jour));
    d.setUTCDate(d.getUTCDate() + jours);
    return { jour: d.getUTCDate(), mois: d.getUTCMonth() + 1, annee: d.getUTCFullYear() };
  }

  var ABREVIATIONS = ['janv', 'févr', null, 'avr', null, null, 'juill', null, 'sept', 'oct', 'nov', 'déc'];

  function nomDuMois(mois, modele) {
    var variantes = detecteurs.MOIS[mois - 1];
    var canonique = variantes[0];
    var nu = modele.replace(/\.$/, '');
    var point = /\.$/.test(modele);
    var origine = null;
    detecteurs.MOIS.forEach(function (v) {
      if (v.indexOf(nu.toLowerCase()) >= 0) origine = v;
    });
    // Mois d'origine abrégé (« déc. », « janv. ») : le mois d'arrivée s'abrège quand une abréviation existe.
    var abrege = origine && nu.length < origine[0].length;
    var nom = canonique;
    if (abrege && ABREVIATIONS[mois - 1]) nom = ABREVIATIONS[mois - 1] + (point ? '.' : '');
    if (nu === nu.toUpperCase() && nu !== nu.toLowerCase()) return nom.toUpperCase();
    if (/^\p{Lu}/u.test(nu)) return nom.charAt(0).toUpperCase() + nom.slice(1);
    return nom;
  }

  function jourEnLettres(jour, modele) {
    if (jour === 1) return /^1ER$/.test(modele) ? '1ER' : '1er';
    if (/^0\d$/.test(modele)) return deuxChiffres(jour);
    return String(jour);
  }

  // Écrit la date décalée dans la forme de la date d'origine ; rend { texte, cles }.
  function ecrireDate(detection, jours) {
    var origine = detection.date;
    var n = decaler(origine, jours);
    var complet = 'DATE:' + n.annee + '-' + deuxChiffres(n.mois) + '-' + deuxChiffres(n.jour);
    var sansAnnee = 'DATE:--' + deuxChiffres(n.mois) + '-' + deuxChiffres(n.jour);
    var p = origine.morceaux || [];
    switch (origine.forme) {
      case 'chiffres': {
        var zero = /^0/.test(p[0]) || /^0/.test(p[2]);
        var court = p[0].length === 1 || p[2].length === 1;
        var remplir = zero || !court;
        var annee = p[3].length === 2 ? deuxChiffres(n.annee % 100) : String(n.annee);
        return {
          texte: (remplir ? deuxChiffres(n.jour) : n.jour) + p[1] + (remplir ? deuxChiffres(n.mois) : n.mois) + p[1] + annee,
          cles: [complet],
        };
      }
      case 'iso':
        return { texte: n.annee + '-' + deuxChiffres(n.mois) + '-' + deuxChiffres(n.jour), cles: [complet] };
      case 'lettres':
        return { texte: jourEnLettres(n.jour, p[0]) + p[1] + nomDuMois(n.mois, p[2]) + p[3] + n.annee, cles: [complet] };
      case 'mois-annee':
        return { texte: nomDuMois(n.mois, p[0]) + p[1] + n.annee, cles: ['DATE:' + n.annee + '-' + deuxChiffres(n.mois)] };
      case 'jour-mois':
        return { texte: jourEnLettres(n.jour, p[0]) + p[1] + nomDuMois(n.mois, p[2]), cles: [sansAnnee] };
      case 'jour':
        return { texte: jourEnLettres(n.jour, p[0]), cles: [complet, sansAnnee] };
      case 'annee':
        return { texte: String(n.annee), cles: ['DATE:' + n.annee] };
      default:
        return null;
    }
  }

  /* ---------- Remplacement ---------- */

  function nouveauTexte(detection, session, options) {
    if (detection.categorie === 'DATE' && detection.date && (!options || options.modeDates !== 'etiquette')) {
      var ecrite = ecrireDate(detection, session.decalage);
      if (ecrite) {
        ecrite.cles.forEach(function (cle) {
          session.datesProduites.add(cle);
        });
        return ecrite.texte;
      }
    }
    return etiquettePour(session, detection);
  }

  function planifier(actives, session, options) {
    return actives.map(function (d) {
      return { debut: d.debut, fin: d.fin, nouveau: nouveauTexte(d, session, options), detection: d };
    });
  }

  function appliquer(texte, plan) {
    var sortie = '';
    var position = 0;
    plan.forEach(function (p) {
      sortie += texte.slice(position, p.debut) + p.nouveau;
      position = p.fin;
    });
    return sortie + texte.slice(position);
  }

  /*
   * Remplace dans un bloc de texte. « coches » : Map clé -> vrai ou faux pour les choix de l'utilisateur ;
   * une clé absente suit le choix par défaut.
   */
  function remplacer(texte, candidats, session, options, coches) {
    var resolu = resoudre(candidats, function (d) {
      return estCochee(d, options, coches);
    });
    var plan = planifier(resolu.actives, session, options);
    return { texte: appliquer(texte, plan), plan: plan, actives: resolu.actives, gardees: resolu.gardees };
  }

  return {
    LIBELLES: LIBELLES,
    creerSession: creerSession,
    tirerDecalage: tirerDecalage,
    etiquettePour: etiquettePour,
    analyser: analyser,
    cocheParDefaut: cocheParDefaut,
    estCochee: estCochee,
    resoudre: resoudre,
    planifier: planifier,
    appliquer: appliquer,
    remplacer: remplacer,
    ecrireDate: ecrireDate,
  };
});
