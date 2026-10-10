#!/usr/bin/env node
/*
 * Recette dans un navigateur réel : Chrome sans tête piloté par le protocole DevTools,
 * sans paquet à installer. Le script sert public/ avec les en-têtes du bloc Caddy,
 * joue le parcours complet avec des documents fabriqués (contenus inventés), puis vérifie :
 *  - aucune requête après le chargement de la page, réseau coupé pendant le traitement ;
 *  - console sans erreur ni violation de CSP ;
 *  - aucun cookie, aucun stockage ;
 *  - fichiers téléchargés rouverts et relus.
 *
 * Usage : node tests/navigateur/parcours.mjs [--url=<adresse de la page>] [--captures=<dossier>] [--chrome=<binaire>]
 *   --url : page servie ailleurs (python3 -m http.server, ou file:///…/public/index.html).
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.join(ICI, '..', '..');
const PUBLIC = path.join(RACINE, 'public');
const zip = require(path.join(PUBLIC, 'zip.js'));
const docx = require(path.join(PUBLIC, 'docx.js'));
const { fabriquer, partieW, p, r, TYPE, EN_TETE } = require('../aides/docx-fictif.js');

const options = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split(/=(.*)/s).slice(0, 2)));
const constats = [];
let echecs = 0;

function constat(ok, libelle, detail) {
  constats.push({ ok, libelle, detail });
  if (!ok) echecs += 1;
  console.log((ok ? '  ok      ' : '  ÉCHEC   ') + libelle + (detail ? ' : ' + detail : ''));
}

/* ---------- Documents d'essai (contenus inventés) ---------- */

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const SECRETS = ['Tartempion', 'Zébulon', 'Zebulon', 'Cunégonde', 'Fictive', 'Villefictive', '06 12 34 56 78', 'FR76 3000', '732 829 320', 'AB-123-CD', '12/03/2024', 'rue des Lilas', '69003', 'exemple.test', 'Imaginaire', 'ztartempion'];

async function documentComplet() {
  const corps =
    p('PROCÈS-VERBAL D’AUDITION') +
    p(r('Le 12/03/2024, nous entendons Monsieur Zébu'), r('lon TARTEM', '<w:b/>'), r('PION, né le 4 mai 1980 à Villefictive, demeurant 12 rue des Lilas, 69003 Lyon.')) +
    p('Téléphone : 06 12 34 56 78. Courriel : zebulon.tartempion@exemple.test. Véhicule immatriculé AB-123-CD.') +
    p('Son épouse, Madame Cunégonde FICTIVE, confirme. Tartempion précise que la société Assurances Imaginaires (SIREN 732 829 320) a versé 2 450,00 euros.') +
    p('IBAN : FR76 3000 6000 0112 3456 7890 189. Il invoque la loi n° 85-677 du 5 juillet 1985 et l’article 1240 du Code civil (Cass. civ. 2e, 12 mars 2020, n° 19-12.345), devant le Tribunal judiciaire de Lyon.') +
    '<w:p><w:hyperlink r:id="rId1"><w:r><w:t>Écrire au conseil</w:t></w:r></w:hyperlink><w:r><w:footnoteReference w:id="2"/></w:r></w:p>';
  return fabriquer(corps, {
    section: '<w:sectPr><w:headerReference w:type="default" r:id="rId2"/><w:footerReference w:type="default" r:id="rId3"/></w:sectPr>',
    relationsRacine: [
      { type: TYPE.coeur, cible: 'docProps/core.xml' },
      { type: TYPE.application, cible: 'docProps/app.xml' },
    ],
    relationsDocument: [
      { type: TYPE.lien, cible: 'mailto:zebulon.tartempion@exemple.test', externe: true },
      { type: TYPE.enTete, cible: 'header1.xml' },
      { type: TYPE.pied, cible: 'footer1.xml' },
      { type: TYPE.notes, cible: 'footnotes.xml' },
      { type: TYPE.image, cible: 'media/image1.png' },
    ],
    parties: {
      'word/header1.xml': partieW('hdr', p('Dossier Tartempion c/ Assurances Imaginaires')),
      'word/footer1.xml': partieW('ftr', p('Cabinet fictif, page 1')),
      'word/footnotes.xml': partieW(
        'footnotes',
        '<w:footnote w:type="separator" w:id="0"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
          '<w:footnote w:type="continuationSeparator" w:id="1"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
          '<w:footnote w:id="2">' + p('Maître Anselme Chimère, conseil de M. Tartempion.') + '</w:footnote>'
      ),
      'word/media/image1.png': new Uint8Array(PNG),
      'docProps/core.xml':
        EN_TETE +
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">' +
        '<dc:title>PV Tartempion</dc:title><dc:creator>ztartempion</dc:creator><cp:lastModifiedBy>Cunégonde Fictive</cp:lastModifiedBy></cp:coreProperties>',
      'docProps/app.xml': EN_TETE + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Company>Cabinet Imaginaire</Company></Properties>',
    },
  });
}

