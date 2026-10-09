'use strict';
// Archive ZIP : CRC-32, écriture, relecture, contrôle par l'outil système `unzip -t`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const zip = require('../public/zip.js');

const octets = (texte) => new TextEncoder().encode(texte);
const texte = (donnees) => new TextDecoder().decode(donnees);

test('crc32 : valeurs de référence', () => {
  assert.equal(zip.crc32(octets('')), 0);
  assert.equal(zip.crc32(octets('123456789')), 0xcbf43926);
  assert.equal(zip.crc32(octets('a')), 0xe8b7be43);
});

test('écriture puis relecture : mêmes noms, même ordre, mêmes contenus', async () => {
  const entrees = [
    { nom: '[Content_Types].xml', donnees: octets('<Types/>') },
    { nom: 'word/document.xml', donnees: octets('<w:document>' + 'texte répété '.repeat(500) + '</w:document>') },
    { nom: 'word/media/vide.bin', donnees: new Uint8Array(0) },
    { nom: 'dossier/accentué é.txt', donnees: octets('contenu') },
  ];
  const archive = await zip.ecrire(entrees);
  assert.ok(archive instanceof Uint8Array);
  const relues = await zip.lire(archive);
  assert.deepEqual(relues.map((e) => e.nom), entrees.map((e) => e.nom));
  for (let i = 0; i < entrees.length; i += 1) {
    assert.deepEqual(Array.from(relues[i].donnees), Array.from(entrees[i].donnees));
  }
});

test('le contenu répétitif est compressé', async () => {
  const gros = octets('abcdefghij'.repeat(2000));
  const archive = await zip.ecrire([{ nom: 'gros.txt', donnees: gros }]);
  assert.ok(archive.length < gros.length / 4, 'archive de ' + archive.length + ' octets');
});

test('l’archive produite passe `unzip -t` (CRC-32 et tailles valides)', async () => {
  const archive = await zip.ecrire([
    { nom: 'un.txt', donnees: octets('premier fichier') },
    { nom: 'sous/deux.txt', donnees: octets('second fichier '.repeat(300)) },
  ]);
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'anonymiseur-zip-'));
  const chemin = path.join(dossier, 'essai.zip');
  fs.writeFileSync(chemin, archive);
  const sortie = execFileSync('unzip', ['-t', chemin], { encoding: 'utf8' });
  assert.match(sortie, /No errors detected/);
  fs.rmSync(dossier, { recursive: true });
});

test('lecture d’une archive fabriquée par l’outil système `zip`', async () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'anonymiseur-zip-'));
  fs.writeFileSync(path.join(dossier, 'a.txt'), 'contenu fictif '.repeat(100));
  fs.writeFileSync(path.join(dossier, 'b.txt'), 'x');
  execFileSync('zip', ['-q', 'essai.zip', 'a.txt', 'b.txt'], { cwd: dossier });
  const relues = await zip.lire(new Uint8Array(fs.readFileSync(path.join(dossier, 'essai.zip'))));
  assert.deepEqual(relues.map((e) => e.nom), ['a.txt', 'b.txt']);
  assert.equal(texte(relues[0].donnees), 'contenu fictif '.repeat(100));
  assert.equal(texte(relues[1].donnees), 'x');
  fs.rmSync(dossier, { recursive: true });
});

test('les dates des fichiers sont neutralisées dans l’archive produite', async () => {
  const archive = await zip.ecrire([{ nom: 'un.txt', donnees: octets('abc') }]);
  const vue = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  // En-tête local : heure à l'octet 10, date à l'octet 12 (1er janvier 1980).
  assert.equal(vue.getUint16(10, true), 0);
  assert.equal(vue.getUint16(12, true), 0x0021);
});

test('une archive abîmée est refusée avec un message clair', async () => {
  const archive = await zip.ecrire([{ nom: 'un.txt', donnees: octets('contenu à vérifier '.repeat(50)) }]);
  const abimee = archive.slice();
  abimee[40] ^= 0xff;
  await assert.rejects(() => zip.lire(abimee), /archive|contrôle|illisible/i);
  await assert.rejects(() => zip.lire(octets('ceci est un simple texte')), /archive/i);
});

test('une entrée chiffrée est refusée', async () => {
  const archive = await zip.ecrire([{ nom: 'un.txt', donnees: octets('abc') }]);
  const modifiee = archive.slice();
  const vue = new DataView(modifiee.buffer);
  // Répertoire central : drapeaux à 8 octets de la signature 0x02014b50.
  for (let i = 0; i < modifiee.length - 4; i += 1) {
    if (vue.getUint32(i, true) === 0x02014b50) {
      vue.setUint16(i + 8, vue.getUint16(i + 8, true) | 1, true);
    }
  }
  await assert.rejects(() => zip.lire(modifiee), /mot de passe|chiffr/i);
});
