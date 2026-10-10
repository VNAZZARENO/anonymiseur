'use strict';
// Fichiers Word : lecture, remplacement dans le XML, métadonnées, refus. Contenus inventés pour les tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const zip = require('../public/zip.js');
const docx = require('../public/docx.js');
const remplacement = require('../public/remplacement.js');
const { fabriquer, lirePartie, partieW, p, r, TYPE, EN_TETE } = require('./aides/docx-fictif.js');

const OPTIONS = { modeDates: 'decaler', masquerMontants: false };

// Parcours complet sur un document : analyse, choix par défaut, production.
async function anonymiser(archive, termes = []) {
  const doc = await docx.ouvrir(archive);
  assert.deepEqual(doc.refus, []);
  const textes = doc.blocs.map((b) => b.texte);
  const candidats = remplacement.analyser(doc.blocs, termes);
  const session = remplacement.creerSession({ alea: () => 0.5 });
  const plans = textes.map((t, i) => remplacement.remplacer(t, candidats[i], session, OPTIONS, new Map()).plan);
  return docx.produire(doc, plans);
}

test('ouverture : un bloc de texte par paragraphe', async () => {
  const archive = await fabriquer(p('Premier paragraphe fictif.') + p('Second ', 'paragraphe.') + '<w:p/>');
  const doc = await docx.ouvrir(archive);
  assert.deepEqual(doc.blocs.map((b) => b.texte), ['Premier paragraphe fictif.', 'Second paragraphe.']);
  assert.equal(doc.blocs[0].partie, 'word/document.xml');
  assert.equal(doc.images, 0);
});

test('archive lue puis réécrite, rouverte à l’identique par un second passage', async () => {
  const archive = await fabriquer(p('Texte sans donnée à masquer.') + p('Autre ligne.'));
  const un = await anonymiser(archive);
  const deux = await anonymiser(un);
  assert.deepEqual(Array.from(deux), Array.from(un), 'le second passage rend les mêmes octets');
  const avant = await zip.lire(archive);
  const apres = await zip.lire(un);
  assert.deepEqual(apres.map((e) => e.nom), avant.map((e) => e.nom));
  assert.equal(await lirePartie(un, 'word/document.xml'), await lirePartie(archive, 'word/document.xml'));
});

test('nom coupé entre trois segments w:r : remplacé, mise en forme du premier segment gardée', async () => {
  const corps = p(r('Audition de Zébu'), r('lon Tartem', '<w:b/>'), r('pion ce jour.', '<w:i/>'));
  const sortie = await anonymiser(await fabriquer(corps), ['Zébulon Tartempion']);
  const xml = await lirePartie(sortie, 'word/document.xml');
  assert.match(xml, /<w:r><w:t xml:space="preserve">Audition de \[NOM 1\]<\/w:t><\/w:r>/);
  assert.match(xml, /<w:r><w:rPr><w:b\/><\/w:rPr><w:t xml:space="preserve"><\/w:t><\/w:r>/);
  assert.match(xml, /<w:r><w:rPr><w:i\/><\/w:rPr><w:t xml:space="preserve"> ce jour\.<\/w:t><\/w:r>/);
  assert.doesNotMatch(xml, /Tartem|Zébu|pion/);
});

test('nom dans un en-tête, un pied de page, une note de bas de page et une note de fin', async () => {
  const archive = await fabriquer(p('Corps : Zébulon Tartempion.'), {
    parties: {
      'word/header1.xml': partieW('hdr', p('Dossier Tartempion')),
      'word/footer1.xml': partieW('ftr', p('Cabinet de Zébulon TARTEMPION')),
      'word/footnotes.xml': partieW('footnotes', '<w:footnote w:id="1">' + p('Voir Tartempion, précité.') + '</w:footnote>'),
      'word/endnotes.xml': partieW('endnotes', '<w:endnote w:id="1">' + p('Selon zebulon tartempion.') + '</w:endnote>'),
    },
  });
  const sortie = await anonymiser(archive, ['Zébulon Tartempion']);
  for (const nom of ['word/document.xml', 'word/header1.xml', 'word/footer1.xml', 'word/footnotes.xml', 'word/endnotes.xml']) {
    const xml = await lirePartie(sortie, nom);
    assert.match(xml, /\[NOM 1\]/, nom);
    assert.doesNotMatch(xml, /tartempion/i, nom);
  }
});