const documentAvecCommentaires = () =>
  fabriquer(p('Texte.'), { parties: { 'word/comments.xml': partieW('comments', '<w:comment w:id="0" w:author="Zébulon Tartempion">' + p('À revoir.') + '</w:comment>') } });

const documentAvecGraphique = () => fabriquer(p('Texte courant.'), { parties: { 'word/charts/chart1.xml': '<c:chart><c:v>zebulon@exemple.test</c:v></c:chart>' } });

const TEXTE_COLLE =
  'Lettre de relance\n\nMonsieur Tartempion nous indique, par courriel du 14/03/2024 (zebulon.tartempion@exemple.test), que le dossier 40123456 reste ouvert.\n' +
  'Zébulon Tartempion demeure joignable au 06 12 34 56 78.';

/* ---------- Serveur local avec les en-têtes du bloc Caddy ---------- */

function enTetesCaddy() {
  const bloc = fs.readFileSync(path.join(RACINE, 'Caddyfile.anonymiseur'), 'utf8');
  const enTetes = {};
  for (const m of bloc.matchAll(/^\s*([A-Z][A-Za-z-]+) "([^"]*)"$/gm)) enTetes[m[1]] = m[2];
  return enTetes;
}

function servir() {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.ico': 'image/x-icon' };
  const enTetes = enTetesCaddy();
  const serveur = http.createServer((requete, reponse) => {
    const chemin = decodeURIComponent(new URL(requete.url, 'http://x').pathname);
    const fichier = path.join(PUBLIC, chemin === '/' ? 'index.html' : path.normalize(chemin).replace(/^([/\\]|\.\.)+/, ''));
    if (!fichier.startsWith(PUBLIC) || !fs.existsSync(fichier) || !fs.statSync(fichier).isFile()) {
      reponse.writeHead(404, enTetes).end();
      return;
    }
    reponse.writeHead(200, { ...enTetes, 'Content-Type': types[path.extname(fichier)] || 'application/octet-stream' }).end(fs.readFileSync(fichier));
  });
  return new Promise((resoudre) => serveur.listen(0, '127.0.0.1', () => resoudre(serveur)));
}

/* ---------- Chrome et protocole DevTools ---------- */

function trouverChrome() {
  const candidats = [options.chrome, process.env.CHROME, 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].filter(Boolean);
  for (const c of candidats) {
    if (spawnSync(c, ['--version'], { stdio: 'ignore' }).status === 0) return c;
  }
  return null;
}

