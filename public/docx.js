/*
 * Fichiers Word (.docx) : une archive ZIP de fichiers XML, lue et réécrite sans bibliothèque.
 *  - ouvrir()   : lit l'archive, refuse les documents à commentaires, à modifications suivies
 *                 ou à données XML liées, compte les images, découpe le texte en blocs ;
 *  - produire() : écrit les remplacements dans le XML, vide les métadonnées, rend la nouvelle archive.
 * Un bloc est un paragraphe (son texte est reconstitué à partir des segments w:t),
 * un code de champ, une infobulle de lien ou la cible d'un lien externe.
 * Hors des remplacements, le XML reste identique, octet pour octet.
 */
(function (racine, fabrique) {
  'use strict';
  var node = typeof module === 'object' && module.exports;
  var api = fabrique(node ? require('./zip.js') : racine.Anonymiseur.zip);
  if (node) {
    module.exports = api;
  } else {
    racine.Anonymiseur.docx = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self, function (zip) {
  'use strict';

  var CIBLE_NEUTRE = 'about:blank';

  var REFUS = {
    commentaires: {
      code: 'commentaires',
      titre: 'Le document contient des commentaires.',
      marche: 'Dans Word : onglet « Révision », bouton « Supprimer », puis « Supprimer tous les commentaires du document ». Enregistrez, puis déposez le fichier de nouveau.',
    },
    modifications: {
      code: 'modifications',
      titre: 'Le document contient des modifications suivies.',
      marche: 'Dans Word : onglet « Révision », bouton « Accepter », puis « Accepter toutes les modifications et arrêter le suivi ». Enregistrez, puis déposez le fichier de nouveau.',
    },
    'donnees-liees': {
      code: 'donnees-liees',
      titre: 'Le document contient des données XML liées.',
      marche: 'Dans Word : « Fichier », « Informations », « Vérifier l’absence de problèmes », « Inspecter le document ». Gardez la case « Données XML personnalisées » cochée, lancez l’inspection, puis « Supprimer tout ». Enregistrez, puis déposez le fichier de nouveau.',
    },
  };

  /* ---------- Texte et XML ---------- */

  function decoder(xml) {
    return xml.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, function (tout, nom) {
      switch (nom) {
        case 'amp': return '&';
        case 'lt': return '<';
        case 'gt': return '>';
        case 'quot': return '"';
        case 'apos': return "'";
        default:
          return String.fromCodePoint(nom.charAt(1) === 'x' ? parseInt(nom.slice(2), 16) : parseInt(nom.slice(1), 10));
      }
    });
  }

  function encoder(texte, attribut) {
    var sortie = texte.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return attribut ? sortie.replace(/"/g, '&quot;') : sortie;
  }

  function enTexte(donnees) {
    return new TextDecoder('utf-8').decode(donnees);
  }

  function enOctets(texte) {
    return new TextEncoder().encode(texte);
  }

  /* ---------- Parties du document ---------- */

  function titreDePartie(nom) {
    if (nom === 'word/document.xml') return 'Corps du document';
    if (/^word\/header\d*\.xml$/.test(nom)) return 'En-tête';
    if (/^word\/footer\d*\.xml$/.test(nom)) return 'Pied de page';
    if (nom === 'word/footnotes.xml') return 'Notes de bas de page';
    if (nom === 'word/endnotes.xml') return 'Notes de fin';
    if (/\.rels$/.test(nom)) return 'Liens';
    return 'Autre partie (' + nom.replace(/^word\//, '') + ')';
  }

  function rangDePartie(nom) {
    if (nom === 'word/document.xml') return 0;
    if (/^word\/header\d*\.xml$/.test(nom)) return 1;
    if (/^word\/footer\d*\.xml$/.test(nom)) return 2;
    if (nom === 'word/footnotes.xml') return 3;
    if (nom === 'word/endnotes.xml') return 4;
    if (/\.rels$/.test(nom)) return 6;
    return 5;
  }

  function estXml(nom) {
    return /\.xml$/i.test(nom);
  }

  // Partie de texte : un fichier XML du dossier word/ qui contient des paragraphes.
  function partieDeTexte(nom, xml) {
    return /^word\//.test(nom) && estXml(nom) && /<(?:w|a):p[\s>]/.test(xml);
  }

  /* ---------- Contrôles à l'ouverture ---------- */

  function inspecter(entrees) {
    var refus = [];
    var images = 0;
    var objets = 0;
    var commentaires = false;
    var modifications = false;
    var liees = false;
    entrees.forEach(function (e) {
      if (/^word\/media\//.test(e.nom)) images += 1;
      if (/^word\/embeddings\//.test(e.nom)) objets += 1;
      if (e.nom.toLowerCase().indexOf('customxml/') === 0) liees = true;
      if (!/^word\//.test(e.nom) || !estXml(e.nom)) return;
      var xml = enTexte(e.donnees);
      if (/^word\/comments[^/]*\.xml$/.test(e.nom) && /<w:comment[\s>]/.test(xml)) commentaires = true;
      // w:ins, w:del, déplacements et changements de mise en forme suivis (w:rPrChange…) ;
      // w:insideH et w:delText portent d'autres noms et restent hors de ce motif.
      if (/<w:(?:ins|del|moveFrom|moveTo|\w+Change)[\s>\/]/.test(xml)) modifications = true;
    });
    if (commentaires) refus.push(REFUS.commentaires);
    if (modifications) refus.push(REFUS.modifications);
    if (liees) refus.push(REFUS['donnees-liees']);
    return { refus: refus, images: images, objets: objets };
  }

  /* ---------- Découpage d'une partie en blocs ---------- */

  function extraire(partie, xml) {
    var blocs = [];
    var pile = [];
    var re = /<!--[\s\S]*?-->|<[^>]+>/g;
    var m;

    function nouveau(type, ordre, technique) {
      return { partie: partie, titre: titreDePartie(partie), type: type, technique: Boolean(technique), ordre: ordre, texte: '', segments: [] };
    }
    function ajouter(bloc, segment) {
      segment.tDebut = bloc.texte.length;
      bloc.texte += segment.texte;
      bloc.segments.push(segment);
    }
    function attribut(balise, debutBalise, nom, type) {
      var a = new RegExp('\\s' + nom + '="([^"]*)"').exec(balise);
      if (!a || !a[1]) return;
      var debut = debutBalise + a.index + a[0].length - a[1].length - 1;
      var bloc = nouveau(type, debutBalise, true);
      ajouter(bloc, { reel: true, attribut: true, texte: decoder(a[1]), xDebut: debut, xFin: debut + a[1].length });
      blocs.push(bloc);
    }

    while ((m = re.exec(xml)) !== null) {
      var balise = m[0];
      var debut = m.index;
      var fin = debut + balise.length;
      var q = /^<(\/?)([\w.-]+(?::[\w.-]+)?)/.exec(balise);
      if (!q) continue;
      var fermante = q[1] === '/';
      var nom = q[2];
      var autofermante = /\/>$/.test(balise);
      var courant = pile[pile.length - 1];

      if (nom === 'w:p' || nom === 'a:p') {
        if (fermante) {
          var termine = pile.pop();
          if (termine) blocs.push(termine);
        } else if (!autofermante) {
          pile.push(nouveau('paragraphe', debut, false));
        }
      } else if ((nom === 'w:t' || nom === 'a:t' || nom === 'w:instrText') && !fermante && !autofermante) {
        var cloture = xml.indexOf('</' + nom + '>', fin);
        if (cloture < 0) continue;
        var segment = { reel: true, texte: decoder(xml.slice(fin, cloture)), xDebut: fin, xFin: cloture, bDebut: debut, bFin: fin, balise: nom };
        if (nom === 'w:instrText') {
          var champ = nouveau('champ', debut, true);
          ajouter(champ, segment);
          blocs.push(champ);
        } else if (courant) {
          ajouter(courant, segment);
        } else {
          var isole = nouveau('paragraphe', debut, false);
          ajouter(isole, segment);
          blocs.push(isole);
        }
        re.lastIndex = cloture;
      } else if (courant && !fermante && balise === '<w:tab/>') {
        ajouter(courant, { reel: false, texte: '\t' });
      } else if (courant && !fermante && (nom === 'w:br' || nom === 'w:cr')) {
        ajouter(courant, { reel: false, texte: '\n' });
      } else if (courant && !fermante && nom === 'w:noBreakHyphen') {
        ajouter(courant, { reel: false, texte: '-' });
      } else if (!fermante && nom === 'w:hyperlink') {
        attribut(balise, debut, 'w:tooltip', 'infobulle');
      } else if (!fermante && nom === 'w:fldSimple') {
        attribut(balise, debut, 'w:instr', 'champ');
      }
    }
    while (pile.length) blocs.push(pile.pop());

    return blocs
      .filter(function (b) {
        return b.texte.trim() !== '';
      })
      .sort(function (a, b) {
        return a.ordre - b.ordre;
      });
  }

  // Cibles des liens externes d'un fichier de relations (mailto:, adresse web, chemin de fichier).
  function extraireLiens(partie, xml) {
    var blocs = [];
    var re = /<Relationship\b[^>]*>/g;
    var m;
    while ((m = re.exec(xml)) !== null) {
      var balise = m[0];
      if (!/\sTargetMode="External"/.test(balise) || /\/attachedTemplate"/.test(balise)) continue;
      var cible = /\sTarget="([^"]*)"/.exec(balise);
      if (!cible || !cible[1]) continue;
      var debut = m.index + cible.index + cible[0].length - cible[1].length - 1;
      var texte = decoder(cible[1]);
      blocs.push({
        partie: partie,
        titre: titreDePartie(partie),
        type: 'lien',
        technique: true,
        ordre: m.index,
        texte: texte,
        segments: [{ reel: true, attribut: true, texte: texte, tDebut: 0, xDebut: debut, xFin: debut + cible[1].length }],
      });
    }
    return blocs;
  }

  /* ---------- Écriture des remplacements ---------- */

  /*
   * Le remplacement s'écrit dans le premier segment touché ; le texte couvert est retiré des suivants.
   * La mise en forme du premier segment s'applique donc à l'étiquette.
   */
  function reecrire(xml, blocs, plans) {
    var modifications = [];
    blocs.forEach(function (bloc, n) {
      var plan = plans[n];
      if (!plan || !plan.length) return;
      if (bloc.type === 'lien') {
        var cible = bloc.segments[0];
        modifications.push({ debut: cible.xDebut, fin: cible.xFin, texte: CIBLE_NEUTRE });
        return;
      }
      var reels = bloc.segments.filter(function (s) { return s.reel; });
      var ancres = plan.map(function (r) {
        for (var i = 0; i < reels.length; i += 1) {
          var s = reels[i];
          if (s.tDebut < r.fin && s.tDebut + s.texte.length > r.debut) return s;
        }
        return null;
      });
      reels.forEach(function (s) {
        var a = s.tDebut;
        var b = a + s.texte.length;
        var sortie = '';
        var position = a;
        var touche = false;
        plan.forEach(function (r, k) {
          if (!(r.debut < b && r.fin > a) || !ancres[k]) return;
          touche = true;
          sortie += s.texte.slice(position - a, Math.max(r.debut, a) - a);
          if (ancres[k] === s) sortie += r.nouveau;
          position = Math.min(r.fin, b);
        });
        if (!touche) return;
        sortie += s.texte.slice(position - a);
        modifications.push({ debut: s.xDebut, fin: s.xFin, texte: encoder(sortie, s.attribut) });
        if (s.balise === 'w:t' || s.balise === 'w:instrText') {
          var ouvrante = xml.slice(s.bDebut, s.bFin);
          if (!/xml:space=/.test(ouvrante)) {
            modifications.push({ debut: s.bDebut, fin: s.bFin, texte: ouvrante.replace(/>$/, ' xml:space="preserve">') });
          }
        }
      });
    });
    modifications.sort(function (x, y) {
      return y.debut - x.debut;
    });
    var sortieXml = xml;
    modifications.forEach(function (mo) {
      sortieXml = sortieXml.slice(0, mo.debut) + mo.texte + sortieXml.slice(mo.fin);
    });
    return sortieXml;
  }

  // Nom, description et titre des images : souvent le nom du fichier d'origine ou son chemin sur le poste.
  function neutraliserDessins(xml) {
    return xml.replace(/<(?:wp:docPr|pic:cNvPr)\b[^>]*>/g, function (balise) {
      return balise
        .replace(/(\sname=")[^"]*"/, '$1Image"')
        .replace(/(\sdescr=")[^"]*"/, '$1"')
        .replace(/(\stitle=")[^"]*"/, '$1"');
    });
  }

  /* ---------- Métadonnées ---------- */

  // Garde l'élément racine (avec ses espaces de noms) et retire tout son contenu.
  function viderRacine(xml) {
    var racine = /<([\w.-]+(?::[\w.-]+)?)\b[^>]*?(\/?)>/g;
    var m;
    while ((m = racine.exec(xml)) !== null) {
      if (m[0].charAt(1) === '?' || m[0].charAt(1) === '!') continue;
      if (m[2] === '/') return xml;
      return xml.slice(0, m.index + m[0].length) + '</' + m[1] + '>';
    }
    return xml;
  }

  function dossierDesRelations(nomRels) {
    return nomRels.replace(/_rels\/[^/]*\.rels$/, '');
  }

  function resoudreChemin(base, cible) {
    if (cible.charAt(0) === '/') return cible.slice(1);
    var morceaux = (base + cible).split('/');
    var sortie = [];
    morceaux.forEach(function (x) {
      if (x === '..') sortie.pop();
      else if (x !== '.' && x !== '') sortie.push(x);
    });
    return sortie.join('/');
  }

  // Retire une partie de l'archive, sa déclaration de type et les relations qui la désignent.
  function retirerPartie(textes, nom) {
    if (!(nom in textes.contenus)) return;
    delete textes.contenus[nom];
    textes.retires[nom] = true;
    var types = '[Content_Types].xml';
    if (typeof textes.contenus[types] === 'string') {
      textes.contenus[types] = textes.contenus[types].replace(/<Override\b[^>]*>/g, function (balise) {
        return balise.indexOf('PartName="/' + nom + '"') >= 0 ? '' : balise;
      });
    }
    Object.keys(textes.contenus).forEach(function (rels) {
      if (!/\.rels$/.test(rels) || typeof textes.contenus[rels] !== 'string') return;
      var base = dossierDesRelations(rels);
      textes.contenus[rels] = textes.contenus[rels].replace(/<Relationship\b[^>]*>/g, function (balise) {
        if (/\sTargetMode="External"/.test(balise)) return balise;
        var cible = /\sTarget="([^"]*)"/.exec(balise);
        return cible && resoudreChemin(base, decoder(cible[1])) === nom ? '' : balise;
      });
    });
  }

  function viderMetadonnees(textes) {
    ['docProps/core.xml', 'docProps/app.xml'].forEach(function (nom) {
      if (typeof textes.contenus[nom] === 'string') textes.contenus[nom] = viderRacine(textes.contenus[nom]);
    });
    Object.keys(textes.contenus).forEach(function (nom) {
      // propriétés personnalisées, vignette de la première page, liste des auteurs de commentaires
      if (nom === 'docProps/custom.xml' || /^docProps\/thumbnail\./i.test(nom) || nom === 'word/people.xml') retirerPartie(textes, nom);
    });
    // Chemin du modèle attaché : il porte souvent le nom de session du poste.
    Object.keys(textes.contenus).forEach(function (nom) {
      if (!/\.rels$/.test(nom) || typeof textes.contenus[nom] !== 'string') return;
      textes.contenus[nom] = textes.contenus[nom].replace(/<Relationship\b[^>]*\/attachedTemplate"[^>]*>/g, function (balise) {
        return balise.replace(/(\sTarget=")[^"]*"/, '$1Normal.dotm"');
      });
    });
  }

  // Ce qui doit avoir disparu d'un document produit ; rend la liste des écarts.
  function verifierSortie(entrees) {
    var ecarts = [];
    entrees.forEach(function (e) {
      if (e.nom === 'docProps/custom.xml' || /^docProps\/thumbnail\./i.test(e.nom) || e.nom === 'word/people.xml') {
        ecarts.push('La partie « ' + e.nom + ' » est encore présente.');
      }
      if (e.nom === 'docProps/core.xml' || e.nom === 'docProps/app.xml') {
        if (enTexte(e.donnees).replace(/<[^>]+>/g, '').trim() !== '') ecarts.push('Les métadonnées de « ' + e.nom + ' » contiennent encore du texte.');
      }
    });
    var etat = inspecter(entrees);
    etat.refus.forEach(function (r) {
      ecarts.push(r.titre);
    });
    return ecarts;
  }

  /* ---------- Ouverture et production ---------- */

  function construire(entrees) {
    var etat = inspecter(entrees);
    var doc = { entrees: entrees, refus: etat.refus, images: etat.images, objets: etat.objets, blocs: [], parties: [] };
    if (etat.refus.length) return doc;
    var parties = [];
    entrees.forEach(function (e) {
      var relations = /\.rels$/.test(e.nom);
      if (!relations && !(/^word\//.test(e.nom) && estXml(e.nom))) return;
      var xml = enTexte(e.donnees);
      var blocs = relations ? extraireLiens(e.nom, xml) : partieDeTexte(e.nom, xml) ? extraire(e.nom, xml) : null;
      if (blocs === null) return;
      parties.push({ nom: e.nom, xml: xml, blocs: blocs, texte: !relations });
    });
    parties.sort(function (a, b) {
      return rangDePartie(a.nom) - rangDePartie(b.nom) || (a.nom < b.nom ? -1 : 1);
    });
    parties.forEach(function (partie) {
      partie.blocs.forEach(function (bloc) {
        bloc.indice = doc.blocs.length;
        doc.blocs.push(bloc);
      });
    });
    doc.parties = parties;
    return doc;
  }

  async function ouvrir(octets) {
    var entrees = await zip.lire(octets);
    if (!entrees.some(function (e) { return e.nom === 'word/document.xml'; })) {
      throw new Error('Un document Word au format .docx est attendu ; ce fichier a un autre format. Enregistrez-le en .docx depuis Word, ou collez son texte.');
    }
    return construire(entrees);
  }

  /*
   * plans : un tableau aligné sur doc.blocs ; pour chaque bloc, la liste [{ debut, fin, nouveau }].
   */
  async function produire(doc, plans) {
    if (doc.refus.length) {
      throw new Error('Document refusé : ' + doc.refus.map(function (r) { return r.titre; }).join(' '));
    }
    var textes = { contenus: Object.create(null), retires: Object.create(null) };
    doc.entrees.forEach(function (e) {
      textes.contenus[e.nom] = estXml(e.nom) || /\.rels$/.test(e.nom) ? enTexte(e.donnees) : e.donnees;
    });
    doc.parties.forEach(function (partie) {
      var plansDePartie = partie.blocs.map(function (b) {
        return (plans && plans[b.indice]) || [];
      });
      var xml = reecrire(partie.xml, partie.blocs, plansDePartie);
      textes.contenus[partie.nom] = partie.texte ? neutraliserDessins(xml) : xml;
    });
    viderMetadonnees(textes);
    var sortie = [];
    doc.entrees.forEach(function (e) {
      if (textes.retires[e.nom]) return;
      var contenu = textes.contenus[e.nom];
      if (typeof contenu !== 'string') {
        sortie.push({ nom: e.nom, donnees: contenu });
        return;
      }
      // Une partie laissée intacte garde ses octets d'origine.
      sortie.push({ nom: e.nom, donnees: contenu === enTexte(e.donnees) ? e.donnees : enOctets(contenu) });
    });
    return zip.ecrire(sortie);
  }

  /*
   * Textes à passer au contrôle de sortie : tous les blocs, puis le texte brut
   * des fichiers XML que le découpage en blocs laisse de côté (graphiques, par exemple).
   */
  function textesDeControle(doc) {
    var textes = doc.blocs.map(function (b) {
      return { partie: b.partie, titre: b.titre, texte: b.texte, traitee: true };
    });
    var traitees = Object.create(null);
    doc.parties.forEach(function (partie) {
      if (partie.texte) traitees[partie.nom] = true;
    });
    doc.entrees.forEach(function (e) {
      if (!estXml(e.nom) || traitees[e.nom] || /^docProps\//.test(e.nom) || e.nom === '[Content_Types].xml') return;
      var morceaux = [];
      enTexte(e.donnees)
        .replace(/<!--[\s\S]*?-->/g, '')
        .split(/<[^>]+>/)
        .forEach(function (x) {
          var t = decoder(x).trim();
          if (t) morceaux.push(t);
        });
      if (morceaux.length) textes.push({ partie: e.nom, titre: titreDePartie(e.nom), texte: morceaux.join('\n'), traitee: false });
    });
    return textes;
  }

  return {
    ouvrir: ouvrir,
    produire: produire,
    construire: construire,
    inspecter: inspecter,
    extraire: extraire,
    reecrire: reecrire,
    verifierSortie: verifierSortie,
    textesDeControle: textesDeControle,
    CIBLE_NEUTRE: CIBLE_NEUTRE,
  };
});