test('cible de lien mailto: neutralisée, lien interne gardé', async () => {
  const archive = await fabriquer(p('Écrire au cabinet.'), {
    relationsDocument: [
      { type: TYPE.lien, cible: 'mailto:zebulon.tartempion@exemple.test', externe: true },
      { type: TYPE.enTete, cible: 'header1.xml' },
    ],
    parties: { 'word/header1.xml': partieW('hdr', p('En-tête')) },
  });
  const doc = await docx.ouvrir(archive);
  assert.ok(doc.blocs.some((b) => b.type === 'lien' && b.texte === 'mailto:zebulon.tartempion@exemple.test'));
  const sortie = await anonymiser(archive);
  const rels = await lirePartie(sortie, 'word/_rels/document.xml.rels');
  assert.doesNotMatch(rels, /tartempion|mailto/);
  assert.match(rels, /Target="about:blank" TargetMode="External"/);
  assert.match(rels, /Target="header1\.xml"/);
});

test('métadonnées vidées : auteur, dernier éditeur, société, titre ; propriétés personnalisées et vignette retirées', async () => {
  const archive = await fabriquer(p('Texte.'), {
    relationsRacine: [
      { type: TYPE.coeur, cible: 'docProps/core.xml' },
      { type: TYPE.application, cible: 'docProps/app.xml' },
      { type: TYPE.personnalisees, cible: 'docProps/custom.xml' },
      { type: TYPE.vignette, cible: 'docProps/thumbnail.jpeg' },
    ],
    parties: {
      'docProps/core.xml':
        EN_TETE +
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">' +
        '<dc:title>Conclusions Tartempion</dc:title><dc:creator>Zébulon Tartempion</dc:creator><cp:lastModifiedBy>Cunégonde Fictive</cp:lastModifiedBy></cp:coreProperties>',
      'docProps/app.xml':
        EN_TETE +
        '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Template>Matrice Tartempion.dotx</Template><Company>Cabinet Imaginaire</Company><Characters>123456</Characters></Properties>',
      'docProps/custom.xml': EN_TETE + '<Properties><property name="Client"><lpwstr>Tartempion</lpwstr></property></Properties>',
      'docProps/thumbnail.jpeg': new Uint8Array([1, 2, 3, 4]),
    },
  });
  const sortie = await anonymiser(archive);
  const entrees = await zip.lire(sortie);
  const noms = entrees.map((e) => e.nom);
  assert.ok(!noms.includes('docProps/custom.xml'));
  assert.ok(!noms.includes('docProps/thumbnail.jpeg'));
  const coeur = await lirePartie(sortie, 'docProps/core.xml');
  const application = await lirePartie(sortie, 'docProps/app.xml');
  assert.doesNotMatch(coeur + application, /Tartempion|Fictive|Imaginaire|Matrice|123456/);
  assert.match(coeur, /<cp:coreProperties [^>]*\/>|<cp:coreProperties [^>]*><\/cp:coreProperties>/);
  assert.match(application, /<Properties [^>]*\/>|<Properties [^>]*><\/Properties>/);
  assert.doesNotMatch(await lirePartie(sortie, '[Content_Types].xml'), /custom\.xml/);
  const racine = await lirePartie(sortie, '_rels/.rels');
  assert.doesNotMatch(racine, /custom\.xml|thumbnail/);
  assert.match(racine, /docProps\/core\.xml/);
  assert.match(racine, /word\/document\.xml/);
  assert.deepEqual(docx.verifierSortie(entrees), []);
});

test('liste des personnes, modèle attaché et descriptions d’images : neutralisés', async () => {
  const dessin = '<w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="photo_tartempion.jpg" descr="C:\\Users\\ztartempion\\photo.jpg" title="Tartempion"/></wp:inline></w:drawing></w:r></w:p>';
  const archive = await fabriquer(p('Texte.') + dessin, {
    relationsDocument: [
      { type: TYPE.personnes, cible: 'people.xml' },
      { type: TYPE.reglages, cible: 'settings.xml' },
    ],
    parties: {
      'word/people.xml': EN_TETE + '<w15:people><w15:person w15:author="Zébulon Tartempion"/></w15:people>',
      'word/settings.xml': partieW('settings', '<w:attachedTemplate r:id="rId1"/>'),
      'word/_rels/settings.xml.rels':
        EN_TETE + '<Relationships xmlns="x"><Relationship Id="rId1" Type="' + TYPE.modele + '" Target="file:///C:\\Users\\ztartempion\\Matrice%20Tartempion.dotx" TargetMode="External"/></Relationships>',
    },
  });
  const sortie = await anonymiser(archive);
  const entrees = await zip.lire(sortie);
  assert.ok(!entrees.some((e) => e.nom === 'word/people.xml'));
  assert.doesNotMatch(await lirePartie(sortie, 'word/_rels/document.xml.rels'), /people/);
  assert.doesNotMatch(await lirePartie(sortie, '[Content_Types].xml'), /people/);
  assert.doesNotMatch(await lirePartie(sortie, 'word/_rels/settings.xml.rels'), /tartempion/i);
  const xml = await lirePartie(sortie, 'word/document.xml');
  assert.doesNotMatch(xml, /tartempion/i);
  assert.match(xml, /<wp:docPr id="1" name="Image" descr="" title=""\/>/);
});

