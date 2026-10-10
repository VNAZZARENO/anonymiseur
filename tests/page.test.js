'use strict';
// Analyse statique de public/ : la page livrée n'a aucun moyen d'émettre une requête ni de stocker quoi que ce soit.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const PUBLIC = path.join(RACINE, 'public');
const lire = (nom) => fs.readFileSync(path.join(PUBLIC, nom), 'utf8');
const fichiers = () => fs.readdirSync(PUBLIC).filter((nom) => nom !== 'favicon.ico').sort();

const ATTENDUS = ['app.css', 'app.js', 'detecteurs.js', 'docx.js', 'index.html', 'noms.js', 'remplacement.js', 'sortie.js', 'zip.js'];
const DEPOT = 'https://github.com/VNAZZARENO/anonymiseur';

test('public/ contient exactement les fichiers attendus, sans sous-dossier', () => {
  assert.deepEqual(fs.readdirSync(PUBLIC).sort(), ATTENDUS.concat('favicon.ico').sort());
  // L'icône évite au navigateur une demande sans réponse ; c'est une image de 16 points, sans code.
  const icone = fs.readFileSync(path.join(PUBLIC, 'favicon.ico'));
  assert.deepEqual(Array.from(icone.subarray(0, 4)), [0, 0, 1, 0]);
  assert.ok(icone.length < 2000);
  assert.match(lire('index.html'), /<link rel="icon" href="favicon\.ico">/);
  for (const nom of fichiers()) assert.ok(fs.statSync(path.join(PUBLIC, nom)).isFile());
});

