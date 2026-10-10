/*
 * Interface de la page : trois temps (préparer, relire, exporter).
 * La logique vit dans les autres fichiers (détecteurs, noms, remplacement, zip, docx, sortie) ;
 * ce fichier lit les saisies, affiche les résultats et déclenche le téléchargement.
 * Tout reste dans la mémoire de la page : rien n'est envoyé, rien n'est écrit sur le poste
 * en dehors du fichier que l'utilisateur télécharge lui-même.
 */
(function () {
  'use strict';

  var A = self.Anonymiseur;
  var TAILLE_MAXIMALE = 40 * 1024 * 1024;
  var TYPE_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  var TITRES = {
    NOM: 'Noms',
    ADRESSE: 'Adresses postales',
    COURRIEL: 'Courriels',
    TELEPHONE: 'Téléphones',
    URL: 'Adresses web',
    DATE: 'Dates',
    IBAN: 'IBAN',
    NIR: 'Numéros de sécurité sociale',
    SIREN: 'SIREN',
    SIRET: 'SIRET',
    IMMATRICULATION: 'Immatriculations',
    NUMERO: 'Numéros longs',
    MONTANT: 'Montants',
  };
  var ORDRE = Object.keys(TITRES);
  var GROUPES = {
    NOM: 'nom',
    ADRESSE: 'contact',
    COURRIEL: 'contact',
    TELEPHONE: 'contact',
    URL: 'contact',
    DATE: 'date',
    MONTANT: 'montant',
    IBAN: 'identifiant',
    NIR: 'identifiant',
    SIREN: 'identifiant',
    SIRET: 'identifiant',
    IMMATRICULATION: 'identifiant',
    NUMERO: 'identifiant',
  };
  var GENRES = { champ: 'Code de champ', infobulle: 'Infobulle de lien', lien: 'Cible de lien' };

  var etat = {
    session: null,
    fichier: null, // fichier choisi ou déposé
    doc: null, // { genre, blocs, docx, images, objets, numero }
    candidats: [], // détections candidates, par bloc
    coches: new Map(), // choix explicites de l'utilisateur : clé -> vrai ou faux
    termes: [], // liste de noms fournie, expressions ajoutées comprises
    options: { modeDates: 'decaler', masquerMontants: false },
    rendu: [], // par bloc : { actives, gardees, plan, produit }
    produit: null, // { octets | texte, nom }
    selection: '',
  };

  /* ---------- Outils d'affichage ---------- */

  function $(id) {
    return document.getElementById(id);
  }

  function element(balise, attributs, enfants) {
    var e = document.createElement(balise);
    Object.keys(attributs || {}).forEach(function (nom) {
      var valeur = attributs[nom];
      if (valeur === false || valeur === null || valeur === undefined) return;
      if (nom === 'texte') e.textContent = valeur;
      else if (nom === 'classe') e.className = valeur;
      else if (valeur === true) e.setAttribute(nom, '');
      else e.setAttribute(nom, valeur);
    });
    (enfants || []).forEach(function (enfant) {
      e.appendChild(typeof enfant === 'string' ? document.createTextNode(enfant) : enfant);
    });
    return e;
  }

  function vider(noeud) {
    while (noeud.firstChild) noeud.removeChild(noeud.firstChild);
  }

  function annoncer(message) {
    $('annonce').textContent = message;
  }

  function pluriel(n, singulier, plurielle) {
    return n + ' ' + (n > 1 ? plurielle : singulier);
  }

  function montrerErreur(zone, messages) {
    vider(zone);
    messages.forEach(function (m) {
      zone.appendChild(element('p', { texte: m }));
    });
    zone.hidden = messages.length === 0;
  }

  function allerA(etape) {
    ['preparer', 'relire', 'exporter'].forEach(function (nom) {
      $('etape-' + nom).hidden = nom !== etape;
      if (nom === etape) $('repere-' + nom).setAttribute('aria-current', 'step');
      else $('repere-' + nom).removeAttribute('aria-current');
    });
    var titre = $('titre-' + etape);
    titre.focus();
    titre.scrollIntoView({ block: 'start' });
  }

  /* ---------- Contrôle du navigateur ---------- */

  function controlerNavigateur() {
    var manques = [];
    try {
      new RegExp('(?<![\\p{L}\\p{N}])a', 'u');
    } catch (erreur) {
      manques.push('regles');
    }
    if (typeof TextDecoder !== 'function' || typeof Blob !== 'function' || !Blob.prototype.arrayBuffer) manques.push('fichiers');
    var zone = $('incompatible');
    if (manques.length) {
      montrerErreur(zone, [
        'Ce navigateur est trop ancien pour cet outil. Utilisez une version de 2023 ou plus récente de Chrome, Edge, Firefox ou Safari.',
      ]);
      $('analyser').disabled = true;
      return false;
    }
    if (!A.zip.fluxDisponibles()) {
      montrerErreur(zone, [
        'Ce navigateur lit le texte collé et les fichiers .txt. Pour un fichier Word .docx, utilisez une version de 2023 ou plus récente de Chrome, Edge, Firefox ou Safari.',
      ]);
    }
    return true;
  }

  /* ---------- Session ---------- */

  function nouvelleSession() {
    etat.session = A.remplacement.creerSession();
    etat.coches = new Map();
    etat.termes = [];
    oublierDocument();
    afficherSession();
  }

  function oublierDocument() {
    etat.doc = null;
    etat.candidats = [];
    etat.rendu = [];
    etat.produit = null;
    etat.coches = new Map();
    retirerFichier();
    $('texte-colle').value = '';
    $('texte-produit').value = '';
    vider($('texte-relu'));
    vider($('liste-detections'));
    vider($('a-verifier'));
    montrerErreur($('erreur-preparer'), []);
  }

  function afficherSession() {
    var etiquettes = etat.session.etiquettes.size;
    var documents = etat.session.documents;
    $('etat-session').textContent =
      etiquettes || documents
        ? 'Session en cours : ' + pluriel(etiquettes, 'étiquette attribuée', 'étiquettes attribuées') + ', ' + pluriel(documents, 'document exporté', 'documents exportés') + '. Une même valeur garde son étiquette d’un document à l’autre.'
        : '';
  }

  /* ---------- Temps 1 : préparer ---------- */

  function choisirFichier(fichier) {
    etat.fichier = fichier || null;
    $('fichier-choisi').textContent = fichier ? 'Fichier choisi : ' + fichier.name + ' (' + Math.max(1, Math.round(fichier.size / 1024)) + ' Ko).' : '';
    $('retirer-fichier').hidden = !fichier;
  }

  function retirerFichier() {
    $('fichier').value = '';
    choisirFichier(null);
  }

  function extension(nom) {
    var m = /\.([A-Za-z0-9]+)$/.exec(nom || '');
    return m ? m[1].toLowerCase() : '';
  }

  function decoderTexte(tampon) {
    var octets = new Uint8Array(tampon);
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(octets);
    } catch (erreur) {
      // Fichier texte ancien, enregistré dans le codage de Windows.
      return new TextDecoder('windows-1252').decode(octets);
    }
  }

  async function chargerDocument() {
    var colle = $('texte-colle').value;
    var fichier = etat.fichier;
    if (fichier && colle.trim()) {
      throw new Error('Un fichier est choisi et un texte est collé. Gardez l’un des deux : retirez le fichier ou videz la zone de texte.');
    }
    if (!fichier && !colle.trim()) {
      throw new Error('Déposez un fichier .docx ou .txt, ou collez un texte.');
    }
    if (!fichier) {
      return { genre: 'texte', blocs: [{ texte: colle, technique: false }], images: 0, objets: 0 };
    }
    if (fichier.size > TAILLE_MAXIMALE) {
      throw new Error('Ce fichier dépasse 40 Mo. Allégez-le (les images pèsent le plus) ou collez son texte.');
    }
    var ext = extension(fichier.name);
    if (ext === 'txt') {
      var texte = decoderTexte(await fichier.arrayBuffer());
      if (!texte.trim()) throw new Error('Ce fichier texte est vide.');
      return { genre: 'texte', blocs: [{ texte: texte, technique: false }], images: 0, objets: 0 };
    }
    if (ext === 'docx') {
      if (!A.zip.fluxDisponibles()) {
        throw new Error('Ce navigateur ne sait pas ouvrir un fichier .docx. Utilisez une version de 2023 ou plus récente de Chrome, Edge, Firefox ou Safari, ou collez le texte.');
      }
      var ouvert;
      try {
        ouvert = await A.docx.ouvrir(new Uint8Array(await fichier.arrayBuffer()));
      } catch (erreur) {
        throw new Error(erreur.message + ' Si le document est protégé par un mot de passe, retirez la protection dans Word, enregistrez, puis recommencez.');
      }
      if (ouvert.refus.length) {
        var messages = ['Ce document ne peut être traité en l’état. Ces parties gardent des noms et du texte supprimé que l’écran de relecture ne montre jamais.'];
        ouvert.refus.forEach(function (r) {
          messages.push(r.titre + ' ' + r.marche);
        });
        var refus = new Error(messages[0]);
        refus.messages = messages;
        throw refus;
      }
      if (!ouvert.blocs.length) throw new Error('Ce document ne contient aucun texte lisible. Un document scanné se prépare à la main.');
      return { genre: 'docx', blocs: ouvert.blocs, docx: ouvert, images: ouvert.images, objets: ouvert.objets };
    }
    if (['doc', 'dot', 'rtf', 'odt', 'xls', 'xlsx', 'docm', 'dotx'].indexOf(ext) >= 0) {
      throw new Error('Format .' + ext + ' : ouvrez le fichier dans Word, enregistrez-le au format .docx, ou collez son texte dans la zone prévue.');
    }
    if (ext === 'pdf') {
      throw new Error('Les fichiers PDF restent hors de portée de cette version. Collez le texte du PDF dans la zone prévue ; un document scanné se prépare à la main.');
    }
    throw new Error('Format de fichier inconnu. Formats lus : .docx et .txt, ou texte collé.');
  }

  function lireOptions() {
    var mode = 'decaler';
    ['decaler', 'etiquette', 'conserver'].forEach(function (m) {
      if ($('dates-' + m).checked) mode = m;
    });
    etat.options = { modeDates: mode, masquerMontants: $('masquer-montants').checked };
    etat.termes = A.noms.lireListe($('liste-noms').value);
  }

  async function lancerAnalyse() {
    var bouton = $('analyser');
    montrerErreur($('erreur-preparer'), []);
    bouton.disabled = true;
    annoncer('Analyse en cours.');
    try {
      lireOptions();
      etat.doc = await chargerDocument();
      etat.coches = new Map();
      etat.produit = null;
      analyser();
      afficherRelecture();
      allerA('relire');
      annoncer('Analyse terminée. ' + $('resume-relire').textContent);
    } catch (erreur) {
      montrerErreur($('erreur-preparer'), erreur.messages || [erreur.message || 'Le document n’a pas pu être lu.']);
      annoncer('L’analyse a échoué.');
    } finally {
      bouton.disabled = false;
    }
  }

  /* ---------- Calcul ---------- */

  function analyser() {
    etat.candidats = A.remplacement.analyser(etat.doc.blocs, etat.termes);
  }

  function calculer() {
    etat.rendu = etat.doc.blocs.map(function (bloc, i) {
      var r = A.remplacement.remplacer(bloc.texte, etat.candidats[i], etat.session, etat.options, etat.coches);
      return { actives: r.actives, gardees: r.gardees, plan: r.plan, produit: r.texte };
    });
  }

  // Lignes de la liste de droite : une par valeur visible dans le texte.
  function lignes() {
    var parCle = new Map();
    function noter(detection, cochee, nouveau) {
      var ligne = parCle.get(detection.cle);
      if (!ligne) {
        ligne = { cle: detection.cle, categorie: detection.categorie, valeur: detection.valeur, source: detection.source, occurrences: 0, cochee: cochee, nouveau: nouveau };
        parCle.set(detection.cle, ligne);
      }
      ligne.occurrences += 1;
      if (cochee && !ligne.nouveau) ligne.nouveau = nouveau;
    }
    etat.rendu.forEach(function (r) {
      r.plan.forEach(function (p) {
        noter(p.detection, true, p.nouveau);
      });
      r.gardees.forEach(function (d) {
        noter(d, false, '');
      });
    });
    return Array.from(parCle.values());
  }

  /* ---------- Temps 2 : relire ---------- */

  function marque(texte, detection, classe, infobulle) {
    var m = element('mark', { classe: classe + ' groupe-' + GROUPES[detection.categorie], title: infobulle, texte: texte });
    m.dataset.cle = detection.cle;
    return m;
  }

  function afficherTexte() {
    var zone = $('texte-relu');
    var apercu = $('vue-apercu').checked;
    var haut = zone.scrollTop;
    vider(zone);
    var partie = null;
    etat.doc.blocs.forEach(function (bloc, i) {
      var r = etat.rendu[i];
      if (etat.doc.genre === 'docx' && bloc.titre !== partie) {
        partie = bloc.titre;
        zone.appendChild(element('h4', { classe: 'partie', texte: partie }));
      }
      var p = element(etat.doc.genre === 'docx' ? 'p' : 'div', { classe: 'bloc' });
      if (GENRES[bloc.type]) p.appendChild(element('span', { classe: 'genre', texte: GENRES[bloc.type] }));
      var reperes = r.plan
        .map(function (x) {
          return { debut: x.debut, fin: x.fin, detection: x.detection, nouveau: x.nouveau, active: true };
        })
        .concat(
          r.gardees.map(function (d) {
            return { debut: d.debut, fin: d.fin, detection: d, active: false };
          })
        )
        .sort(function (a, b) {
          return a.debut - b.debut;
        });
      var position = 0;
      reperes.forEach(function (x) {
        if (x.debut < position) return;
        p.appendChild(document.createTextNode(bloc.texte.slice(position, x.debut)));
        var origine = bloc.texte.slice(x.debut, x.fin);
        var titre = TITRES[x.detection.categorie];
        if (!x.active) {
          p.appendChild(marque(origine, x.detection, 'gardee', titre + ' : gardé dans le texte'));
        } else if (apercu) {
          p.appendChild(marque(x.nouveau, x.detection, 'posee', titre + ' : remplace « ' + origine + ' »'));
        } else {
          p.appendChild(marque(origine, x.detection, 'detectee', titre + ' : remplacé par ' + x.nouveau));
        }
        position = x.fin;
      });
      p.appendChild(document.createTextNode(bloc.texte.slice(position)));
      zone.appendChild(p);
    });
    zone.scrollTop = haut;
  }

  function afficherLegende() {
    var zone = $('legende');
    vider(zone);
    zone.appendChild(document.createTextNode('Légende : '));
    [
      ['nom', 'nom'],
      ['contact', 'coordonnée'],
      ['identifiant', 'numéro'],
      ['date', 'date'],
      ['montant', 'montant'],
    ].forEach(function (g) {
      zone.appendChild(element('mark', { classe: 'detectee groupe-' + g[0], texte: g[1] }));
    });
    zone.appendChild(element('mark', { classe: 'gardee', texte: 'gardé dans le texte' }));
  }

  function basculer(cles, valeur, foyer) {
    cles.forEach(function (cle) {
      etat.coches.set(cle, valeur);
    });
    etat.produit = null;
    afficherRelecture(foyer);
  }

  function afficherListe(foyer) {
    var zone = $('liste-detections');
    var haut = zone.parentNode.scrollTop;
    vider(zone);
    var toutes = lignes();
    var numero = 0;
    if (!toutes.length) {
      zone.appendChild(element('p', { classe: 'aide', texte: 'Aucun élément reconnu par les règles. Relisez le texte et ajoutez les noms à masquer.' }));
    }
    ORDRE.forEach(function (categorie) {
      var groupe = toutes.filter(function (l) {
        return l.categorie === categorie;
      });
      if (!groupe.length) return;
      var cochees = groupe.filter(function (l) {
        return l.cochee;
      }).length;
      var bouton = element('button', {
        type: 'button',
        classe: 'petit',
        texte: cochees ? 'Tout décocher' : 'Tout cocher',
        'aria-label': (cochees ? 'Tout décocher' : 'Tout cocher') + ' : ' + TITRES[categorie],
      });
      bouton.dataset.foyer = 'categorie:' + categorie;
      bouton.addEventListener('click', function () {
        basculer(
          groupe.map(function (l) {
            return l.cle;
          }),
          !cochees,
          'categorie:' + categorie
        );
      });
      zone.appendChild(element('div', { classe: 'categorie' }, [element('h4', { texte: TITRES[categorie] + ' (' + groupe.length + ')' }), bouton]));
      var liste = element('ul', { classe: 'lignes' });
      groupe.forEach(function (ligne) {
        numero += 1;
        var id = 'detection-' + numero;
        var case_ = element('input', { type: 'checkbox', id: id, checked: ligne.cochee });
        case_.checked = ligne.cochee;
        case_.dataset.foyer = ligne.cle;
        case_.addEventListener('change', function () {
          basculer([ligne.cle], case_.checked, ligne.cle);
        });
        var detail = element('span', { classe: 'detail' }, [pluriel(ligne.occurrences, 'occurrence', 'occurrences')]);
        if (ligne.categorie === 'NOM') detail.appendChild(document.createTextNode(ligne.source === 'liste' ? ', de votre liste' : ', proposé par les règles'));
        if (ligne.cochee) {
          detail.appendChild(document.createTextNode(', remplacé par '));
          detail.appendChild(element('span', { classe: 'etiquette', texte: ligne.nouveau }));
        } else {
          detail.appendChild(document.createTextNode(', gardé dans le texte'));
        }
        liste.appendChild(element('li', {}, [case_, element('label', { for: id }, [element('span', { classe: 'valeur', texte: ligne.valeur }), detail])]));
      });
      zone.appendChild(liste);
    });
    zone.parentNode.scrollTop = haut;
    if (foyer) {
      var cibles = zone.querySelectorAll('[data-foyer]');
      for (var i = 0; i < cibles.length; i += 1) {
        if (cibles[i].dataset.foyer === foyer) {
          cibles[i].focus();
          break;
        }
      }
    }
    return toutes;
  }

  function afficherAVerifier() {
    var zone = $('a-verifier');
    vider(zone);
    var reste = A.sortie.aVerifier(
      etat.rendu
        .map(function (r) {
          return r.produit;
        })
        .join('\n')
    );
    var familles = [
      ['Mots à majuscule initiale', reste.initiales],
      ['Mots en majuscules', reste.majuscules],
      ['Suites de chiffres', reste.chiffres],
    ];
    var total = 0;
    familles.forEach(function (famille) {
      if (!famille[1].length) return;
      total += famille[1].length;
      zone.appendChild(element('h4', { texte: famille[0] + ' (' + famille[1].length + ')' }));
      var liste = element('ul', { classe: 'reste-a-voir' });
      famille[1].slice(0, 150).forEach(function (item) {
        var bouton = element('button', { type: 'button', classe: 'petit', texte: 'Masquer', 'aria-label': 'Masquer « ' + item.valeur + ' » partout' });
        bouton.addEventListener('click', function () {
          ajouterExpression(item.valeur);
        });
        liste.appendChild(element('li', {}, [item.valeur + (item.occurrences > 1 ? ' × ' + item.occurrences : ''), bouton]));
      });
      zone.appendChild(liste);
      if (famille[1].length > 150) zone.appendChild(element('p', { classe: 'aide', texte: 'Liste limitée aux 150 premiers ; relisez le texte pour la suite.' }));
    });
    if (!total) zone.appendChild(element('p', { classe: 'aide', texte: 'Rien à signaler par ces trois règles. La relecture complète reste nécessaire.' }));
  }

  function afficherAvis() {
    var zone = $('avis-document');
    var messages = [];
    if (etat.doc.images) {
      messages.push(
        'Ce document contient ' + pluriel(etat.doc.images, 'image', 'images') + ' (logo, signature, tampon, pièce scannée insérée). L’outil laisse les images telles quelles : vérifiez-les dans Word avant le dépôt.'
      );
    }
    if (etat.doc.objets) {
      messages.push('Ce document contient ' + pluriel(etat.doc.objets, 'objet incorporé', 'objets incorporés') + ' (feuille de calcul, graphique, autre fichier), laissé tel quel par l’outil.');
    }
    montrerErreur(zone, messages);
  }

  function afficherRelecture(foyer) {
    calculer();
    afficherTexte();
    var toutes = afficherListe(foyer);
    afficherAVerifier();
    afficherAvis();
    var remplacees = 0;
    var gardees = 0;
    etat.rendu.forEach(function (r) {
      remplacees += r.plan.length;
      gardees += r.gardees.length;
    });
    $('resume-relire').textContent =
      pluriel(toutes.length, 'valeur détectée', 'valeurs détectées') + ' : ' + pluriel(remplacees, 'occurrence remplacée', 'occurrences remplacées') + ', ' + pluriel(gardees, 'occurrence gardée', 'occurrences gardées') + ' dans le texte.';
    afficherSession();
  }

  function ajouterExpression(brute) {
    var expression = String(brute || '').replace(/\s+/g, ' ').trim();
    if (expression.length < 2) {
      annoncer('Sélectionnez ou saisissez au moins deux caractères.');
      return;
    }
    var zone = $('liste-noms');
    zone.value = zone.value.replace(/\s+$/, '') + (zone.value.trim() ? '\n' : '') + expression;
    etat.termes = A.noms.lireListe(zone.value);
    etat.produit = null;
    analyser();
    afficherRelecture();
    $('expression').value = '';
    annoncer('« ' + expression + ' » est maintenant masqué partout. ' + $('resume-relire').textContent);
  }

  function suivreSelection() {
    var selection = document.getSelection();
    var texte = '';
    if (selection && !selection.isCollapsed && selection.anchorNode && $('texte-relu').contains(selection.anchorNode) && $('texte-relu').contains(selection.focusNode)) {
      texte = selection.toString().replace(/\s+/g, ' ').trim();
    }
    if (texte.length >= 2 && texte.length <= 120) {
      etat.selection = texte;
      $('masquer-selection').disabled = false;
    } else if (document.activeElement !== $('masquer-selection')) {
      etat.selection = '';
      $('masquer-selection').disabled = true;
    }
  }

  /* ---------- Temps 3 : exporter ---------- */

  function reglagesDeControle() {
    return {
      termes: etat.termes,
      gardees: A.sortie.clesGardees(etat.candidats, etat.options, etat.coches),
      datesProduites: etat.session.datesProduites,
    };
  }

  async function preparerExport() {
    var bouton = $('vers-exporter');
    bouton.disabled = true;
    try {
      calculer();
      var reglages = reglagesDeControle();
      var resultat;
      if (etat.doc.genre === 'docx') {
        var plans = etat.rendu.map(function (r) {
          return r.plan;
        });
        var octets = await A.docx.produire(etat.doc.docx, plans);
        resultat = await A.sortie.controlerDocx(octets, reglages);
        etat.produit = { octets: octets, extension: 'docx' };
      } else {
        var texte = etat.rendu[0].produit;
        resultat = { restes: A.sortie.controler([texte], reglages), ecarts: [] };
        etat.produit = { texte: texte, extension: 'txt' };
      }
      afficherExport(resultat);
      allerA('exporter');
    } catch (erreur) {
      etat.produit = null;
      afficherExport({ restes: [], ecarts: ['Le fichier n’a pas pu être produit : ' + (erreur.message || 'erreur inattendue') + '.'] });
      allerA('exporter');
    } finally {
      bouton.disabled = false;
    }
  }

  function afficherExport(resultat) {
    var controle = $('controle');
    var restes = $('restes');
    vider(restes);
    var bloque = resultat.restes.length > 0 || resultat.ecarts.length > 0;
    controle.className = 'controle ' + (bloque ? 'bloque' : 'passe');
    $('atteste-relu').checked = false;
    $('atteste-images').checked = false;
    $('apres-export').textContent = '';
    $('bloc-texte-produit').hidden = true;
    $('texte-produit').value = '';
    $('attestations').hidden = bloque;

    if (bloque) {
      etat.produit = null;
      controle.textContent =
        'Export bloqué : ' + pluriel(resultat.restes.length + resultat.ecarts.length, 'élément reconnu subsiste', 'éléments reconnus subsistent') + ' dans le fichier produit.';
      resultat.restes.forEach(function (r) {
        restes.appendChild(
          element('li', {}, [
            element('strong', { texte: TITRES[r.categorie] + ' : ' + r.valeur }),
            r.titre ? ' (' + r.titre + ')' : '',
            element('span', { classe: 'extrait', texte: r.extrait }),
          ])
        );
      });
      resultat.ecarts.forEach(function (e) {
        restes.appendChild(element('li', { texte: e }));
      });
      restes.appendChild(
        element('li', {
          texte: 'Revenez à la relecture : cochez l’élément, ou ajoutez l’expression à masquer. Un élément situé dans une partie que l’outil laisse intacte (un graphique, par exemple) se corrige dans Word.',
        })
      );
      annoncer(controle.textContent);
      return;
    }

    controle.textContent = 'Contrôle passé : les règles ne reconnaissent plus aucun élément à masquer dans le fichier produit. Ce contrôle suit les mêmes règles que l’analyse et partage leurs limites.';
    var images = etat.doc.images;
    $('bloc-images').hidden = images === 0;
    $('libelle-images').textContent = images === 1 ? 'J’ai vérifié l’image du document' : 'J’ai vérifié les ' + images + ' images du document';
    var aide = $('aide-images');
    aide.hidden = images === 0 && etat.doc.objets === 0;
    aide.textContent =
      (images ? 'Les images restent telles quelles dans le fichier produit : logo, signature, tampon, pièce scannée. ' : '') +
      (etat.doc.objets ? 'Le document contient aussi ' + pluriel(etat.doc.objets, 'objet incorporé', 'objets incorporés') + ', à vérifier dans Word.' : '');
    $('copier').hidden = etat.produit.extension !== 'txt';
    if (!etat.doc.numero) etat.doc.numero = etat.session.documents + 1;
    etat.produit.nom = A.sortie.nomNeutre(etat.doc.numero, etat.produit.extension);
    $('nom-produit').textContent = 'Nom du fichier produit : ' + etat.produit.nom + '. Le nom d’origine reste de côté : il porte souvent celui du client.';
    actualiserAttestations();
    annoncer(controle.textContent);
  }

  function attestationsCompletes() {
    return Boolean(etat.produit) && $('atteste-relu').checked && (etat.doc.images === 0 || $('atteste-images').checked);
  }

  function actualiserAttestations() {
    var pret = attestationsCompletes();
    $('telecharger').disabled = !pret;
    $('copier').disabled = !pret;
    var texte = pret && etat.produit.extension === 'txt';
    $('bloc-texte-produit').hidden = !texte;
    $('texte-produit').value = texte ? etat.produit.texte : '';
  }

  function telecharger() {
    if (!attestationsCompletes()) return;
    var blob =
      etat.produit.extension === 'docx' ? new Blob([etat.produit.octets], { type: TYPE_DOCX }) : new Blob([etat.produit.texte], { type: 'text/plain;charset=utf-8' });
    var adresse = URL.createObjectURL(blob);
    var lien = element('a', { href: adresse, download: etat.produit.nom, hidden: true });
    document.body.appendChild(lien);
    lien.click();
    document.body.removeChild(lien);
    setTimeout(function () {
      URL.revokeObjectURL(adresse);
    }, 30000);
    etat.session.documents = Math.max(etat.session.documents, etat.doc.numero);
    $('apres-export').textContent = 'Le fichier « ' + etat.produit.nom + ' » est remis à votre navigateur. Ouvrez-le et relisez-le une dernière fois avant de le déposer.';
    afficherSession();
  }

  async function copier() {
    if (!attestationsCompletes()) return;
    var zone = $('texte-produit');
    var message = 'Texte copié dans le presse-papiers.';
    try {
      await navigator.clipboard.writeText(etat.produit.texte);
    } catch (erreur) {
      zone.focus();
      zone.select();
      message = 'Le texte est sélectionné : copiez-le avec Ctrl+C (ou Cmd+C).';
    }
    $('apres-export').textContent = message;
  }

  /* ---------- Branchements ---------- */

  function brancher() {
    $('fichier').addEventListener('change', function () {
      choisirFichier($('fichier').files[0]);
    });
    $('retirer-fichier').addEventListener('click', function () {
      retirerFichier();
      $('fichier').focus();
    });

    var depot = $('zone-depot');
    ['dragenter', 'dragover'].forEach(function (nom) {
      depot.addEventListener(nom, function (evenement) {
        evenement.preventDefault();
        depot.classList.add('survol');
      });
    });
    ['dragleave', 'drop'].forEach(function (nom) {
      depot.addEventListener(nom, function () {
        depot.classList.remove('survol');
      });
    });
    // Un fichier lâché hors de la zone resterait ouvert par le navigateur à la place de la page.
    ['dragover', 'drop'].forEach(function (nom) {
      document.addEventListener(nom, function (evenement) {
        evenement.preventDefault();
      });
    });
    depot.addEventListener('drop', function (evenement) {
      var fichiers = evenement.dataTransfer && evenement.dataTransfer.files;
      if (fichiers && fichiers.length) {
        $('fichier').value = '';
        choisirFichier(fichiers[0]);
      }
    });

    $('analyser').addEventListener('click', lancerAnalyse);
    $('retour-preparer').addEventListener('click', function () {
      allerA('preparer');
    });
    $('vue-origine').addEventListener('change', afficherTexte);
    $('vue-apercu').addEventListener('change', afficherTexte);

    document.addEventListener('selectionchange', suivreSelection);
    $('masquer-selection').addEventListener('click', function () {
      var expression = etat.selection;
      etat.selection = '';
      $('masquer-selection').disabled = true;
      ajouterExpression(expression);
    });
    $('ajouter-expression').addEventListener('click', function () {
      ajouterExpression($('expression').value);
    });
    $('expression').addEventListener('keydown', function (evenement) {
      if (evenement.key === 'Enter') {
        evenement.preventDefault();
        ajouterExpression($('expression').value);
      }
    });
    $('texte-relu').addEventListener('click', function (evenement) {
      var cible = evenement.target;
      if (!cible || cible.nodeName !== 'MARK' || !cible.dataset.cle) return;
      if (document.getSelection() && !document.getSelection().isCollapsed) return;
      var cases = $('liste-detections').querySelectorAll('input[type="checkbox"]');
      for (var i = 0; i < cases.length; i += 1) {
        if (cases[i].dataset.foyer === cible.dataset.cle) {
          cases[i].focus();
          cases[i].scrollIntoView({ block: 'center' });
          break;
        }
      }
    });

    $('vers-exporter').addEventListener('click', preparerExport);
    $('retour-relire').addEventListener('click', function () {
      afficherRelecture();
      allerA('relire');
    });
    $('atteste-relu').addEventListener('change', actualiserAttestations);
    $('atteste-images').addEventListener('change', actualiserAttestations);
    $('telecharger').addEventListener('click', telecharger);
    $('copier').addEventListener('click', copier);

    $('autre-document').addEventListener('click', function () {
      oublierDocument();
      afficherSession();
      allerA('preparer');
      annoncer('Prêt pour un autre document. Les étiquettes de la session sont gardées.');
    });
    ['effacer-session-1', 'effacer-session-2'].forEach(function (id) {
      $(id).addEventListener('click', function () {
        $('liste-noms').value = '';
        nouvelleSession();
        allerA('preparer');
        annoncer('Session effacée : étiquettes, décalage des dates et liste de noms remis à zéro.');
      });
    });
  }

  function demarrer() {
    brancher();
    afficherLegende();
    if (controlerNavigateur()) {
      etat.session = A.remplacement.creerSession();
      afficherSession();
    }
  }

  demarrer();
})();