function lancerChrome(binaire, profil) {
  const enfant = spawn(
    binaire,
    ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profil, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions', '--window-size=1366,768', 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );
  return new Promise((resoudre, rejeter) => {
    let journal = '';
    const delai = setTimeout(() => rejeter(new Error('Chrome ne répond pas : ' + journal.slice(-400))), 20000);
    enfant.stderr.on('data', (morceau) => {
      journal += morceau;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(journal);
      if (m) {
        clearTimeout(delai);
        resoudre({ enfant, adresse: m[1] });
      }
    });
  });
}

class Pilote {
  constructor(prise) {
    this.prise = prise;
    this.numero = 0;
    this.attentes = new Map();
    this.ecouteurs = [];
    prise.addEventListener('message', (evenement) => {
      const message = JSON.parse(evenement.data);
      if (message.id && this.attentes.has(message.id)) {
        const { resoudre, rejeter } = this.attentes.get(message.id);
        this.attentes.delete(message.id);
        if (message.error) rejeter(new Error(message.error.message));
        else resoudre(message.result);
      } else if (message.method) {
        this.ecouteurs.forEach((f) => f(message));
      }
    });
  }
  static ouvrir(adresse) {
    return new Promise((resoudre, rejeter) => {
      const prise = new WebSocket(adresse);
      prise.addEventListener('open', () => resoudre(new Pilote(prise)));
      prise.addEventListener('error', () => rejeter(new Error('connexion au navigateur impossible')));
    });
  }
  envoyer(methode, parametres = {}, session) {
    this.numero += 1;
    const id = this.numero;
    this.prise.send(JSON.stringify({ id, method: methode, params: parametres, sessionId: session }));
    return new Promise((resoudre, rejeter) => this.attentes.set(id, { resoudre, rejeter }));
  }
  ecouter(f) {
    this.ecouteurs.push(f);
  }
}

const pause = (ms) => new Promise((resoudre) => setTimeout(resoudre, ms));

/* ---------- Parcours ---------- */

async function principal() {
  const binaire = trouverChrome();
  if (!binaire) {
    console.error('Chrome ou Chromium introuvable : recette en navigateur impossible sur ce poste.');
    process.exit(2);
  }
  const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'anonymiseur-recette-'));
  const telechargements = path.join(travail, 'telechargements');
  fs.mkdirSync(telechargements);
  const captures = options.captures ? path.resolve(options.captures) : null;
  if (captures) fs.mkdirSync(captures, { recursive: true });

  const serveur = options.url ? null : await servir();
  const adressePage = options.url || 'http://127.0.0.1:' + serveur.address().port + '/';
  const local = adressePage.startsWith('file:');
  console.log('Page : ' + adressePage);

  const fichiers = {
    complet: path.join(travail, 'Conclusions Tartempion.docx'),
    commentaires: path.join(travail, 'avec-commentaires.docx'),
    graphique: path.join(travail, 'avec-graphique.docx'),
  };
  fs.writeFileSync(fichiers.complet, await documentComplet());
  fs.writeFileSync(fichiers.commentaires, await documentAvecCommentaires());
  fs.writeFileSync(fichiers.graphique, await documentAvecGraphique());

  const chrome = await lancerChrome(binaire, path.join(travail, 'profil'));
  const pilote = await Pilote.ouvrir(chrome.adresse);
  try {
    const { targetId } = await pilote.envoyer('Target.createTarget', { url: 'about:blank' });
    const { sessionId: s } = await pilote.envoyer('Target.attachToTarget', { targetId, flatten: true });
    const requetes = [];
    const console_ = [];
    const termines = [];
    let charge = false;
    pilote.ecouter((message) => {
      const q = message.params;
      if (message.method === 'Network.requestWillBeSent') requetes.push({ adresse: q.request.url, apresChargement: charge });
      if (message.method === 'Runtime.consoleAPICalled') console_.push(q.type + ' : ' + q.args.map((a) => a.value || a.description).join(' '));
      if (message.method === 'Runtime.exceptionThrown') console_.push('exception : ' + (q.exceptionDetails.exception?.description || q.exceptionDetails.text));
      if (message.method === 'Log.entryAdded') console_.push(q.entry.level + ' (' + q.entry.source + ') : ' + q.entry.text);
      if (message.method === 'Browser.downloadWillBegin') termines.push({ guid: q.guid, nom: q.suggestedFilename, etat: 'en cours', adresse: q.url });
      if (message.method === 'Browser.downloadProgress') {
        const t = termines.find((x) => x.guid === q.guid);
        if (t) t.etat = q.state;
      }
    });
    for (const domaine of ['Page', 'Runtime', 'Network', 'Log', 'DOM']) await pilote.envoyer(domaine + '.enable', {}, s);
    await pilote.envoyer('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: telechargements, eventsEnabled: true });
    await pilote.envoyer('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false }, s);

    const evaluer = async (expression) => {
      const reponse = await pilote.envoyer('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, s);
      if (reponse.exceptionDetails) throw new Error('évaluation : ' + (reponse.exceptionDetails.exception?.description || reponse.exceptionDetails.text));
      return reponse.result.value;
    };
    const attendre = async (expression, libelle, delai = 15000) => {
      const debut = Date.now();
      while (Date.now() - debut < delai) {
        if (await evaluer(expression)) return true;
        await pause(60);
      }
      throw new Error('délai dépassé : ' + libelle);
    };
    const cliquer = (id) => evaluer('document.getElementById(' + JSON.stringify(id) + ').click()');
    const texteDe = (id) => evaluer('document.getElementById(' + JSON.stringify(id) + ').textContent');
    const visible = (id) => evaluer('!document.getElementById(' + JSON.stringify(id) + ').hidden');
    const deposer = async (chemin) => {
      const { root } = await pilote.envoyer('DOM.getDocument', {}, s);
      const { nodeId } = await pilote.envoyer('DOM.querySelector', { nodeId: root.nodeId, selector: '#fichier' }, s);
      await pilote.envoyer('DOM.setFileInputFiles', { files: [chemin], nodeId }, s);
    };
    const capturer = async (nom) => {
      if (!captures) return;
      const { data } = await pilote.envoyer('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, s);
      fs.writeFileSync(path.join(captures, nom + '.png'), Buffer.from(data, 'base64'));
    };
    const telechargement = async (nom) => {
      await attendre('true', 'pause', 100);
      const debut = Date.now();
      while (Date.now() - debut < 15000) {
        const t = termines.find((x) => x.nom === nom && x.etat === 'completed');
        if (t && fs.existsSync(path.join(telechargements, nom))) return path.join(telechargements, nom);
        await pause(80);
      }
      throw new Error('téléchargement absent : ' + nom);
    };

    /* --- Chargement --- */
    console.log('\nChargement');
    await pilote.envoyer('Page.navigate', { url: adressePage }, s);
    await attendre('document.readyState === "complete" && typeof self.Anonymiseur === "object" && !!self.Anonymiseur.sortie', 'chargement de la page');
    // L'icône de l'onglet est demandée par le navigateur juste après l'événement de chargement.
    await pause(1200);
    charge = true;
    const auChargement = requetes.map((q) => q.adresse.replace(/^.*\//, '') || 'index.html');
    constat(auChargement.length >= 9, 'ressources chargées : ' + auChargement.join(', '));
    constat(requetes.every((q) => q.adresse.startsWith(adressePage.replace(/[^/]*$/, ''))), 'toutes les ressources viennent de la page elle-même');
    constat((await texteDe('titre-preparer')) === '1. Préparer' && (await visible('etape-preparer')), 'la page s’ouvre sur le temps « Préparer »');
    constat((await evaluer('document.getElementById("texte-colle").value + document.getElementById("liste-noms").value')) === '', 'la page s’ouvre vide, sans exemple prérempli');
    constat(await evaluer('document.getElementById("incompatible").hidden'), 'navigateur reconnu comme compatible');
    await capturer('1-preparer');

    if (!local) {
      await pilote.envoyer('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 }, s);
      constat((await evaluer('navigator.onLine')) === false, 'réseau coupé pour toute la suite du parcours');
    }

    /* --- Document refusé --- */
    console.log('\nDocument avec commentaires');
    await deposer(fichiers.commentaires);
    await cliquer('analyser');
    await attendre('!document.getElementById("erreur-preparer").hidden', 'message de refus');
    const refus = await texteDe('erreur-preparer');
    constat(/commentaires/.test(refus) && /Révision/.test(refus), 'refus affiché avec la marche à suivre dans Word');
    constat(await visible('etape-preparer'), 'la page reste sur « Préparer »');
    await cliquer('retirer-fichier');

    /* --- Parcours complet sur un fichier Word --- */
    console.log('\nFichier Word : préparer, relire, exporter');
    await deposer(fichiers.complet);
    await evaluer('document.getElementById("liste-noms").value = "Zébulon Tartempion"');
    await cliquer('analyser');
    await attendre('!document.getElementById("etape-relire").hidden', 'temps « Relire »');
    constat((await evaluer('document.activeElement.id')) === 'titre-relire', 'le titre du temps « Relire » reçoit le focus');
    console.log('          ' + (await texteDe('resume-relire')));
    constat(/1 image/.test(await texteDe('avis-document')), 'image signalée à la relecture');
    const surligne = await evaluer('document.querySelectorAll("#texte-relu mark.detectee").length');
    constat(surligne >= 15, surligne + ' occurrences surlignées dans le texte');
    const etiquettes = await evaluer('Array.from(document.querySelectorAll("#liste-detections .etiquette"), (e) => e.textContent)');
    constat(['[NOM 1]', '[TÉLÉPHONE 1]', '[IBAN 1]', '[ADRESSE 1]', '[COURRIEL 1]', '[IMMATRICULATION 1]', '[SIREN 1]'].every((e) => etiquettes.includes(e)), 'étiquettes proposées : ' + Array.from(new Set(etiquettes)).join(' '));
    const relu = await texteDe('texte-relu');
    constat(/En-tête/.test(relu) && /Notes de bas de page/.test(relu) && /Cible de lien/.test(relu), 'en-tête, note de bas de page et cible de lien montrés à la relecture');
    const gardes = await evaluer('Array.from(document.querySelectorAll("#texte-relu mark.gardee"), (e) => e.textContent)');
    constat(gardes.includes('2 450,00 euros'), 'montant détecté et gardé par défaut');
    constat(/5 juillet 1985/.test(relu) && !(await evaluer('Array.from(document.querySelectorAll("#texte-relu mark"), (e) => e.textContent).some((t) => /1985|1240|19-12|12 mars 2020|Lyon$/.test(t) && !/69003/.test(t))')), 'loi, article, référence de jurisprudence et juridiction laissés entiers');
    await capturer('2-relire');

    // Décocher puis recocher une valeur.
    const avant = await evaluer('document.querySelectorAll("#texte-relu mark.detectee").length');
    await evaluer('(() => { const c = Array.from(document.querySelectorAll("#liste-detections input")).find((x) => x.dataset.foyer.startsWith("TELEPHONE:")); c.click(); })()');
    const apres = await evaluer('document.querySelectorAll("#texte-relu mark.detectee").length');
    constat(apres === avant - 1 && (await evaluer('document.activeElement.dataset.foyer || ""')).startsWith('TELEPHONE:'), 'décocher une valeur la rend au texte ; le focus reste sur sa case');
    await evaluer('document.activeElement.click()');
    constat((await evaluer('document.querySelectorAll("#texte-relu mark.detectee").length')) === avant, 'recocher la valeur la masque de nouveau');

    // « À vérifier » puis ajout d'une expression.
    const aVerifier = await texteDe('a-verifier');
    constat(/Lyon/.test(aVerifier), 'panneau « À vérifier » : la ville de la juridiction y figure');
    await evaluer('document.getElementById("expression").value = "Cabinet fictif"');
    await cliquer('ajouter-expression');
    constat((await evaluer('document.getElementById("liste-noms").value')).includes('Cabinet fictif'), 'expression ajoutée à la liste des noms');

    // Sélection à la souris.
    await evaluer('(() => { const zone = document.getElementById("texte-relu"); const it = document.createTreeWalker(zone, NodeFilter.SHOW_TEXT); let n; while ((n = it.nextNode())) { const i = n.data.indexOf("confirme"); if (i >= 0) { const plage = document.createRange(); plage.setStart(n, i); plage.setEnd(n, i + 8); const sel = document.getSelection(); sel.removeAllRanges(); sel.addRange(plage); return true; } } return false; })()');
    await attendre('!document.getElementById("masquer-selection").disabled', 'bouton de sélection actif');
    await cliquer('masquer-selection');
    constat((await evaluer('document.getElementById("liste-noms").value')).includes('confirme'), 'sélection de texte : « Masquer cette expression partout » fonctionne');

    await cliquer('vue-apercu');
    const apercu = await texteDe('texte-relu');
    constat(/\[NOM 1\]/.test(apercu) && !SECRETS.some((x) => apercu.includes(x)), 'aperçu après remplacement : aucune des valeurs d’origine visible');
    await capturer('3-apercu');

    await cliquer('vers-exporter');
    await attendre('!document.getElementById("etape-exporter").hidden', 'temps « Exporter »');
    constat(await evaluer('document.getElementById("controle").classList.contains("passe")'), 'contrôle de sortie passé : ' + (await texteDe('controle')).slice(0, 60) + '…');
    constat(await evaluer('document.getElementById("telecharger").disabled'), 'téléchargement fermé tant que les cases restent vides');
    await cliquer('atteste-relu');
    constat(await evaluer('document.getElementById("telecharger").disabled'), 'téléchargement encore fermé sans la case des images');
    await cliquer('atteste-images');
    constat(!(await evaluer('document.getElementById("telecharger").disabled')), 'téléchargement ouvert une fois les deux cases cochées');
    await capturer('4-exporter');
    await cliquer('telecharger');
    const produit = await telechargement('exemple-anonymise-1.docx');
    constat(true, 'fichier téléchargé sous un nom neutre : ' + path.basename(produit));

    /* --- Relecture du fichier produit --- */
    console.log('\nFichier Word produit');
    const octets = new Uint8Array(fs.readFileSync(produit));
    const entrees = await zip.lire(octets);
    const tout = entrees.filter((e) => /\.(xml|rels)$/.test(e.nom)).map((e) => new TextDecoder().decode(e.donnees)).join('\n');
    const fuites = SECRETS.filter((x) => tout.includes(x));
    constat(fuites.length === 0, 'aucune valeur d’origine dans le XML du fichier produit', fuites.join(', '));
    constat(/\[NOM 1\]/.test(tout) && /about:blank/.test(tout), 'étiquettes écrites, cible du lien neutralisée');
    constat(/5 juillet 1985/.test(tout) && /article 1240 du Code civil/.test(tout) && /Cass\. civ\. 2e, 12 mars 2020, n° 19-12\.345/.test(tout) && /Tribunal judiciaire de Lyon/.test(tout), 'références de droit intactes dans le fichier produit');
    constat(/2 450,00 euros/.test(tout), 'montant conservé');
    const rouvert = await docx.ouvrir(octets);
    constat(rouvert.refus.length === 0 && rouvert.images === 1 && docx.verifierSortie(rouvert.entrees).length === 0, 'fichier rouvert par le lecteur de l’outil : métadonnées vides, image gardée');
    try {
      constat(/No errors detected/.test(execFileSync('unzip', ['-t', produit], { encoding: 'utf8' })), 'archive valide selon unzip -t');
    } catch (erreur) {
      constat(false, 'archive valide selon unzip -t', erreur.message);
    }
    const bureautique = ['soffice', 'libreoffice'].find((c) => spawnSync(c, ['--version'], { stdio: 'ignore' }).status === 0);
    if (bureautique) {
      const sortie = path.join(travail, 'libreoffice');
      spawnSync(bureautique, ['--headless', '-env:UserInstallation=file://' + path.join(travail, 'profil-lo'), '--convert-to', 'txt:Text (encoded):UTF8', '--outdir', sortie, produit], { stdio: 'ignore', timeout: 120000 });
      const converti = path.join(sortie, 'exemple-anonymise-1.txt');
      const lu = fs.existsSync(converti) ? fs.readFileSync(converti, 'utf8') : '';
      constat(/\[NOM 1\]/.test(lu) && !SECRETS.some((x) => lu.includes(x)), 'fichier ouvert par LibreOffice : texte lu, étiquettes présentes, aucune valeur d’origine');
      if (captures) fs.writeFileSync(path.join(captures, 'exemple-anonymise-1.txt'), lu);
    } else {
      console.log('  (LibreOffice absent : ouverture par un traitement de texte laissée de côté)');
    }
    if (captures) fs.copyFileSync(produit, path.join(captures, 'exemple-anonymise-1.docx'));

    /* --- Second document de la session : texte collé --- */
    console.log('\nTexte collé, même session');
    await cliquer('autre-document');
    await attendre('!document.getElementById("etape-preparer").hidden', 'retour à « Préparer »');
    await evaluer('document.getElementById("texte-colle").value = ' + JSON.stringify(TEXTE_COLLE));
    await cliquer('analyser');
    await attendre('!document.getElementById("etape-relire").hidden', 'temps « Relire »');
    await cliquer('vers-exporter');
    await attendre('!document.getElementById("etape-exporter").hidden', 'temps « Exporter »');
    constat(await evaluer('document.getElementById("controle").classList.contains("passe")'), 'contrôle de sortie passé pour le texte');
    constat(await evaluer('document.getElementById("bloc-images").hidden'), 'aucune case d’images pour un texte');
    await cliquer('atteste-relu');
    const texteProduit = await evaluer('document.getElementById("texte-produit").value');
    constat(/Monsieur \[NOM 1\]/.test(texteProduit) && /\[COURRIEL 1\]/.test(texteProduit) && /\[TÉLÉPHONE 1\]/.test(texteProduit), 'mêmes étiquettes que dans le premier document : [NOM 1], [COURRIEL 1], [TÉLÉPHONE 1]');
    constat(!SECRETS.some((x) => texteProduit.includes(x)) && !texteProduit.includes('14/03/2024') && !texteProduit.includes('40123456'), 'texte produit sans valeur d’origine');
    await cliquer('copier');
    constat(/copié|sélectionné/.test(await texteDe('apres-export')), 'copie du texte : ' + (await texteDe('apres-export')));
    await cliquer('telecharger');
    const texteTelecharge = await telechargement('exemple-anonymise-2.txt');
    constat(fs.readFileSync(texteTelecharge, 'utf8') === texteProduit, 'fichier texte téléchargé : exemple-anonymise-2.txt, contenu identique à l’écran');

    /* --- Export bloqué --- */
    console.log('\nContrôle de sortie bloquant');
    await cliquer('autre-document');
    await deposer(fichiers.graphique);
    await cliquer('analyser');
    await attendre('!document.getElementById("etape-relire").hidden', 'temps « Relire »');
    await cliquer('vers-exporter');
    await attendre('!document.getElementById("etape-exporter").hidden', 'temps « Exporter »');
    constat(await evaluer('document.getElementById("controle").classList.contains("bloque")'), 'export bloqué : ' + (await texteDe('controle')));
    constat(/zebulon@exemple\.test/.test(await texteDe('restes')), 'l’élément restant est montré');
    constat(await evaluer('document.getElementById("attestations").hidden'), 'aucun bouton de téléchargement proposé');
    await capturer('5-bloque');

    /* --- Effacement de session --- */
    await cliquer('effacer-session-2');
    constat((await evaluer('document.getElementById("liste-noms").value + document.getElementById("texte-colle").value')) === '' && (await texteDe('etat-session')) === '', 'effacer la session vide la liste de noms et les étiquettes');

    /* --- Bilan : réseau, console, stockage --- */
    console.log('\nRéseau, console, stockage');
    const apresChargement = requetes.filter((q) => q.apresChargement);
    const sorties = apresChargement.filter((q) => !q.adresse.startsWith('blob:'));
    constat(sorties.length === 0, 'aucune requête réseau après le chargement', sorties.map((q) => q.adresse).join(', '));
    console.log('          adresses blob: locales créées pour les téléchargements : ' + apresChargement.filter((q) => q.adresse.startsWith('blob:')).length);
    constat(console_.length === 0, 'console vide : aucune erreur, aucun avertissement, aucune violation de CSP', console_.join(' | '));
    const stockage = await evaluer(
      '(async () => { const s = {}; try { s.cookie = document.cookie; } catch (e) { s.cookie = ""; } try { s.local = self["local" + "Storage"].length; } catch (e) { s.local = 0; } try { s.session = self["session" + "Storage"].length; } catch (e) { s.session = 0; } try { s.bases = (await self["indexed" + "DB"].databases()).length; } catch (e) { s.bases = 0; } try { s.agents = (await navigator["service" + "Worker"].getRegistrations()).length; } catch (e) { s.agents = 0; } try { s.caches = (await self.caches.keys()).length; } catch (e) { s.caches = 0; } return s; })()'
    );
    constat(stockage.cookie === '' && stockage.local + stockage.session + stockage.bases + stockage.agents + stockage.caches === 0, 'aucun cookie, aucun stockage, aucun service en arrière-plan', JSON.stringify(stockage));
    const csp = await evaluer('document.querySelector("meta[http-equiv=Content-Security-Policy]").content');
    constat(/connect-src 'none'/.test(csp) && /form-action 'none'/.test(csp), 'CSP de la page en vigueur');
    // Une tentative de connexion depuis la page doit être refusée par la CSP (essai fait par la recette, hors du code livré).
    const tentative = await evaluer('(async () => { try { await self["fet" + "ch"]("./index.html"); return "passée"; } catch (e) { return "refusée"; } })()');
    constat(tentative === 'refusée', 'une tentative de requête depuis la page est refusée par la CSP');
  } finally {
    chrome.enfant.kill();
    if (serveur) serveur.close();
    await pause(300);
    fs.rmSync(travail, { recursive: true, force: true });
  }

  console.log('\n' + constats.filter((c) => c.ok).length + ' constats conformes, ' + echecs + ' en échec.');
  process.exit(echecs ? 1 : 0);
}

principal().catch((erreur) => {
  console.error('Recette interrompue : ' + erreur.message);
  process.exit(1);
});