test('document avec commentaires : refusé avec la marche à suivre', async () => {
  const archive = await fabriquer(p('Texte.'), {
    parties: { 'word/comments.xml': partieW('comments', '<w:comment w:id="0" w:author="Zébulon Tartempion">' + p('À revoir.') + '</w:comment>') },
  });
  const doc = await docx.ouvrir(archive);
  assert.deepEqual(doc.refus.map((x) => x.code), ['commentaires']);
  assert.match(doc.refus[0].marche, /Word/);
  assert.deepEqual(doc.blocs, []);
  await assert.rejects(() => docx.produire(doc, []), /refus/i);
});

test('document avec modifications suivies : refusé', async () => {
  const insertion = await fabriquer('<w:p><w:ins w:id="1" w:author="Zébulon Tartempion"><w:r><w:t>ajout</w:t></w:r></w:ins></w:p>');
  const suppression = await fabriquer('<w:p><w:del w:id="1" w:author="Z"><w:r><w:delText>retrait</w:delText></w:r></w:del></w:p>');
  const miseEnForme = await fabriquer('<w:p><w:r><w:rPr><w:b/><w:rPrChange w:id="2" w:author="Z"><w:rPr/></w:rPrChange></w:rPr><w:t>gras</w:t></w:r></w:p>');
  for (const archive of [insertion, suppression, miseEnForme]) {
    const doc = await docx.ouvrir(archive);
    assert.deepEqual(doc.refus.map((x) => x.code), ['modifications']);
  }
});

test('bordures de tableau (w:insideH) : laissées hors du refus', async () => {
  const tableau = '<w:tbl><w:tblPr><w:tblBorders><w:insideH w:val="single"/><w:insideV w:val="single"/></w:tblBorders></w:tblPr><w:tr><w:tc>' + p('Cellule') + '</w:tc></w:tr></w:tbl>';
  const doc = await docx.ouvrir(await fabriquer(tableau));
  assert.deepEqual(doc.refus, []);
  assert.deepEqual(doc.blocs.map((b) => b.texte), ['Cellule']);
});

test('document avec données XML liées (customXml) : refusé', async () => {
  const archive = await fabriquer(p('Texte.'), { parties: { 'customXml/item1.xml': '<donnees><client>Tartempion</client></donnees>' } });
  const doc = await docx.ouvrir(archive);
  assert.deepEqual(doc.refus.map((x) => x.code), ['donnees-liees']);
});

test('images comptées et laissées telles quelles', async () => {
  const image = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
  const archive = await fabriquer(p('Texte.'), {
    parties: { 'word/media/image1.png': image, 'word/media/image2.jpeg': image, 'word/embeddings/objet1.bin': image },
  });
  const doc = await docx.ouvrir(archive);
  assert.equal(doc.images, 2);
  assert.equal(doc.objets, 1);
  const sortie = await zip.lire(await docx.produire(doc, doc.blocs.map(() => [])));
  assert.deepEqual(Array.from(sortie.find((e) => e.nom === 'word/media/image1.png').donnees), Array.from(image));
});

test('document produit : CRC-32 et tailles valides selon `unzip -t`', async () => {
  const corps = p(r('Audition de Zébu'), r('lon Tartempion'), ' le 12/03/2024, tél. 01 23 45 67 89.');
  const sortie = await anonymiser(await fabriquer(corps), ['Zébulon Tartempion']);
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'anonymiseur-docx-'));
  const chemin = path.join(dossier, 'exemple-anonymise-1.docx');
  fs.writeFileSync(chemin, sortie);
  assert.match(execFileSync('unzip', ['-t', chemin], { encoding: 'utf8' }), /No errors detected/);
  fs.rmSync(dossier, { recursive: true });
  const xml = await lirePartie(sortie, 'word/document.xml');
  assert.match(xml, /\[NOM 1\]/);
  assert.match(xml, /\[TÉLÉPHONE 1\]/);
  assert.doesNotMatch(xml, /12\/03\/2024/);
});

