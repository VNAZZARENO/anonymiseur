/*
 * Sortie : nom du fichier produit, contrôle de sortie, panneau « À vérifier ».
 * Le contrôle relit le résultat avec les mêmes règles déterministes que l'analyse :
 * une seule détection restante bloque l'export et se montre.
 */
(function (racine, fabrique) {
  'use strict';
  var node = typeof module === 'object' && module.exports;
  var api = fabrique(
    node ? require('./detecteurs.js') : racine.Anonymiseur.detecteurs,
    node ? require('./noms.js') : racine.Anonymiseur.noms,
    node ? require('./remplacement.js') : racine.Anonymiseur.remplacement,
    node ? require('./docx.js') : racine.Anonymiseur.docx
  );
  if (node) {
    module.exports = api;
  } else {
    racine.Anonymiseur.sortie = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self, function (detecteurs, noms, remplacement, docx) {
  'use strict';

  // Le nom d'origine porte souvent celui du client : le fichier produit reçoit un nom neutre.
  function nomNeutre(numero, extension) {
    return 'exemple-anonymise-' + numero + '.' + extension;
  }

  // Clés des détections que l'utilisateur garde dans le texte (décochées, ou conservées par option).
  function clesGardees(candidatsParBloc, options, coches) {
    var gardees = new Set();
    candidatsParBloc.forEach(function (candidats) {
      candidats.forEach(function (d) {
        if (!remplacement.estCochee(d, options, coches)) gardees.add(d.cle);
      });
    });
    return gardees;
  }

  // Dans une partie laissée hors remplacement (un graphique, par exemple), les valeurs
  // chiffrées sont des données de calcul : seules ces catégories y bloquent l'export.
  var BLOQUANTES_HORS_TEXTE = { COURRIEL: true, URL: true, IBAN: true, ADRESSE: true, NOM: true };

  function extrait(texte, debut, fin) {
    var a = Math.max(0, debut - 40);
    var b = Math.min(texte.length, fin + 40);
    return (a > 0 ? '…' : '') + texte.slice(a, b).replace(/\s+/g, ' ') + (b < texte.length ? '…' : '');
  }

  /*
   * textes : chaînes, ou { texte, titre, traitee }.
   * reglages : { termes, gardees (Set de clés), datesProduites (Set de clés) }.
   * Rend la liste des détections restantes : [{ categorie, valeur, cle, titre, extrait }].
   */
  function controler(textes, reglages) {
    var gardees = (reglages && reglages.gardees) || new Set();
    var produites = (reglages && reglages.datesProduites) || new Set();
    var prepares = noms.preparer(((reglages && reglages.termes) || []).slice());
    var restes = [];
    textes.forEach(function (entree) {
      var texte = typeof entree === 'string' ? entree : entree.texte;
      var traitee = typeof entree === 'string' ? true : entree.traitee !== false;
      var titre = typeof entree === 'string' ? '' : entree.titre || '';
      var trouvees = detecteurs.detecter(texte).concat(noms.chercher(texte, prepares));
      trouvees.sort(function (a, b) {
        return a.debut - b.debut;
      });
      trouvees.forEach(function (d) {
        if (gardees.has(d.cle) || produites.has(d.cle)) return;
        if (!traitee && !BLOQUANTES_HORS_TEXTE[d.categorie]) return;
        restes.push({ categorie: d.categorie, valeur: d.valeur, cle: d.cle, titre: titre, extrait: extrait(texte, d.debut, d.fin) });
      });
    });
    return restes;
  }

  // Rouvre le fichier Word produit et le contrôle : textes restants et métadonnées.
  async function controlerDocx(octets, reglages) {
    var doc = await docx.ouvrir(octets);
    return { restes: controler(docx.textesDeControle(doc), reglages), ecarts: docx.verifierSortie(doc.entrees) };
  }

  /* ---------- Panneau « À vérifier » ---------- */

  var COURANTS = (function () {
    var e = Object.create(null);
    (
      'le la les un une des du de il elle ils elles on nous vous je tu ce cet cette ces son sa ses leur leurs mon ma mes notre votre nos vos en dans par pour sur sous avec sans vers chez a au aux et ou mais donc or ni car ' +
      'que qui quoi dont ou si quand lorsque comme puis ensuite enfin ainsi alors aussi toutefois cependant neanmoins pourtant selon apres avant depuis pendant lors des cela ceci celui celle ceux tout tous toute toutes ' +
      'aucun aucune chaque plusieurs certains certaines autre autres bien tres plus moins peu trop pas ne non oui est sont etait etaient ont ete etre avoir fait faire peut doit sera entre contre malgre outre suite afin ' +
      'voir voici voila merci bonjour cordialement veuillez agreer salutations objet ref piece pieces cependant quant concernant conformement aux termes application vertu titre fins'
    )
      .split(/\s+/)
      .forEach(function (m) {
        e[m] = true;
      });
    return e;
  })();

  function compter(liste) {
    var ordre = [];
    var compte = Object.create(null);
    liste.forEach(function (v) {
      if (!(v in compte)) {
        compte[v] = 0;
        ordre.push(v);
      }
      compte[v] += 1;
    });
    return ordre.map(function (v) {
      return { valeur: v, occurrences: compte[v] };
    });
  }

  /*
   * Ce qui reste dans un texte après remplacement et mérite un regard :
   * mots à majuscule initiale, mots en majuscules, suites d'au moins quatre chiffres.
   * Les étiquettes et les valeurs reconnues par les règles (dates décalées, montants gardés) sont écartées.
   */
  function aVerifier(texte) {
    var caracteres = texte.split('');
    detecteurs
      .detecter(texte)
      .concat(detecteurs.plagesEtiquettes(texte))
      .forEach(function (z) {
        for (var i = z.debut; i < z.fin; i += 1) caracteres[i] = ' ';
      });
    var reste = caracteres.join('');
    var initiales = [];
    var majuscules = [];
    var chiffres = [];
    var re = /[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu;
    var m;
    while ((m = re.exec(reste)) !== null) {
      var mot = m[0];
      if (/^\d+$/.test(mot)) {
        if (mot.length >= 4) chiffres.push(mot);
        continue;
      }
      if (!/^[\p{L}-]+$/u.test(mot)) continue;
      var bas = noms.sansAccents(mot).toLowerCase();
      if (COURANTS[bas] || noms.motCourantDuDroit(bas)) continue;
      if (mot === mot.toUpperCase()) {
        if (mot.replace(/-/g, '').length >= 3 && !/^[IVXLCDM]+$/.test(mot)) majuscules.push(mot);
      } else if (/^\p{Lu}/u.test(mot)) {
        initiales.push(mot);
      }
    }
    return { initiales: compter(initiales), majuscules: compter(majuscules), chiffres: compter(chiffres) };
  }

  return {
    nomNeutre: nomNeutre,
    clesGardees: clesGardees,
    controler: controler,
    controlerDocx: controlerDocx,
    aVerifier: aVerifier,
  };
});
