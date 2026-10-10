'use strict';
// Contrôle de sortie, nom du fichier produit, panneau « À vérifier ». Valeurs inventées pour les tests.
const test = require('node:test');
const assert = require('node:assert/strict');

const sortie = require('../public/sortie.js');
const r = require('../public/remplacement.js');
const docx = require('../public/docx.js');
const { fabriquer, p } = require('./aides/docx-fictif.js');

const OPTIONS = { modeDates: 'decaler', masquerMontants: false };

function traiter(texte, { termes = [], options = OPTIONS, coches = new Map() } = {}) {
  const session = r.creerSession({ alea: () => 0.5 });
  const candidats = r.analyser([texte], termes);
  const produit = r.remplacer(texte, candidats[0], session, options, coches).texte;
  const reglages = { termes, gardees: sortie.clesGardees(candidats, options, coches), datesProduites: session.datesProduites };
  return { produit, reglages };
}

test('nom de fichier produit : neutre, numéroté, sans trace du nom d’origine', () => {
  assert.equal(sortie.nomNeutre(1, 'docx'), 'exemple-anonymise-1.docx');
  assert.equal(sortie.nomNeutre(12, 'txt'), 'exemple-anonymise-12.txt');
});

test('contrôle de sortie : un texte entièrement remplacé passe', () => {
  const { produit, reglages } = traiter('M. Tartempion, tél. 01 23 45 67 89, IBAN FR76 3000 6000 0112 3456 7890 189, le 12/03/2024, doit 1 500 €.', { termes: ['Tartempion'] });
  assert.deepEqual(sortie.controler([produit], reglages), []);
});

test('contrôle de sortie : une détection déterministe qui subsiste bloque et se montre', () => {
  const { reglages } = traiter('tél. 01 23 45 67 89');
  const restes = sortie.controler(['Texte produit, tél. [TÉLÉPHONE 1], autre ligne : 06 12 34 56 78.'], reglages);
  assert.equal(restes.length, 1);
  assert.equal(restes[0].categorie, 'TELEPHONE');
  assert.equal(restes[0].valeur, '06 12 34 56 78');
  assert.match(restes[0].extrait, /autre ligne : 06 12 34 56 78/);
});

test('contrôle de sortie : un terme de la liste qui subsiste bloque', () => {
  const { reglages } = traiter('M. Tartempion', { termes: ['Zébulon Tartempion'] });
  const restes = sortie.controler(['Signé : zebulon TARTEMPION'], reglages);
  assert.deepEqual(restes.map((x) => [x.categorie, x.valeur]), [['NOM', 'zebulon TARTEMPION']]);
});

test('contrôle de sortie : les dates décalées passent, une date restée d’origine bloque', () => {
  const { produit, reglages } = traiter('Accident du 02/03/2024, expertise du 2 au 12 avril 2024.');
  assert.deepEqual(sortie.controler([produit], reglages), []);
  const restes = sortie.controler([produit + ' Rappel : 02/03/2019.'], reglages);
  assert.deepEqual(restes.map((x) => [x.categorie, x.valeur]), [['DATE', '02/03/2019']]);
});

test('contrôle de sortie : ce que l’utilisateur a choisi de garder passe', () => {
  const texte = 'Somme de 1 500 €, tél. 01 23 45 67 89, le 12/03/2024.';
  const garder = new Map([['TELEPHONE:0123456789', false]]);
  const { produit, reglages } = traiter(texte, { coches: garder, options: { modeDates: 'conserver', masquerMontants: false } });
  assert.equal(produit, texte);
  assert.deepEqual(sortie.controler([produit], reglages), []);
});

test('contrôle de sortie : partie laissée hors remplacement, les valeurs chiffrées passent, un courriel bloque', () => {
  const reglages = { termes: ['Tartempion'], gardees: new Set(), datesProduites: new Set() };
  const graphique = { texte: '123456\n0.123456789\n12/03/2024', titre: 'Autre partie (charts/chart1.xml)', traitee: false };
  assert.deepEqual(sortie.controler([graphique], reglages), []);
  const fuite = { texte: 'Série zebulon@exemple.test\nTartempion', titre: 'Autre partie (charts/chart1.xml)', traitee: false };
  assert.deepEqual(sortie.controler([fuite], reglages).map((x) => [x.categorie, x.titre]), [
    ['COURRIEL', 'Autre partie (charts/chart1.xml)'],
    ['NOM', 'Autre partie (charts/chart1.xml)'],
  ]);
});

test('contrôle d’un fichier Word produit : propre, il passe ; avec un reste, il bloque', async () => {
  const reglages = { termes: [], gardees: new Set(), datesProduites: new Set() };
  const propre = await docx.produire(await docx.ouvrir(await fabriquer(p('Texte sans donnée.'))), []);
  assert.deepEqual(await sortie.controlerDocx(propre, reglages), { restes: [], ecarts: [] });

  const fuyant = await fabriquer(p('Texte.'), { parties: { 'word/charts/chart1.xml': '<c:chart><c:v>zebulon@exemple.test</c:v></c:chart>' } });
  const resultat = await sortie.controlerDocx(await docx.produire(await docx.ouvrir(fuyant), []), reglages);
  assert.equal(resultat.restes.length, 1);
  assert.equal(resultat.restes[0].categorie, 'COURRIEL');
});

test('contrôle d’un fichier Word : des métadonnées restées en place sont signalées', async () => {
  const reglages = { termes: [], gardees: new Set(), datesProduites: new Set() };
  const brut = await fabriquer(p('Texte.'), { parties: { 'docProps/custom.xml': '<Properties><a>Tartempion</a></Properties>' } });
  const resultat = await sortie.controlerDocx(brut, reglages);
  assert.equal(resultat.ecarts.length, 1);
  assert.match(resultat.ecarts[0], /custom\.xml/);
});

test('à vérifier : mots à majuscule, mots en majuscules et suites de chiffres restés après remplacement', () => {
  const texte = 'Le témoin [NOM 1] habite Villefictive. Villefictive est loin. DUPONTEL signe le 11/04/2024 le contrat 4521, article 1240, pour 1 500 €. [IBAN 1]';
  const reste = sortie.aVerifier(texte);
  assert.deepEqual(reste.initiales, [{ valeur: 'Villefictive', occurrences: 2 }]);
  assert.deepEqual(reste.majuscules, [{ valeur: 'DUPONTEL', occurrences: 1 }]);
  assert.deepEqual(reste.chiffres, [{ valeur: '4521', occurrences: 1 }, { valeur: '1240', occurrences: 1 }]);
});

test('à vérifier : mots courants et termes juridiques laissés de côté', () => {
  const reste = sortie.aVerifier('Attendu que le Tribunal a statué. Il convient de dire. PAR CES MOTIFS. Monsieur conteste.');
  assert.deepEqual(reste, { initiales: [], majuscules: [], chiffres: [] });
});

test('contrôle de sortie : un reste contenu dans un autre est montré une seule fois', () => {
  const reglages = { termes: ['Zébulon Tartempion'], gardees: new Set(), datesProduites: new Set() };
  const restes = sortie.controler(['Écrire à zebulon.tartempion@exemple.test'], reglages);
  assert.deepEqual(restes.map((x) => x.categorie), ['COURRIEL']);
});