test('saut de ligne et tabulation : lus comme du texte, adresse sur deux lignes remplacée', async () => {
  const corps = '<w:p><w:r><w:t>Adresse :</w:t><w:tab/><w:t>12 rue des Lilas</w:t><w:br/><w:t>69003 Lyon</w:t></w:r></w:p>';
  const archive = await fabriquer(corps);
  const doc = await docx.ouvrir(archive);
  assert.equal(doc.blocs[0].texte, 'Adresse :\t12 rue des Lilas\n69003 Lyon');
  const xml = await lirePartie(await anonymiser(archive), 'word/document.xml');
  assert.match(xml, /<w:tab\/><w:t xml:space="preserve">\[ADRESSE 1\]<\/w:t><w:br\/><w:t xml:space="preserve"><\/w:t>/);
});

test('caractères spéciaux : décodés à la lecture, encodés à l’écriture', async () => {
  const archive = await fabriquer(p('Tartempion &amp; fils &lt;siège&gt; &#233;tabli, tél. 01 23 45 67 89 &amp; fax.'));
  const doc = await docx.ouvrir(archive);
  assert.equal(doc.blocs[0].texte, 'Tartempion & fils <siège> établi, tél. 01 23 45 67 89 & fax.');
  const xml = await lirePartie(await anonymiser(archive, ['Tartempion']), 'word/document.xml');
  assert.match(xml, /\[NOM 1\] &amp; fils &lt;siège&gt; établi, tél\. \[TÉLÉPHONE 1\] &amp; fax\./);
});

test('zone de texte : le paragraphe imbriqué est traité à part', async () => {
  const corps = '<w:p><w:r><w:t>Avant </w:t></w:r><w:r><w:pict><v:textbox><w:txbxContent>' + p('Encadré : Tartempion') + '</w:txbxContent></v:textbox></w:pict></w:r><w:r><w:t>après Tartempion.</w:t></w:r></w:p>';
  const archive = await fabriquer(corps);
  const doc = await docx.ouvrir(archive);
  assert.deepEqual(doc.blocs.map((b) => b.texte), ['Avant après Tartempion.', 'Encadré : Tartempion']);
  const xml = await lirePartie(await anonymiser(archive, ['Tartempion']), 'word/document.xml');
  assert.doesNotMatch(xml, /Tartempion/);
  assert.equal(xml.match(/\[NOM 1\]/g).length, 2);
});

test('code de champ et infobulle de lien : traités comme du texte', async () => {
  const corps =
    '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> HYPERLINK "mailto:zebulon@exemple.test" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>' +
    '<w:p><w:hyperlink r:id="rId9" w:tooltip="Écrire à zebulon@exemple.test"><w:r><w:t>Contact</w:t></w:r></w:hyperlink></w:p>';
  const archive = await fabriquer(corps);
  const doc = await docx.ouvrir(archive);
  assert.ok(doc.blocs.some((b) => b.type === 'champ'));
  assert.ok(doc.blocs.some((b) => b.type === 'infobulle'));
  const xml = await lirePartie(await anonymiser(archive), 'word/document.xml');
  assert.doesNotMatch(xml, /zebulon/);
  assert.match(xml, /HYPERLINK "mailto:\[COURRIEL 1\]"/);
  assert.match(xml, /w:tooltip="Écrire à \[COURRIEL 1\]"/);
});

test('une archive sans document Word est refusée avec un message clair', async () => {
  const archive = await zip.ecrire([{ nom: 'tableur/feuille.xml', donnees: new TextEncoder().encode('<x/>') }]);
  await assert.rejects(() => docx.ouvrir(archive), /document Word/);
});

test('le texte de contrôle d’un document produit couvre toutes les parties XML', async () => {
  const archive = await fabriquer(p('Corps.'), {
    parties: { 'word/charts/chart1.xml': '<c:chart><c:v>Tartempion 0612345678</c:v></c:chart>' },
  });
  const doc = await docx.ouvrir(await anonymiser(archive));
  const textes = docx.textesDeControle(doc).map((t) => t.texte);
  assert.ok(textes.includes('Corps.'));
  assert.ok(textes.some((t) => /Tartempion 0612345678/.test(t)));
});
