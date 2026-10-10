/*
 * Noms propres. Aucune règle ne sait qu'un mot est un nom ; deux moyens se cumulent :
 *  1. la liste fournie par l'utilisateur, recherchée avec ses variantes
 *     (casse, accents, nom seul, prénom seul, tirets et espaces) ;
 *  2. des suggestions tirées de la forme du texte (civilité, majuscules, « né à »…).
 * Une détection : { debut, fin, categorie: 'NOM', valeur, cle, entite, source }.
 * « entite » désigne la personne ou la société (une même étiquette), « cle » la ligne à cocher.
 */
(function (racine, fabrique) {
  'use strict';
  var node = typeof module === 'object' && module.exports;
  var detecteurs = node ? require('./detecteurs.js') : racine.Anonymiseur.detecteurs;
  var api = fabrique(detecteurs);
  if (node) {
    module.exports = api;
  } else {
    racine.Anonymiseur.noms = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self, function (detecteurs) {
  'use strict';

  function ensemble(mots) {
    var e = Object.create(null);
    mots.split(/\s+/).forEach(function (m) {
      if (m) e[m] = true;
    });
    return e;
  }

  // Écrits sans accents et en minuscules : la comparaison passe par sansAccents().
  var CIVILITES = ensemble('m mm mme mmes mlle mlles me mes maitre maitres dr drs docteur docteurs pr professeur monsieur madame mademoiselle messieurs mesdames consorts epoux epouse veuve');

  var TITRES = ensemble('president presidente juge procureur procureure batonnier batonniere directeur directrice maire prefet prefete greffier greffiere expert experte conseiller conseillere avocat avocate notaire huissier commissaire ministre depute senateur recteur medecin');

  /*
   * Termes juridiques et mots de structure courants : jamais suggérés,
   * qu'ils portent une majuscule initiale ou qu'ils soient écrits en majuscules.
   */
  var LEXIQUE = ensemble(
    'tribunal cour conseil code article loi decret ordonnance arrete arret jugement proces verbal proces-verbal conclusions assignation requete memoire motifs dispositif ' +
      'faits procedure discussion droit expose rappel demande demandeur demanderesse defendeur defenderesse appelant appelante intime intimee partie civile civil penal penale ' +
      'contre pour entre plaise republique francaise francais france peuple nom piece bordereau communication objet reference sarl sas sasu sci eurl snc selarl scp selas ' +
      'tva ttc rcs cpam fgao fgti oniam civi aipp dft dfp itt ipp lrar monsieur madame mademoiselle maitre messieurs mesdames docteur professeur president presidente juge ' +
      'procureur greffe greffier greffiere batonnier barreau chambre section pole ministere public parquet etat constitution convention europeenne cassation justice garde sceaux ' +
      'securite sociale primaire maladie garantie tresor journal officiel titre livre chapitre annexe alinea attendu considerant par ces sur aux des les une elle dit condamne ' +
      'deboute ordonne rejette declare constate rappelle fixe statuant publiquement contradictoirement premier dernier ressort instance appel audience delibere expedition ' +
      'executoire copie certifiee conforme signification huissier commissaire expert expertise rapport mission prejudice indemnisation indemnite dommages interets depens frais ' +
      'irrepetibles avocat prefecture prefet police gendarmerie nationale lundi mardi mercredi jeudi vendredi samedi dimanche janvier fevrier mars avril mai juin juillet aout ' +
      'septembre octobre novembre decembre tel fax email courriel iban bic siren siret confidentiel urgent important attention projet note total sous-total date lieu signature ' +
      'page oui non etc cedex bis ter rue avenue boulevard mise demeure lettre recommandee accuse reception numero dossier affaire client cliente victime assure assuree assureur ' +
      'tiers responsable conducteur conductrice vehicule accident sinistre constat amiable declaration temoin temoignage audition plainte depot infraction contravention avis ' +
      'permis conduire certificat medical medicale incapacite travail consolidation deficit fonctionnel temporaire permanent souffrances endurees esthetique agrement tierce ' +
      'personne perte gains professionnels incidence professionnelle sante depenses actuelles futures provision offre transaction quittance protocole accord contrat conditions ' +
      'generales particulieres clause avenant facture devis bon commande livraison paiement reglement cheque virement euros eur cass civ crim soc com ass plen cons const bull ' +
      'jcp dalloz gaz pal rtd obs ibid art cedh cjue cjce jorf nor ecli recapitulatives responsives reponse replique duplique devant apres avant sommation refere fond judiciaire ' +
      'administratif administrative correctionnel commerce prudhommes hommes prud instruction jugeant vus dire juger condamner debouter ordonner rejeter declarer constater ' +
      'rappeler fixer donner acte recevoir infirmer confirmer reformer subsidiairement principalement titre liminaire preambule resume sommaire introduction conclusion ' +
      'present presente soussigne soussignee nous vous ils elles que qui dont car mais donc ainsi alors selon dans avec sans sous vers chez depuis pendant lors toutefois ' +
      'cependant enfin ensuite puis aussi cette ces cet son ses leur leurs notre votre nos vos tout tous toute toutes aucun aucune chaque plusieurs autre autres ' +
      'sa sca sem gie ag gmbh ltd inc chu chr chru union general generale national regional departemental departementale municipal municipale superieur superieure'
  );

  /*
   * Mots courants dans le nom d'une société ou d'un organisme : laissés quand ils sont seuls,
   * pris avec le nom quand ils le touchent (« Assurances Imaginaires », « Cabinet Fictif »).
   */
  var GENERIQUES = ensemble(
    'assurance societe cabinet caisse compagnie association centre hopital hospitalier universitaire clinique banque mutuelle groupe etablissements entreprise transports ' +
      'pharmacie agence fonds syndicat mairie institut fondation credit office garage etude residence ecole college lycee universite commune ville departement region'
  );

  var PARTICULES = ensemble('de du des la le les l d et en au aux sur sous von van der den ben bin el al di da del della saint sainte st ste');
  var PARTICULES_DE_NOM = ensemble('de du des von van ben bin el');
  var DETERMINANTS = ensemble('la le les l un une ce cet cette son sa ses leur leurs notre votre nos vos mon ma mes ton ta tes des du de au aux terme domicile proximite');

  /* ---------- Normalisation ---------- */

  function sansAccents(texte) {
    return texte
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/œ/g, 'oe')
      .replace(/Œ/g, 'OE')
      .replace(/æ/g, 'ae')
      .replace(/Æ/g, 'AE');
  }

  // Forme de comparaison : minuscules, sans accents, tirets et apostrophes ramenés à une espace.
  function normaliser(valeur) {
    return sansAccents(valeur)
      .toLowerCase()
      .replace(/[\s\u00a0\u202f\-'’]+/g, ' ')
      .trim();
  }

  function dansEnsemble(ens, motNormalise) {
    if (ens[motNormalise]) return true;
    if (/(?:s|x)$/.test(motNormalise) && ens[motNormalise.slice(0, -1)]) return true;
    if (/es$/.test(motNormalise) && ens[motNormalise.slice(0, -2)]) return true;
    return false;
  }

  function motCourantDuDroit(motNormalise) {
    return dansEnsemble(LEXIQUE, motNormalise) || dansEnsemble(GENERIQUES, motNormalise) || dansEnsemble(CIVILITES, motNormalise) || dansEnsemble(TITRES, motNormalise);
  }

  function lireListe(saisie) {
    var vus = Object.create(null);
    var termes = [];
    String(saisie || '')
      .split(/[\n;]+/)
      .forEach(function (ligne) {
        var terme = ligne.replace(/[\s\u00a0]+/g, ' ').trim();
        var cle = normaliser(terme);
        if (cle.length < 2 || vus[cle]) return;
        vus[cle] = true;
        termes.push(terme);
      });
    return termes;
  }

  /* ---------- Recherche des termes ---------- */

  var VARIANTES = { a: 'aàâäãá', e: 'eéèêë', i: 'iîïí', o: 'oôöóõ', u: 'uùûüú', c: 'cç', y: 'yÿ', n: 'nñ' };

  function motifDuMot(motNormalise) {
    var motif = '';
    for (var i = 0; i < motNormalise.length; i += 1) {
      var c = motNormalise.charAt(i);
      if (c === 'o' && motNormalise.charAt(i + 1) === 'e') {
        motif += '(?:oe|œ)';
        i += 1;
      } else if (c === 'a' && motNormalise.charAt(i + 1) === 'e') {
        motif += '(?:ae|æ)';
        i += 1;
      } else if (VARIANTES[c]) {
        motif += '[' + VARIANTES[c] + ']';
      } else {
        motif += c.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
      }
    }
    return motif;
  }

  /*
   * Prépare la recherche d'une liste de termes (chaînes, ou { valeur, source }).
   * source 'liste' : toutes les casses ; source 'suggestion' : forme à majuscule seulement.
   */
  function preparer(termes) {
    var entrees = Object.create(null);
    (termes || []).forEach(function (t) {
      var valeur = typeof t === 'string' ? t : t.valeur;
      var source = typeof t === 'string' ? 'liste' : t.source || 'liste';
      var cle = normaliser(valeur);
      if (cle.length < 2) return;
      var mots = cle.split(' ');
      if (!entrees[cle]) {
        entrees[cle] = { cle: cle, mots: mots, source: source };
      } else if (source === 'liste') {
        entrees[cle].source = 'liste';
      }
    });

    function motCherchableSeul(mot, source) {
      if (mot.length < 2 || PARTICULES[mot] || /^\d+$/.test(mot)) return false;
      if (dansEnsemble(CIVILITES, mot)) return false;
      if (source === 'suggestion' && motCourantDuDroit(mot)) return false;
      return true;
    }

    // Pour chaque mot, les termes de plusieurs mots qui le contiennent.
    var porteurs = Object.create(null);
    Object.keys(entrees).forEach(function (cle) {
      var e = entrees[cle];
      if (e.mots.length < 2) return;
      e.mots.forEach(function (mot) {
        if (!motCherchableSeul(mot, e.source)) return;
        porteurs[mot] = porteurs[mot] || [];
        if (porteurs[mot].indexOf(cle) < 0) porteurs[mot].push(cle);
      });
    });

    var motifs = Object.create(null);
    function ajouter(mots, cle, entite, source) {
      var corps = mots.map(motifDuMot).join('[ \\u00a0\\u202f\\-’\']{0,2}');
      var existant = motifs[corps];
      if (existant) {
        if (source === 'liste') existant.source = 'liste';
        return;
      }
      motifs[corps] = {
        re: new RegExp('(?<![\\p{L}\\p{N}])' + corps + '(?![\\p{L}\\p{N}])', 'giu'),
        cle: cle,
        entite: entite,
        source: source,
      };
    }

    Object.keys(entrees).forEach(function (cle) {
      var e = entrees[cle];
      if (e.mots.length === 1) {
        var seul = porteurs[cle] && porteurs[cle].length === 1 ? porteurs[cle][0] : null;
        if (seul) ajouter(e.mots, 'NOM:' + seul + '#' + cle, 'NOM:' + seul, e.source);
        else ajouter(e.mots, 'NOM:' + cle, 'NOM:' + cle, e.source);
        return;
      }
      ajouter(e.mots, 'NOM:' + cle, 'NOM:' + cle, e.source);
      e.mots.forEach(function (mot) {
        if (!motCherchableSeul(mot, e.source)) return;
        if (porteurs[mot].length === 1) ajouter([mot], 'NOM:' + cle + '#' + mot, 'NOM:' + cle, e.source);
        else ajouter([mot], 'NOM:' + mot, 'NOM:' + mot, e.source);
      });
    });

    return Object.keys(motifs).map(function (k) {
      return motifs[k];
    });
  }

  function chercher(texte, prepares) {
    var etiquettes = detecteurs.plagesEtiquettes(texte);
    var trouves = [];
    prepares.forEach(function (p) {
      p.re.lastIndex = 0;
      var m;
      while ((m = p.re.exec(texte)) !== null) {
        var debut = m.index;
        var fin = debut + m[0].length;
        if (p.source === 'suggestion') {
          if (!/^\p{Lu}/u.test(m[0])) continue;
          // La commune d'une juridiction reste dans le texte ; un terme de la liste, lui, est masqué partout.
          if (JURIDICTION.test(texte.slice(Math.max(0, debut - 90), debut))) continue;
        }
        if (etiquettes.some(function (e) { return debut < e.fin && e.debut < fin; })) continue;
        trouves.push({ debut: debut, fin: fin, categorie: 'NOM', valeur: m[0], cle: p.cle, entite: p.entite, source: p.source });
      }
    });
    return detecteurs.departager(trouves);
  }

  function chercherTermes(texte, termes) {
    return chercher(texte, preparer(termes));
  }

  /* ---------- Suggestions ---------- */

  var JURIDICTION = new RegExp(
    '(?:cour|tribunal|conseil|barreau|parquet|tgi|greffe|juridiction|ordre)' +
      '(?:[ \\u00a0’\'](?:d|de|du|des|la|l|appel|judiciaire|grande|instance|commerce|prud|hommes|administratif|administrative|police|correctionnel|proximité|assises|paritaire|pour|enfants|avocats|au|aux|affaires|sécurité|sociale|contentieux|protection|pôle|social))*' +
      '[ \\u00a0’\']$',
    'iu'
  );

  var RE_MOT = /[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu;

  function decouper(texte) {
    var etiquettes = detecteurs.plagesEtiquettes(texte);
    var mots = [];
    var m;
    RE_MOT.lastIndex = 0;
    while ((m = RE_MOT.exec(texte)) !== null) {
      var debut = m.index;
      var fin = debut + m[0].length;
      if (etiquettes.some(function (e) { return debut < e.fin && e.debut < fin; })) {
        mots.push({ texte: '', debut: debut, fin: fin, etiquette: true });
        continue;
      }
      var t = m[0];
      var lettres = /^[\p{L}-]+$/u.test(t);
      var bas = sansAccents(t).toLowerCase();
      var majuscules = lettres && t === t.toUpperCase() && t !== t.toLowerCase();
      mots.push({
        texte: t,
        bas: bas,
        debut: debut,
        fin: fin,
        initiale: lettres && /^\p{Lu}/u.test(t) && !majuscules,
        majuscules: majuscules,
        longueur: t.replace(/-/g, '').length,
        romain: /^[IVXLCDM]+$/.test(t),
      });
    }
    mots.forEach(function (mot, i) {
      var avant = texte.slice(i === 0 ? 0 : mots[i - 1].fin, mot.debut);
      mot.avant = avant;
      // Début de phrase : début du texte ou de ligne, ou après un point, un deux-points, un point d'interrogation…
      mot.debutDePhrase = i === 0 || /[\n.!?:…]/.test(avant) || (/^\d+$/.test(mots[i - 1].texte) && /^[.)]/.test(avant) && (i === 1 || /\n/.test(mots[i - 1].avant)));
    });
    return mots;
  }

  function suggerer(texte) {
    var mots = decouper(texte);
    var plages = [];

    function formeDeNom(mot) {
      return !mot.etiquette && (mot.initiale || (mot.majuscules && mot.longueur >= 2)) && !(mot.majuscules && mot.romain);
    }
    function exclu(mot) {
      return dansEnsemble(LEXIQUE, mot.bas) || dansEnsemble(CIVILITES, mot.bas) || dansEnsemble(TITRES, mot.bas);
    }
    function colle(mot) {
      // séparé du mot précédent par une simple espace ou un tiret
      return /^[ \u00a0\u202f]$|^-$|^[ \u00a0]-[ \u00a0]?$/.test(mot.avant) && !/^[ \u00a0]-/.test(mot.avant);
    }

    /*
     * Étend une suite de noms à partir du mot i. « stricte » : la suite s'arrête au premier mot du lexique.
     * Rend l'indice du dernier mot pris, ou -1.
     */
    function etendre(i, sansLexique) {
      var dernier = -1;
      var j = i;
      var significatif = false;
      while (j < mots.length) {
        var mot = mots[j];
        if (j > i && !colle(mot)) break;
        if (formeDeNom(mot) && (!sansLexique || !exclu(mot))) {
          if (!dansEnsemble(GENERIQUES, mot.bas) || !sansLexique) significatif = true;
          dernier = j;
          j += 1;
          continue;
        }
        // Particule entre deux noms : « de », « de la », « d' ».
        if (dernier === j - 1 && j > i) {
          var k = j;
          if (!mot.etiquette && mot.texte === mot.texte.toLowerCase() && (PARTICULES_DE_NOM[mot.bas] || mot.bas === 'd')) {
            k = j + 1;
            if (mot.bas === 'de' && mots[k] && (mots[k].texte === 'la' || mots[k].texte === 'l') && /^[ \u00a0]$/.test(mots[k].avant)) k += 1;
            var suivant = mots[k];
            if (suivant && formeDeNom(suivant) && !exclu(suivant) && /^[ \u00a0’']$/.test(suivant.avant)) {
              dernier = k;
              significatif = true;
              j = k + 1;
              continue;
            }
          }
        }
        break;
      }
      return significatif ? dernier : -1;
    }

    function ajouter(i, j) {
      if (j < i) return;
      plages.push({ debut: mots[i].debut, fin: mots[j].fin });
    }

    for (var i = 0; i < mots.length; i += 1) {
      var mot = mots[i];
      if (mot.etiquette) continue;

      // 1. Après une civilité ou un titre : M., Mme, Me, Maître, Dr, Monsieur, Madame…
      var civilite =
        CIVILITES[mot.bas] &&
        (mot.bas === 'm' || mot.bas === 'mm' ? /^MM?$/.test(mot.texte) && /^\./.test((mots[i + 1] || {}).avant || '') : true) &&
        (mot.bas === 'me' || mot.bas === 'mes' ? /^Mes?$/.test(mot.texte) : true);
      if (civilite && mots[i + 1] && /^(?:\.[ \u00a0\u202f]*|[ \u00a0\u202f]+)$/.test(mots[i + 1].avant)) {
        var premier = mots[i + 1];
        if (formeDeNom(premier) && !dansEnsemble(TITRES, premier.bas) && !dansEnsemble(CIVILITES, premier.bas)) {
          ajouter(i + 1, etendre(i + 1, false));
        }
      }

      // 4. Après « né à », « demeurant », « domicilié à », « résidant à », « représenté par », « assisté de ».
      var declencheur = /^(?:nee?s?|demeurant|domiciliee?s?|residant|representee?s?|assistee?s?)$/.test(mot.bas);
      if (declencheur && mots[i + 1]) {
        var k = i + 1;
        if (/^(?:a|par|de)$/.test(mots[k].bas) && /^[ \u00a0]$/.test(mots[k].avant)) k += 1;
        var cible = mots[k];
        if (cible && /^[ \u00a0]$/.test(cible.avant) && !cible.etiquette) {
          if (formeDeNom(cible) && !exclu(cible)) {
            ajouter(k, etendre(k, true));
          } else if (/^nee?s?$/.test(mot.bas) && k === i + 2 && mots[i + 1].bas === 'a' && /^\p{Ll}{3,}/u.test(cible.texte) && !DETERMINANTS[cible.bas] && !dansEnsemble(LEXIQUE, cible.bas)) {
            // « né à trifouilly » : la commune, même sans majuscule
            ajouter(k, k);
          }
        }
      }

      // 2 et 3. Mots à majuscule initiale en milieu de phrase ; mots en majuscules d'au moins trois lettres.
      var depart = (mot.initiale && !mot.debutDePhrase) || (mot.majuscules && mot.longueur >= 3 && !mot.romain);
      if (depart && !exclu(mot)) {
        if (JURIDICTION.test(texte.slice(Math.max(0, mot.debut - 90), mot.debut))) continue;
        var fin = etendre(i, true);
        if (fin >= i) {
          ajouter(i, fin);
          i = fin;
        }
      }
    }

    // Fusion des plages qui se recouvrent : la plus large est gardée.
    plages.sort(function (a, b) {
      return a.debut - b.debut || b.fin - a.fin;
    });
    var fusionnees = [];
    plages.forEach(function (p) {
      var precedente = fusionnees[fusionnees.length - 1];
      if (precedente && p.debut < precedente.fin) {
        if (p.fin > precedente.fin) precedente.fin = p.fin;
      } else {
        fusionnees.push({ debut: p.debut, fin: p.fin });
      }
    });
    return fusionnees.map(function (p) {
      var valeur = texte.slice(p.debut, p.fin);
      var cle = 'NOM:' + normaliser(valeur);
      return { debut: p.debut, fin: p.fin, categorie: 'NOM', valeur: valeur, cle: cle, entite: cle, source: 'suggestion' };
    });
  }

  return {
    lireListe: lireListe,
    normaliser: normaliser,
    sansAccents: sansAccents,
    preparer: preparer,
    chercher: chercher,
    chercherTermes: chercherTermes,
    suggerer: suggerer,
    motCourantDuDroit: motCourantDuDroit,
  };
});
