/*
 * Règles déterministes de détection : un motif, puis un contrôle quand il existe
 * (clé modulo 97, clé de Luhn, date du calendrier, département du code postal).
 * Entrée : un texte. Sortie : une liste de détections triées et disjointes,
 * { debut, fin, categorie, valeur, cle } ; « cle » identifie la valeur quelle que soit sa graphie.
 * Aucune de ces règles ne comprend le sens du texte.
 */
(function (racine, fabrique) {
  'use strict';
  var api = fabrique();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    racine.Anonymiseur = racine.Anonymiseur || {};
    racine.Anonymiseur.detecteurs = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  'use strict';

  var ESP = '[ \\u00a0\\u202f]';
  var HORS_MOT_AVANT = '(?<![\\p{L}\\p{N}])';
  var HORS_MOT_APRES = '(?![\\p{L}\\p{N}])';

  // Ordre de préférence quand deux détections de même longueur se chevauchent.
  var CATEGORIES = ['COURRIEL', 'URL', 'IBAN', 'NIR', 'SIRET', 'SIREN', 'TELEPHONE', 'IMMATRICULATION', 'DATE', 'MONTANT', 'ADRESSE', 'NUMERO'];

  /* ---------- Contrôles ---------- */

  function modulo97(chiffres) {
    var reste = 0;
    for (var i = 0; i < chiffres.length; i += 1) {
      reste = (reste * 10 + (chiffres.charCodeAt(i) - 48)) % 97;
    }
    return reste;
  }

  function ibanValide(compact) {
    var retourne = compact.slice(4) + compact.slice(0, 4);
    var chiffres = '';
    for (var i = 0; i < retourne.length; i += 1) {
      var code = retourne.charCodeAt(i);
      chiffres += code >= 65 ? String(code - 55) : retourne.charAt(i);
    }
    return modulo97(chiffres) === 1;
  }

  function luhnValide(chiffres) {
    var somme = 0;
    var double = false;
    for (var i = chiffres.length - 1; i >= 0; i -= 1) {
      var c = chiffres.charCodeAt(i) - 48;
      if (double) {
        c *= 2;
        if (c > 9) c -= 9;
      }
      somme += c;
      double = !double;
    }
    return somme % 10 === 0;
  }

  function nirValide(compact) {
    var corps = compact.slice(0, 13).toUpperCase().replace('2A', '19').replace('2B', '18');
    if (!/^\d{13}$/.test(corps)) return false;
    return 97 - modulo97(corps) === Number(compact.slice(13));
  }

  function bissextile(annee) {
    return (annee % 4 === 0 && annee % 100 !== 0) || annee % 400 === 0;
  }

  function joursDuMois(mois, annee) {
    if (mois === 2) return bissextile(annee) ? 29 : 28;
    return [4, 6, 9, 11].indexOf(mois) >= 0 ? 30 : 31;
  }

  function dateValide(jour, mois, annee) {
    return annee >= 1800 && annee <= 2199 && mois >= 1 && mois <= 12 && jour >= 1 && jour <= joursDuMois(mois, annee);
  }

  function deuxChiffres(n) {
    return (n < 10 ? '0' : '') + n;
  }

  // Année à deux chiffres : 00 à 39 pour les années 2000, 40 à 99 pour les années 1900.
  function anneeComplete(texte) {
    var a = Number(texte);
    if (texte.length !== 2) return a;
    return a < 40 ? 2000 + a : 1900 + a;
  }

  /* ---------- Mois ---------- */

  var MOIS = [
    ['janvier', 'janv'],
    ['février', 'fevrier', 'févr', 'fevr', 'fév', 'fev'],
    ['mars'],
    ['avril', 'avr'],
    ['mai'],
    ['juin'],
    ['juillet', 'juill', 'juil'],
    ['août', 'aout'],
    ['septembre', 'sept'],
    ['octobre', 'oct'],
    ['novembre', 'nov'],
    ['décembre', 'decembre', 'déc', 'dec'],
  ];

  var MOTIF_MOIS = (function () {
    var formes = [];
    MOIS.forEach(function (variantes, i) {
      variantes.forEach(function (v, j) {
        formes.push(j === 0 || v.length > 5 || i === 7 ? v : v + '\\.?');
      });
    });
    formes.sort(function (a, b) {
      return b.length - a.length;
    });
    return '(' + formes.join('|') + ')(?![\\p{L}])';
  })();

  function numeroDuMois(texte) {
    var nu = texte.toLowerCase().replace(/\.$/, '');
    for (var i = 0; i < MOIS.length; i += 1) {
      if (MOIS[i].indexOf(nu) >= 0) return i + 1;
    }
    return 0;
  }

  /* ---------- Outils ---------- */

  function pourChaque(texte, motif, drapeaux, action) {
    var re = new RegExp(motif, drapeaux);
    var m;
    while ((m = re.exec(texte)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex += 1;
        continue;
      }
      action(m);
    }
  }

  function candidat(liste, texte, debut, fin, categorie, cle, supplement) {
    var d = { debut: debut, fin: fin, categorie: categorie, valeur: texte.slice(debut, fin), cle: categorie + ':' + cle };
    if (supplement) {
      Object.keys(supplement).forEach(function (k) {
        d[k] = supplement[k];
      });
    }
    liste.push(d);
  }

  function compacter(valeur) {
    return valeur.replace(/[\s  .\-]/g, '');
  }

  function chevauche(a, b) {
    return a.debut < b.fin && b.debut < a.fin;
  }

  /*
   * Garde un ensemble de détections disjointes : la plus longue l'emporte,
   * puis l'ordre des catégories, puis la première dans le texte.
   */
  function departager(candidats) {
    var tries = candidats.slice().sort(function (a, b) {
      return (
        b.fin - b.debut - (a.fin - a.debut) ||
        CATEGORIES.indexOf(a.categorie) - CATEGORIES.indexOf(b.categorie) ||
        a.debut - b.debut
      );
    });
    var gardes = [];
    tries.forEach(function (c) {
      if (!gardes.some(function (g) { return chevauche(g, c); })) gardes.push(c);
    });
    return gardes.sort(function (a, b) {
      return a.debut - b.debut;
    });
  }

  // Étiquettes déjà posées par l'outil, de la forme [NOM 3] ou [IBAN 1] : laissées intactes.
  var MOTIF_ETIQUETTE = '\\[[A-ZÀ-Ý][A-ZÀ-Ý° ]*' + ESP + '\\d+\\]';

  function plagesEtiquettes(texte) {
    var plages = [];
    pourChaque(texte, MOTIF_ETIQUETTE, 'gu', function (m) {
      plages.push({ debut: m.index, fin: m.index + m[0].length });
    });
    return plages;
  }

  /* ---------- Courriel, adresse web ---------- */

  function courriels(texte, liste) {
    pourChaque(texte, '[\\p{L}\\p{N}._%+-]+@[\\p{L}\\p{N}-]+(?:\\.[\\p{L}\\p{N}-]+)+', 'gu', function (m) {
      candidat(liste, texte, m.index, m.index + m[0].length, 'COURRIEL', m[0].toLowerCase());
    });
  }

  var EXTENSIONS = 'gouv\\.fr|fr|com|net|org|eu|info|io|be|ch|lu|uk|paris|bzh|mc|biz';

  function adressesWeb(texte, liste) {
    function ajouter(debut, brut) {
      var valeur = brut.replace(/[.,;:!?)\]'’»"]+$/, '');
      if (valeur.length < 4) return;
      candidat(liste, texte, debut, debut + valeur.length, 'URL', valeur.toLowerCase());
    }
    pourChaque(texte, '(?<![\\p{L}\\p{N}])(?:https?:\\/\\/|www\\.)[^\\s<>"«»]+', 'giu', function (m) {
      ajouter(m.index, m[0]);
    });
    // Nom de domaine nu, en minuscules, terminé par une extension courante.
    pourChaque(
      texte,
      '(?<![\\p{L}\\p{N}@._\\/-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:' + EXTENSIONS + ')(?![\\p{L}\\p{N}-])(?:\\/[^\\s<>"«»]*)?',
      'gu',
      function (m) {
        ajouter(m.index, m[0]);
      }
    );
  }

  /* ---------- Téléphone ---------- */

  function telephones(texte, liste) {
    var motif =
      '(?<![\\p{L}\\p{N}+])(?:(?:\\+|00)33' + ESP + '?(?:\\(0\\)' + ESP + '?)?|0)[1-9](?:[ \\u00a0\\u202f.\\-]?\\d{2}){4}(?!\\d)';
    pourChaque(texte, motif, 'gu', function (m) {
      var chiffres = m[0].replace(/\(0\)/, '').replace(/\D/g, '');
      var national = '0' + chiffres.slice(-9);
      if (national.length !== 10) return; // 10 chiffres utiles
      candidat(liste, texte, m.index, m.index + m[0].length, 'TELEPHONE', national);
    });
  }

  /* ---------- IBAN ---------- */

  var LONGUEURS_IBAN = { FR: 27, MC: 27, DE: 22, BE: 16, ES: 24, IT: 27, LU: 20, CH: 21, GB: 22, NL: 18, PT: 25, AT: 20, IE: 22, PL: 28, SE: 24, DK: 18, FI: 18, NO: 15, GR: 27, MA: 28, TN: 24, RO: 24, CZ: 24, HU: 28 };

  function ibans(texte, liste) {
    pourChaque(texte, HORS_MOT_AVANT + '[A-Z]{2}\\d{2}', 'gu', function (m) {
      // Avance caractère par caractère : lettres capitales et chiffres, une espace tolérée entre deux.
      var compact = '';
      var fins = [];
      var i = m.index;
      while (i < texte.length && compact.length < 34) {
        var c = texte.charAt(i);
        if (/[A-Z0-9]/.test(c)) {
          compact += c;
          fins.push(i + 1);
          i += 1;
        } else if (/[   ]/.test(c) && /[A-Z0-9]/.test(texte.charAt(i + 1))) {
          i += 1;
        } else {
          break;
        }
      }
      var attendue = LONGUEURS_IBAN[compact.slice(0, 2)];
      for (var n = compact.length; n >= 15; n -= 1) {
        if (attendue && n !== attendue) continue;
        var suivant = texte.charAt(fins[n - 1]);
        if (/[A-Za-z0-9]/.test(suivant)) continue;
        if (ibanValide(compact.slice(0, n))) {
          candidat(liste, texte, m.index, fins[n - 1], 'IBAN', compact.slice(0, n));
          return;
        }
      }
    });
  }

  /* ---------- Sécurité sociale, SIREN, SIRET ---------- */

  function numerosSecu(texte, liste) {
    var S = '[ \\u00a0\\u202f.]?';
    var motif = HORS_MOT_AVANT + '[1-478]' + S + '\\d{2}' + S + '\\d{2}' + S + '(?:\\d{2}|2[ABab])' + S + '\\d{3}' + S + '\\d{3}' + S + '\\d{2}' + HORS_MOT_APRES;
    pourChaque(texte, motif, 'gu', function (m) {
      var compact = compacter(m[0]);
      if (nirValide(compact)) candidat(liste, texte, m.index, m.index + m[0].length, 'NIR', compact.toUpperCase());
    });
  }

  function sirenEtSiret(texte, liste) {
    var S = ESP + '?';
    pourChaque(texte, HORS_MOT_AVANT + '\\d{3}' + S + '\\d{3}' + S + '\\d{3}' + S + '\\d{5}' + HORS_MOT_APRES, 'gu', function (m) {
      var compact = compacter(m[0]);
      if (luhnValide(compact)) candidat(liste, texte, m.index, m.index + m[0].length, 'SIRET', compact);
    });
    pourChaque(texte, HORS_MOT_AVANT + '\\d{3}' + S + '\\d{3}' + S + '\\d{3}' + HORS_MOT_APRES, 'gu', function (m) {
      var compact = compacter(m[0]);
      if (luhnValide(compact)) candidat(liste, texte, m.index, m.index + m[0].length, 'SIREN', compact);
    });
  }

  /* ---------- Immatriculation ---------- */

  var MOTS_DE_DEUX_LETTRES = ['LE', 'LA', 'DE', 'EN', 'ET', 'CE', 'SE', 'NE', 'SA', 'MA', 'TA', 'ME', 'TE', 'JE', 'AS', 'ES'];

  function immatriculations(texte, liste) {
    var L = '[A-HJ-NP-TV-Z]';
    // Format actuel AA-123-AA : le même séparateur des deux côtés (tiret, espace ou rien).
    pourChaque(texte, HORS_MOT_AVANT + L + '{2}([- ]?)\\d{3}\\1' + L + '{2}' + HORS_MOT_APRES, 'gu', function (m) {
      // « LE 150 CV » : un mot courant de deux lettres suivi d'une espace reste du texte.
      if (m[1] === ' ' && MOTS_DE_DEUX_LETTRES.indexOf(m[0].slice(0, 2)) >= 0) return;
      candidat(liste, texte, m.index, m.index + m[0].length, 'IMMATRICULATION', compacter(m[0]));
    });
    // Ancien format 1234 AB 75.
    pourChaque(texte, HORS_MOT_AVANT + '\\d{2,4}([- ]?)[A-HJ-NP-Z]{2,3}\\1(?:\\d{2}|2[AB])' + HORS_MOT_APRES, 'gu', function (m) {
      candidat(liste, texte, m.index, m.index + m[0].length, 'IMMATRICULATION', compacter(m[0]));
    });
  }

  /* ---------- Dates ---------- */

  var TEXTES_DE_LOI = new RegExp(
    '(?:\\b(?:loi|d[ée]cret|directive|r[èe]glement)(?:' + ESP + '+(?:organique|constitutionnelle|\\([A-Z]{2,3}\\)))?(?:' + ESP + '+n[°o]' + ESP + '*[\\d-]+)?' +
      '|\\b(?:ordonnance|arr[êe]t[ée]|circulaire)' + ESP + '+n[°o]' + ESP + '*\\d{2,4}-\\d{1,5})' + ESP + '+du' + ESP + '+$',
    'iu'
  );
  var JURISPRUDENCE = new RegExp(
    '(?:\\bCass\\.|\\bCiv\\.|\\bCrim\\.|\\bSoc\\.|\\bCom\\.|\\bAss\\.' + ESP + '?pl[ée]n\\.|\\bCh\\.' + ESP + '?mixte|\\bCons\\.' + ESP + '?const\\.|\\bT\\.' + ESP + '?confl\\.|\\bCEDH|\\bCJUE|\\bCJCE|\\bCE)[^\\n;]{0,30},' + ESP + '$',
    'u'
  );

  /*
   * Date d'un texte de loi (« loi n° … du … ») ou d'une décision citée (« Cass. civ. 2e, … ») :
   * référence publique, laissée telle quelle pour que la citation reste exacte.
   */
  function dateDeReference(texte, debut) {
    var ligne = texte.lastIndexOf('\n', debut - 1) + 1;
    var avant = texte.slice(Math.max(ligne, debut - 80), debut);
    return TEXTES_DE_LOI.test(avant) || JURISPRUDENCE.test(avant);
  }

  function dates(texte, liste) {
    var trouvees = [];
    function ajouter(debut, fin, cle, date) {
      candidat(trouvees, texte, debut, fin, 'DATE', cle, { date: date, reference: dateDeReference(texte, debut) });
    }
    function cleComplete(j, m, a) {
      return a + '-' + deuxChiffres(m) + '-' + deuxChiffres(j);
    }

    // 12/03/2024, 1/3/24, 12.03.2024, 12-03-2024
    pourChaque(texte, '(?<![\\d\\/.\\-])(\\d{1,2})([\\/.\\-])(\\d{1,2})\\2(\\d{4}|\\d{2})(?![\\d\\/]|[.\\-]\\d)', 'gu', function (m) {
      if (m[2] !== '/' && m[4].length !== 4) return;
      var j = Number(m[1]);
      var mo = Number(m[3]);
      var a = anneeComplete(m[4]);
      if (!dateValide(j, mo, a)) return;
      ajouter(m.index, m.index + m[0].length, cleComplete(j, mo, a), { forme: 'chiffres', jour: j, mois: mo, annee: a, morceaux: [m[1], m[2], m[3], m[4]] });
    });
    // 2024-03-12
    pourChaque(texte, '(?<![\\d\\/.\\-])(\\d{4})-(\\d{2})-(\\d{2})(?![\\d\\/]|[.\\-]\\d)', 'gu', function (m) {
      var a = Number(m[1]);
      var mo = Number(m[2]);
      var j = Number(m[3]);
      if (!dateValide(j, mo, a)) return;
      ajouter(m.index, m.index + m[0].length, cleComplete(j, mo, a), { forme: 'iso', jour: j, mois: mo, annee: a });
    });
    // 12 mars 2024, 1er août 2023
    pourChaque(texte, HORS_MOT_AVANT + '(1er|\\d{1,2})(' + ESP + '+)' + MOTIF_MOIS + '(' + ESP + '+)(\\d{4})(?!\\d)', 'giu', function (m) {
      var j = m[1].toLowerCase() === '1er' ? 1 : Number(m[1]);
      var mo = numeroDuMois(m[3]);
      var a = Number(m[5]);
      if (!dateValide(j, mo, a)) return;
      ajouter(m.index, m.index + m[0].length, cleComplete(j, mo, a), { forme: 'lettres', jour: j, mois: mo, annee: a, morceaux: [m[1], m[2], m[3], m[4], m[5]] });
    });
    // mars 2024
    pourChaque(texte, HORS_MOT_AVANT + MOTIF_MOIS + '(' + ESP + '+)(\\d{4})(?!\\d)', 'giu', function (m) {
      var mo = numeroDuMois(m[1]);
      var a = Number(m[3]);
      if (!dateValide(1, mo, a)) return;
      ajouter(m.index, m.index + m[0].length, a + '-' + deuxChiffres(mo), { forme: 'mois-annee', jour: 15, mois: mo, annee: a, morceaux: [m[1], m[2], m[3]] });
    });
    // 12 mars (sans année)
    pourChaque(texte, '(?<![\\p{L}\\p{N}\\/.\\-])(1er|\\d{1,2})(' + ESP + '+)' + MOTIF_MOIS, 'giu', function (m) {
      var j = m[1].toLowerCase() === '1er' ? 1 : Number(m[1]);
      var mo = numeroDuMois(m[3]);
      if (!dateValide(j, mo, 2024)) return;
      ajouter(m.index, m.index + m[0].length, '--' + deuxChiffres(mo) + '-' + deuxChiffres(j), { forme: 'jour-mois', jour: j, mois: mo, annee: 2024, morceaux: [m[1], m[2], m[3]] });
    });
    // Premier jour d'une période ou d'une énumération : « du 1er au 15 janvier 2024 », « les 3 et 5 mars ».
    pourChaque(
      texte,
      '(?<![\\p{L}\\p{N}\\/.\\-])(1er|\\d{1,2})(?=' + ESP + '+(?:au|et|ou)' + ESP + '+(?:1er|\\d{1,2})' + ESP + '+' + MOTIF_MOIS + '(?:' + ESP + '+(\\d{4})(?!\\d))?)',
      'giu',
      function (m) {
        var j = m[1].toLowerCase() === '1er' ? 1 : Number(m[1]);
        var mo = numeroDuMois(m[2]);
        var a = m[3] ? Number(m[3]) : 2024;
        if (!dateValide(j, mo, a)) return;
        var cle = m[3] ? cleComplete(j, mo, a) : '--' + deuxChiffres(mo) + '-' + deuxChiffres(j);
        ajouter(m.index, m.index + m[1].length, cle, { forme: 'jour', jour: j, mois: mo, annee: a, morceaux: [m[1]] });
      }
    );
    // né en 1980
    pourChaque(texte, HORS_MOT_AVANT + 'n[ée]e?s?' + ESP + '+en' + ESP + '+(\\d{4})(?!\\d)', 'giu', function (m) {
      var a = Number(m[1]);
      if (!dateValide(1, 1, a)) return;
      var debut = m.index + m[0].length - 4;
      ajouter(debut, debut + 4, String(a), { forme: 'annee', jour: 1, mois: 7, annee: a });
    });

    var references = trouvees.filter(function (d) { return d.reference; });
    trouvees.forEach(function (d) {
      if (d.reference) return;
      if (references.some(function (r) { return chevauche(r, d); })) return;
      delete d.reference;
      liste.push(d);
    });
  }

  /* ---------- Montants ---------- */

  function montants(texte, liste) {
    var nombre = '(?:\\d{1,3}(?:[ \\u00a0\\u202f.]\\d{3})+|\\d+)(?:,\\d+)?';
    var unite = '(?:[kM]?€|(?:(?:millions?|milliards?)' + ESP + 'd[\'’])?euros?' + HORS_MOT_APRES + '|EUR' + HORS_MOT_APRES + ')';
    pourChaque(texte, '(?<![\\p{L}\\p{N}.,])' + nombre + ESP + '?' + unite, 'giu', function (m) {
      candidat(liste, texte, m.index, m.index + m[0].length, 'MONTANT', m[0].replace(/[   ]+/g, ' ').toLowerCase());
    });
  }

  /* ---------- Adresses postales ---------- */

  var VOIES = 'rue|ruelle|avenue|av\\.|boulevard|bd|bld|place|impasse|allée|allee|chemin|route|rte|quai|cours|square|passage|villa|cité|résidence|residence|lotissement|faubourg|rond-point|sentier|voie|esplanade|promenade|hameau|traverse|montée|parvis|chaussée|venelle';
  var LIAISONS = ['de', 'du', 'des', 'la', 'le', 'les', 'aux', 'au', 'en', 'sur', 'sous'];
  var MOT_COMMUNE = '\\p{Lu}[\\p{L}\'’]*(?:-[\\p{L}\'’]+)*';
  var RE_COMMUNE = new RegExp('(?:' + MOT_COMMUNE + ')(?:' + ESP + '(?:(?:de|du|des|la|le|les|sur|sous|en|lès|lez|aux|au)' + ESP + ')*' + MOT_COMMUNE + '){0,4}', 'yu');

  function codePostalValide(code) {
    var departement = Number(code.slice(0, 2));
    return departement >= 1 && departement <= 98;
  }

  // Lit une commune à la position donnée ; rend la position de fin, ou -1.
  function finDeCommune(texte, position) {
    RE_COMMUNE.lastIndex = position;
    var m = RE_COMMUNE.exec(texte);
    if (!m) return -1;
    var fin = position + m[0].length;
    if (/cedex$/i.test(m[0])) {
      var numero = /^[  ]\d{1,2}(?!\d)/.exec(texte.slice(fin, fin + 4));
      if (numero) fin += numero[0].length;
    }
    return fin;
  }

  // Lit le nom d'une voie après son type ; rend la position de fin et dit si un mot à majuscule s'y trouve.
  function nomDeVoie(texte, position) {
    var re = /([\p{L}\p{N}'’-]+)/uy;
    var fin = position;
    var curseur = position;
    var majuscule = false;
    var minuscule = false;
    for (var n = 0; n < 8; n += 1) {
      re.lastIndex = curseur;
      var m = re.exec(texte);
      if (!m) break;
      var mot = m[1];
      var bas = mot.toLowerCase();
      if (LIAISONS.indexOf(bas) >= 0 && mot === bas) {
        // mot de liaison : gardé seulement si un nom suit
      } else if (/^(?:[dl]['’])?\p{Lu}/u.test(mot) || /^\d{1,4}$/.test(mot)) {
        majuscule = true;
        fin = curseur + mot.length;
      } else if (!majuscule && !minuscule) {
        minuscule = true;
        fin = curseur + mot.length;
      } else {
        break;
      }
      curseur += mot.length;
      var espace = /^[  ]+/.exec(texte.slice(curseur, curseur + 3));
      if (!espace) break;
      curseur += espace[0].length;
    }
    return { fin: fin, majuscule: majuscule };
  }

  function adresses(texte, liste) {
    var suite = new RegExp('^(?:,' + ESP + '*[^,;\\n]{1,40}?)?(?:' + ESP + '*,?' + ESP + '*\\n?' + ESP + '*|' + ESP + '*[-–]' + ESP + '*)(\\d{5})(?!\\d)' + ESP + '+', 'u');
    var debutVoie = HORS_MOT_AVANT + '\\d{1,4}(?:' + ESP + '?(?:bis|ter|quater|[A-Da-d])' + HORS_MOT_APRES + ')?,?' + ESP + '+(?:' + VOIES + ')' + ESP + '+';
    pourChaque(texte, debutVoie, 'giu', function (m) {
      var apres = m.index + m[0].length;
      var nom = nomDeVoie(texte, apres);
      if (nom.fin === apres) return;
      var fin = nom.fin;
      var complet = false;
      var s = suite.exec(texte.slice(fin, fin + 130));
      if (s && codePostalValide(s[1])) {
        var finCommune = finDeCommune(texte, fin + s[0].length);
        if (finCommune > 0) {
          fin = finCommune;
          complet = true;
        }
      }
      // Un nom de voie tout en minuscules compte seulement quand un code postal et une commune suivent.
      if (!complet && !nom.majuscule) return;
      candidat(liste, texte, m.index, fin, 'ADRESSE', texte.slice(m.index, fin).replace(/[\s ,]+/g, ' ').toLowerCase());
    });
    // Code postal et commune seuls.
    pourChaque(texte, '(?<![\\p{L}\\p{N}\\/\\-])(\\d{5})(?!\\d)' + ESP + '+(?=\\p{Lu})', 'gu', function (m) {
      if (!codePostalValide(m[1])) return;
      var fin = finDeCommune(texte, m.index + m[0].length);
      if (fin < 0) return;
      candidat(liste, texte, m.index, fin, 'ADRESSE', texte.slice(m.index, fin).replace(/[\s ,]+/g, ' ').toLowerCase());
    });
  }

  /* ---------- Numéros de rôle ---------- */

  function numerosDeRole(texte, liste) {
    pourChaque(texte, '\\bR\\.?G\\.?(?:' + ESP + '*n[°o])?' + ESP + '*:?' + ESP + '*(\\d{2}\\/\\d{3,6})(?!\\d)', 'gu', function (m) {
      var debut = m.index + m[0].length - m[1].length;
      candidat(liste, texte, debut, debut + m[1].length, 'NUMERO', m[1]);
    });
    pourChaque(texte, '\\b(?:Portalis|parquet)' + ESP + '*:?' + ESP + '*((?=[A-Z0-9\\/-]*\\d)[A-Z0-9]+(?:[\\/-][A-Z0-9]+)+)', 'gu', function (m) {
      var debut = m.index + m[0].length - m[1].length;
      candidat(liste, texte, debut, debut + m[1].length, 'NUMERO', m[1]);
    });
  }

  /* ---------- Numéros longs ---------- */

  function numerosLongs(texte, occupees, liste) {
    // Les zones déjà détectées sont neutralisées : la règle s'applique au reste du texte.
    var caracteres = texte.split('');
    occupees.forEach(function (z) {
      for (var i = z.debut; i < z.fin; i += 1) caracteres[i] = '\u0001';
    });
    var reste = caracteres.join('');
    var trouves = [];
    // Mot qui contient au moins six chiffres d'affilée.
    pourChaque(reste, '[\\p{L}\\p{N}]*\\d{6,}[\\p{L}\\p{N}]*', 'gu', function (m) {
      candidat(trouves, texte, m.index, m.index + m[0].length, 'NUMERO', m[0].toUpperCase());
    });
    // Au moins trois groupes de chiffres séparés par une espace, six chiffres au total.
    pourChaque(reste, HORS_MOT_AVANT + '\\d+(?:' + ESP + '\\d+){2,}' + HORS_MOT_APRES, 'gu', function (m) {
      var compact = compacter(m[0]);
      if (compact.length >= 6) candidat(trouves, texte, m.index, m.index + m[0].length, 'NUMERO', compact);
    });
    departager(trouves).forEach(function (d) {
      liste.push(d);
    });
  }

  /* ---------- Assemblage ---------- */

  function detecter(texte) {
    var candidats = [];
    courriels(texte, candidats);
    adressesWeb(texte, candidats);
    telephones(texte, candidats);
    ibans(texte, candidats);
    numerosSecu(texte, candidats);
    sirenEtSiret(texte, candidats);
    immatriculations(texte, candidats);
    dates(texte, candidats);
    montants(texte, candidats);
    adresses(texte, candidats);
    numerosDeRole(texte, candidats);

    var etiquettes = plagesEtiquettes(texte);
    var hors = candidats.filter(function (c) {
      return !etiquettes.some(function (e) { return chevauche(e, c); });
    });
    var gardes = departager(hors);
    numerosLongs(texte, gardes.concat(etiquettes), gardes);
    return gardes.sort(function (a, b) {
      return a.debut - b.debut;
    });
  }

  return {
    detecter: detecter,
    departager: departager,
    plagesEtiquettes: plagesEtiquettes,
    CATEGORIES: CATEGORIES,
    MOIS: MOIS,
    joursDuMois: joursDuMois,
    dateValide: dateValide,
    modulo97: modulo97,
    ibanValide: ibanValide,
    luhnValide: luhnValide,
    nirValide: nirValide,
  };
});