test('aucun moyen de requête, de stockage ou de chargement de code dans les fichiers livrés', () => {
  const interdits = [
    /\bfetch\b/, /XMLHttpRequest/, /WebSocket/, /sendBeacon/, /EventSource/, /WebTransport/, /RTCPeerConnection/, /RTCDataChannel/,
    /localStorage/, /sessionStorage/, /indexedDB/i, /\bcaches\b/, /serviceWorker/, /document\.cookie/, /\.cookie\b/,
    /\bimport\s*\(/, /\bimport\s+[\w{*]/, /importScripts/, /\bWorker\s*\(/, /SharedWorker/, /\beval\s*\(/, /new\s+Function\b/,
    /window\.open/, /location\.(?:href|assign|replace)\s*[=(]/, /\.submit\s*\(/, /postMessage/, /new\s+Image\b/, /\.src\s*=/, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/,
  ];
  for (const nom of fichiers()) {
    const contenu = lire(nom);
    for (const motif of interdits) {
      assert.doesNotMatch(contenu, motif, nom + ' contient ' + motif);
    }
  }
});

test('aucune adresse externe dans public/, hormis le lien du dépôt en pied de page', () => {
  const motif = /(?:\b[a-z][a-z0-9+.-]*:)?\/\/[a-z0-9-]+\.[a-z]{2,}[^\s"'<>)]*/gi;
  for (const nom of fichiers()) {
    const trouvees = lire(nom).match(motif) || [];
    if (nom === 'index.html') {
      assert.deepEqual(trouvees, [DEPOT], nom);
    } else {
      assert.deepEqual(trouvees, [], nom);
    }
  }
  const html = lire('index.html');
  const pied = html.slice(html.indexOf('<footer'));
  assert.ok(pied.includes('href="' + DEPOT + '"'), 'le lien du dépôt est dans le pied de page');
  assert.match(pied, /<a [^>]*href="https:\/\/github\.com\/VNAZZARENO\/anonymiseur"[^>]*rel="noopener noreferrer"/);
});

test('feuille de style : aucune ressource appelée', () => {
  const css = lire('app.css');
  assert.doesNotMatch(css, /url\s*\(/i);
  assert.doesNotMatch(css, /@import|@font-face/i);
});

function cspDeCaddy() {
  const caddy = fs.readFileSync(path.join(RACINE, 'Caddyfile.anonymiseur'), 'utf8');
  const m = /Content-Security-Policy "([^"]+)"/.exec(caddy);
  assert.ok(m, 'CSP présente dans Caddyfile.anonymiseur');
  return m[1];
}

function cspDeLaPage() {
  const m = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(lire('index.html'));
  assert.ok(m, 'balise <meta> de CSP présente');
  return m[1];
}

test('CSP du bloc Caddy : celle de la spécification', () => {
  assert.equal(
    cspDeCaddy(),
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'"
  );
});

test('CSP en balise <meta> : les mêmes directives que le bloc Caddy', () => {
  // frame-ancestors agit seulement en en-tête HTTP : un navigateur l'ignore dans une balise <meta>
  // et l'écrit dans sa console. C'est la seule directive que la balise laisse à l'en-tête.
  const attendue = cspDeCaddy().replace(/;\s*frame-ancestors [^;]+/, '');
  assert.equal(cspDeLaPage(), attendue);
  assert.match(cspDeLaPage(), /connect-src 'none'/);
  assert.match(cspDeLaPage(), /form-action 'none'/);
  assert.match(cspDeLaPage(), /default-src 'none'/);
});

test('la balise <meta> de CSP précède toute feuille de style et tout script', () => {
  const html = lire('index.html');
  const csp = html.indexOf('http-equiv="Content-Security-Policy"');
  assert.ok(csp > 0 && csp < html.indexOf('<link'), 'la CSP vient avant les liens');
  assert.ok(csp < html.indexOf('<script'));
});

test('aucun script en ligne, aucun style en ligne, aucun gestionnaire en attribut, aucun formulaire', () => {
  const html = lire('index.html');
  const scripts = html.match(/<script\b[^>]*>[\s\S]*?<\/script>/g) || [];
  assert.ok(scripts.length >= 2);
  for (const s of scripts) {
    assert.match(s, /^<script src="[a-z]+\.js"><\/script>$/, 'script classique, chemin relatif, sans contenu : ' + s);
  }
  assert.doesNotMatch(html, /<style\b/i);
  assert.doesNotMatch(html, /\sstyle\s*=/i);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(html, /<form\b|<iframe\b|<object\b|<embed\b|<img\b|<base\b/i);
  assert.doesNotMatch(html, /javascript:/i);
});

test('scripts : chargés dans l’ordre des dépendances, tous présents dans public/', () => {
  const html = lire('index.html');
  const sources = Array.from(html.matchAll(/<script src="([^"]+)"><\/script>/g), (m) => m[1]);
  assert.deepEqual(sources, ['zip.js', 'detecteurs.js', 'noms.js', 'remplacement.js', 'docx.js', 'sortie.js', 'app.js']);
  assert.match(html, /<link rel="stylesheet" href="app\.css">/);
});

test('les modules de logique restent séparés de l’interface', () => {
  for (const nom of ['zip.js', 'detecteurs.js', 'noms.js', 'remplacement.js', 'docx.js', 'sortie.js']) {
    assert.doesNotMatch(lire(nom), /\bdocument\.(?!xml)|\bwindow\.|querySelector|getElementById|addEventListener/, nom + ' touche à la page');
  }
});

test('page : langue, titre, aucun exemple prérempli', () => {
  const html = lire('index.html');
  assert.match(html, /<html lang="fr">/);
  assert.match(html, /<title>Aide à l’anonymisation<\/title>/);
  assert.match(html, /<h1[^>]*>Aide à l’anonymisation<\/h1>/);
  for (const zone of html.match(/<textarea\b[^>]*>[\s\S]*?<\/textarea>/g) || []) {
    assert.match(zone, /><\/textarea>$/, 'zone de saisie vide à l’ouverture');
    assert.doesNotMatch(zone, /placeholder=/, 'aucun exemple en filigrane');
  }
  assert.doesNotMatch(html, /\svalue="[^"]*[A-Z][a-z]+ [A-Z][a-z]+/);
});

test('page : chaque champ de saisie porte un libellé', () => {
  const html = lire('index.html');
  const champs = Array.from(html.matchAll(/<(?:input|textarea|select)\b[^>]*\bid="([^"]+)"/g), (m) => m[1]);
  assert.ok(champs.length >= 6);
  for (const id of champs) {
    assert.ok(html.includes('<label for="' + id + '"') || html.includes('for="' + id + '"'), 'libellé pour #' + id);
  }
});

test('page : encadré des limites, vérification, éditeur et phrase sur les données', () => {
  const html = lire('index.html');
  for (const titre of ['Les noms.', 'L’identification indirecte.', 'Les dates et les montants.', 'Ce que l’outil laisse intact.', 'La portée juridique.']) {
    assert.ok(html.includes(titre), 'limite : ' + titre);
  }
  assert.match(html, /pseudonymisation/);
  assert.match(html, /onglet « Réseau »/);
  assert.match(html, /Nazzareno Systems/);
  assert.match(html, /nazzareno\.fr/);
  assert.match(html, /J’ai relu le document en entier après remplacement/);
});

test('page et textes : aucune promesse de garantie ni de certificat', () => {
  for (const nom of ['index.html', 'app.js', 'docx.js']) {
    assert.doesNotMatch(lire(nom), /garanti|certifi|100 ?%|infaillible|totalement anonyme/i, nom);
  }
});

test('règle d’écriture : affirmation directe dans la page, le code et la documentation', () => {
  const textes = fichiers().map((nom) => [nom, lire(nom)]);
  textes.push(['README.md', fs.readFileSync(path.join(RACINE, 'README.md'), 'utf8')]);
  for (const [nom, contenu] of textes) {
    assert.doesNotMatch(contenu, /, pas (?!de quoi)/, nom + ' : tournure « X, pas Y »');
    assert.doesNotMatch(contenu, /(?:ce|c’|c')\s*n[’']est pas[^.\n]{0,60}[,:;] (?:c[’']est|mais)/i, nom + ' : tournure « ce n’est pas X, c’est Y »');
  }
});

test('bloc Caddy : celui de la spécification, pour le sous-domaine de l’outil', () => {
  const caddy = fs.readFileSync(path.join(RACINE, 'Caddyfile.anonymiseur'), 'utf8');
  assert.match(caddy, /^anonymiseur\.nazzareno\.fr \{/m);
  assert.match(caddy, /root \* \/srv\/suite\/anonymiseur\/public/);
  assert.match(caddy, /Strict-Transport-Security "max-age=31536000"/);
  assert.match(caddy, /X-Content-Type-Options "nosniff"/);
  assert.match(caddy, /Referrer-Policy "no-referrer"/);
  assert.match(caddy, /Permissions-Policy "camera=\(\), geolocation=\(\), microphone=\(\)"/);
  assert.match(caddy, /Cache-Control "no-cache"/);
  assert.match(caddy, /encode zstd gzip/);
  assert.match(caddy, /file_server/);
});
