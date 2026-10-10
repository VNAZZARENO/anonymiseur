/*
 * Archives ZIP : lecture et écriture avec les seules fonctions du navigateur.
 * Un fichier .docx est une archive ZIP de fichiers XML.
 * Décompression et compression : DecompressionStream / CompressionStream ("deflate-raw").
 * Contrôle d'intégrité : CRC-32 calculé ici.
 */
(function (racine, fabrique) {
  'use strict';
  var api = fabrique(racine);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    racine.Anonymiseur = racine.Anonymiseur || {};
    racine.Anonymiseur.zip = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self, function (racine) {
  'use strict';

  var SIGNATURE_LOCALE = 0x04034b50;
  var SIGNATURE_CENTRALE = 0x02014b50;
  var SIGNATURE_FIN = 0x06054b50;
  var TAILLE_MAXIMALE = 300 * 1024 * 1024; // garde-fou contre une archive piégée

  var TABLE_CRC = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n += 1) {
      var c = n;
      for (var k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(donnees) {
    var crc = 0xffffffff;
    for (var i = 0; i < donnees.length; i += 1) {
      crc = TABLE_CRC[(crc ^ donnees[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function fluxDisponibles() {
    return typeof racine.DecompressionStream === 'function' && typeof racine.CompressionStream === 'function';
  }

  // Fait passer des octets dans un flux de (dé)compression et rassemble le résultat.
  async function transformer(donnees, flux) {
    var ecrivain = flux.writable.getWriter();
    var ecriture = ecrivain.write(donnees).then(function () {
      return ecrivain.close();
    });
    var lecteur = flux.readable.getReader();
    var morceaux = [];
    var total = 0;
    try {
      for (;;) {
        var lu = await lecteur.read();
        if (lu.done) break;
        morceaux.push(lu.value);
        total += lu.value.length;
        if (total > TAILLE_MAXIMALE) {
          throw new Error('Archive trop volumineuse une fois décompressée.');
        }
      }
      await ecriture;
    } catch (erreur) {
      ecriture.catch(function () {});
      throw erreur;
    }
    var resultat = new Uint8Array(total);
    var position = 0;
    for (var i = 0; i < morceaux.length; i += 1) {
      resultat.set(morceaux[i], position);
      position += morceaux[i].length;
    }
    return resultat;
  }

  function decompresser(donnees) {
    return transformer(donnees, new racine.DecompressionStream('deflate-raw'));
  }

  function compresser(donnees) {
    return transformer(donnees, new racine.CompressionStream('deflate-raw'));
  }

  function trouverFin(vue) {
    var minimum = Math.max(0, vue.byteLength - 22 - 65535);
    for (var i = vue.byteLength - 22; i >= minimum; i -= 1) {
      if (vue.getUint32(i, true) === SIGNATURE_FIN) return i;
    }
    return -1;
  }

  /*
   * Lit une archive. Rend la liste des entrées dans l'ordre du répertoire central :
   * [{ nom, donnees }]. Les dossiers (noms terminés par "/") sont ignorés.
   */
  async function lire(octets) {
    if (!(octets instanceof Uint8Array)) octets = new Uint8Array(octets);
    var vue = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
    var fin = octets.length >= 22 ? trouverFin(vue) : -1;
    if (fin < 0) {
      throw new Error('Archive illisible : ce fichier a un autre format que .docx, ou il est abîmé.');
    }
    var nombre = vue.getUint16(fin + 10, true);
    var position = vue.getUint32(fin + 16, true);
    if (nombre === 0xffff || position === 0xffffffff) {
      throw new Error('Archive au format ZIP64 : ce format dépasse ce que l’outil sait lire.');
    }
    var decodeurUtf8 = new TextDecoder('utf-8');
    var entrees = [];
    var total = 0;
    for (var n = 0; n < nombre; n += 1) {
      if (position + 46 > octets.length || vue.getUint32(position, true) !== SIGNATURE_CENTRALE) {
        throw new Error('Archive illisible : répertoire central incomplet.');
      }
      var drapeaux = vue.getUint16(position + 8, true);
      var methode = vue.getUint16(position + 10, true);
      var crcAttendu = vue.getUint32(position + 16, true);
      var tailleCompressee = vue.getUint32(position + 20, true);
      var taille = vue.getUint32(position + 24, true);
      var longueurNom = vue.getUint16(position + 28, true);
      var longueurExtra = vue.getUint16(position + 30, true);
      var longueurCommentaire = vue.getUint16(position + 32, true);
      var decalageLocal = vue.getUint32(position + 42, true);
      var nom = decodeurUtf8.decode(octets.subarray(position + 46, position + 46 + longueurNom));
      position += 46 + longueurNom + longueurExtra + longueurCommentaire;

      if (drapeaux & 1) {
        throw new Error('Archive protégée par un mot de passe (contenu chiffré) : retirez la protection puis recommencez.');
      }
      if (tailleCompressee === 0xffffffff || taille === 0xffffffff || decalageLocal === 0xffffffff) {
        throw new Error('Archive au format ZIP64 : ce format dépasse ce que l’outil sait lire.');
      }
      if (nom.charAt(nom.length - 1) === '/') continue;
      if (decalageLocal + 30 > octets.length || vue.getUint32(decalageLocal, true) !== SIGNATURE_LOCALE) {
        throw new Error('Archive illisible : en-tête de fichier absent pour « ' + nom + ' ».');
      }
      var debut = decalageLocal + 30 + vue.getUint16(decalageLocal + 26, true) + vue.getUint16(decalageLocal + 28, true);
      if (debut + tailleCompressee > octets.length) {
        throw new Error('Archive illisible : contenu tronqué pour « ' + nom + ' ».');
      }
      var brut = octets.subarray(debut, debut + tailleCompressee);
      var donnees;
      if (methode === 0) {
        donnees = brut.slice();
      } else if (methode === 8) {
        try {
          donnees = await decompresser(brut);
        } catch (erreur) {
          throw new Error('Archive illisible : décompression impossible pour « ' + nom + ' ».');
        }
      } else {
        throw new Error('Archive illisible : méthode de compression inconnue pour « ' + nom + ' ».');
      }
      if (donnees.length !== taille || crc32(donnees) !== crcAttendu) {
        throw new Error('Archive illisible : somme de contrôle fausse pour « ' + nom + ' ».');
      }
      total += donnees.length;
      if (total > TAILLE_MAXIMALE) {
        throw new Error('Archive trop volumineuse une fois décompressée.');
      }
      entrees.push({ nom: nom, donnees: donnees });
    }
    return entrees;
  }

  /*
   * Écrit une archive à partir de [{ nom, donnees }].
   * Heure et date fixées au 1er janvier 1980 : l'archive produite ne révèle aucun horodatage.
   */
  async function ecrire(entrees) {
    var encodeur = new TextEncoder();
    var prepares = [];
    var tailleLocale = 0;
    var tailleCentrale = 0;
    for (var i = 0; i < entrees.length; i += 1) {
      var donnees = entrees[i].donnees;
      var nom = encodeur.encode(entrees[i].nom);
      var corps = donnees;
      var methode = 0;
      if (donnees.length > 0) {
        var compresse = await compresser(donnees);
        if (compresse.length < donnees.length) {
          corps = compresse;
          methode = 8;
        }
      }
      prepares.push({ nom: nom, corps: corps, methode: methode, crc: crc32(donnees), taille: donnees.length, decalage: tailleLocale });
      tailleLocale += 30 + nom.length + corps.length;
      tailleCentrale += 46 + nom.length;
    }
    var archive = new Uint8Array(tailleLocale + tailleCentrale + 22);
    var vue = new DataView(archive.buffer);
    var p = 0;
    prepares.forEach(function (e) {
      vue.setUint32(p, SIGNATURE_LOCALE, true);
      vue.setUint16(p + 4, 20, true); // version requise
      vue.setUint16(p + 6, 0x0800, true); // noms en UTF-8
      vue.setUint16(p + 8, e.methode, true);
      vue.setUint16(p + 10, 0, true); // heure
      vue.setUint16(p + 12, 0x0021, true); // date : 1er janvier 1980
      vue.setUint32(p + 14, e.crc, true);
      vue.setUint32(p + 18, e.corps.length, true);
      vue.setUint32(p + 22, e.taille, true);
      vue.setUint16(p + 26, e.nom.length, true);
      vue.setUint16(p + 28, 0, true);
      archive.set(e.nom, p + 30);
      archive.set(e.corps, p + 30 + e.nom.length);
      p += 30 + e.nom.length + e.corps.length;
    });
    var debutCentral = p;
    prepares.forEach(function (e) {
      vue.setUint32(p, SIGNATURE_CENTRALE, true);
      vue.setUint16(p + 4, 20, true); // version d'origine
      vue.setUint16(p + 6, 20, true); // version requise
      vue.setUint16(p + 8, 0x0800, true);
      vue.setUint16(p + 10, e.methode, true);
      vue.setUint16(p + 12, 0, true);
      vue.setUint16(p + 14, 0x0021, true);
      vue.setUint32(p + 16, e.crc, true);
      vue.setUint32(p + 20, e.corps.length, true);
      vue.setUint32(p + 24, e.taille, true);
      vue.setUint16(p + 28, e.nom.length, true);
      // extra, commentaire, disque, attributs internes et externes : zéro
      vue.setUint32(p + 42, e.decalage, true);
      archive.set(e.nom, p + 46);
      p += 46 + e.nom.length;
    });
    vue.setUint32(p, SIGNATURE_FIN, true);
    vue.setUint16(p + 8, prepares.length, true);
    vue.setUint16(p + 10, prepares.length, true);
    vue.setUint32(p + 12, p - debutCentral, true);
    vue.setUint32(p + 16, debutCentral, true);
    return archive;
  }

  return { crc32: crc32, lire: lire, ecrire: ecrire, fluxDisponibles: fluxDisponibles };
});
