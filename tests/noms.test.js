'use strict';
// Noms propres : liste fournie par l'utilisateur (avec variantes) et suggestions.
// Tous les noms sont inventés pour les tests.
const test = require('node:test');
const assert = require('node:assert/strict');

const noms = require('../public/noms.js');

const parListe = (texte, termes) => noms.chercherTermes(texte, termes).map((d) => d.valeur);
const suggestions = (texte) => noms.suggerer(texte).map((d) => d.valeur);

test('lecture de la liste saisie : un terme par ligne ou séparé par un point-virgule', () => {
  assert.deepEqual(noms.lireListe(' Zébulon Tartempion \n\nCunégonde Fictive; Garage Imaginaire\nzébulon tartempion'), [
    'Zébulon Tartempion',
    'Cunégonde Fictive',
    'Garage Imaginaire',
  ]);
});

test('terme de la liste : retrouvé en majuscules, en minuscules, sans accents', () => {
  const termes = ['Zébulon Tartempion'];
  assert.deepEqual(parListe('audition de ZÉBULON TARTEMPION ce jour', termes), ['ZÉBULON TARTEMPION']);
  assert.deepEqual(parListe('audition de zébulon tartempion ce jour', termes), ['zébulon tartempion']);
  assert.deepEqual(parListe('audition de Zebulon Tartempion ce jour', termes), ['Zebulon Tartempion']);
  assert.deepEqual(parListe('audition de ZEBULON TARTEMPION ce jour', termes), ['ZEBULON TARTEMPION']);
});

test('terme de la liste : nom seul, prénom seul, ordre inversé', () => {
  const termes = ['Zébulon Tartempion'];
  assert.deepEqual(parListe('M. Tartempion a déclaré', termes), ['Tartempion']);
  assert.deepEqual(parListe('le prénommé Zébulon a déclaré', termes), ['Zébulon']);
  assert.deepEqual(parListe('TARTEMPION Zébulon, né à', termes), ['TARTEMPION', 'Zébulon']);
});

test('terme de la liste : tirets et espaces équivalents', () => {
  assert.deepEqual(parListe('entendu Jean Pierre Fictif', ['Jean-Pierre Fictif']), ['Jean Pierre Fictif']);
  assert.deepEqual(parListe('entendu Jean-Pierre Fictif', ['Jean Pierre Fictif']), ['Jean-Pierre Fictif']);
  assert.deepEqual(parListe('la commune de Trifouilly les Oies', ['Trifouilly-les-Oies']), ['Trifouilly les Oies']);
});

test('terme de la liste : un mot plus long reste intact, les particules seules aussi', () => {
  assert.deepEqual(parListe('une tartempionnade de la part de', ['Zébulon de la Tartempion']), []);
  assert.deepEqual(parListe('le dossier de la partie adverse', ['Zébulon de la Tartempion']), []);
});

test('terme de la liste : retrouvé dans un nom de fichier ou collé à une ponctuation', () => {
  assert.deepEqual(parListe('pièce tartempion_conclusions.docx jointe', ['Zébulon Tartempion']), ['tartempion']);
  assert.deepEqual(parListe('(Tartempion), «Zébulon»', ['Zébulon Tartempion']), ['Tartempion', 'Zébulon']);
});

test('nom complet et nom seul désignent la même personne ; un nom porté par deux personnes reçoit sa propre entrée', () => {
  const seul = noms.chercherTermes('Zébulon Tartempion puis M. Tartempion', ['Zébulon Tartempion']);
  assert.equal(seul.length, 2);
  assert.equal(seul[0].entite, 'NOM:zebulon tartempion');
  assert.equal(seul[1].entite, 'NOM:zebulon tartempion');
  assert.notEqual(seul[0].cle, seul[1].cle, 'le nom seul se décoche à part');

  const deux = noms.chercherTermes('M. Tartempion', ['Zébulon Tartempion', 'Cunégonde Tartempion']);
  assert.equal(deux[0].entite, 'NOM:tartempion');
});

test('les positions rendues désignent exactement la valeur', () => {
  const texte = 'Selon ZEBULON  TARTEMPION et Cunégonde Fictive.';
  for (const d of noms.chercherTermes(texte, ['Zébulon Tartempion', 'Cunégonde Fictive'])) {
    assert.equal(texte.slice(d.debut, d.fin), d.valeur);
    assert.equal(d.categorie, 'NOM');
    assert.equal(d.source, 'liste');
  }
});

test('suggestion après chaque civilité ou titre', () => {
  assert.deepEqual(suggestions('entendu M. Tartempion hier'), ['Tartempion']);
  assert.deepEqual(suggestions('entendu Mme Fictive hier'), ['Fictive']);
  assert.deepEqual(suggestions('assisté de Me Imaginaire, avocat'), ['Imaginaire']);
  assert.deepEqual(suggestions('assisté de Maître Imaginaire, avocat'), ['Imaginaire']);
  assert.deepEqual(suggestions('examiné par le Dr Chimère hier'), ['Chimère']);
  assert.deepEqual(suggestions('nous entendons Monsieur Zébulon TARTEMPION, né'), ['Zébulon TARTEMPION']);
  assert.deepEqual(suggestions('et Madame Cunégonde de la Fiction, son épouse'), ['Cunégonde de la Fiction']);
});

test('suggestion après une civilité : même en début de phrase, même pour un mot courant', () => {
  assert.deepEqual(suggestions('M. Petit conteste. Mme Rose aussi.'), ['Petit', 'Rose']);
  assert.deepEqual(suggestions('Monsieur le Président, Madame, Monsieur,'), []);
  assert.deepEqual(suggestions('il me Semble'), ['Semble'], 'mot à majuscule en milieu de phrase, sans lien avec « me »');
});

test('suite de mots à majuscule initiale en milieu de phrase', () => {
  assert.deepEqual(suggestions('le témoin Zébulon Tartempion affirme'), ['Zébulon Tartempion']);
  assert.deepEqual(suggestions('la société Assurances Imaginaires refuse'), ['Assurances Imaginaires']);
  assert.deepEqual(suggestions('un accident survenu à Trifouilly-les-Oies hier'), ['Trifouilly-les-Oies']);
});

test('début de phrase à majuscule : laissé hors suggestion', () => {
  assert.deepEqual(suggestions('Attendu que le demandeur conteste. Il soutient le contraire.'), []);
  assert.deepEqual(suggestions('Le véhicule a été heurté.\nSur les faits : Monsieur conteste.'), []);
  assert.deepEqual(suggestions('- Dire et juger que la demande est fondée ;\n1. Condamner le défendeur'), []);
});

test('mot en majuscules d’au moins trois lettres : suggéré hors de la liste juridique', () => {
  assert.deepEqual(suggestions('audition de TARTEMPION ce jour'), ['TARTEMPION']);
  assert.deepEqual(suggestions('la société GARAGE IMAGINAIRE SARL conteste'), ['GARAGE IMAGINAIRE']);
  assert.deepEqual(suggestions('TARTEMPION Zébulon'), ['TARTEMPION Zébulon'], 'majuscules : suggéré même en début de ligne');
});

test('termes juridiques courants en majuscules : laissés', () => {
  assert.deepEqual(suggestions('TRIBUNAL JUDICIAIRE DE LYON'), []);
  assert.deepEqual(suggestions('PROCÈS-VERBAL D’AUDITION'), []);
  assert.deepEqual(suggestions('PAR CES MOTIFS'), []);
  assert.deepEqual(suggestions('ARTICLE 3 - TITRE III - CHAPITRE XIV'), []);
  assert.deepEqual(suggestions('CONCLUSIONS POUR : LE DEMANDEUR CONTRE : LA SARL'), []);
});

test('références de droit et juridictions : le texte reste entier', () => {
  assert.deepEqual(suggestions('devant la Cour d’appel de Paris, qui a jugé'), []);
  assert.deepEqual(suggestions('devant le Tribunal judiciaire de Lyon et le Conseil de prud’hommes de Nanterre'), []);
  assert.deepEqual(suggestions('selon l’article 1240 du Code civil et la Cour de cassation'), []);
  assert.deepEqual(suggestions('la décision (Cass. civ. 2e, 12 mars 2020, n° 19-12.345) le rappelle'), []);
  assert.deepEqual(suggestions('inscrit au Barreau de Lyon, la République française'), []);
});

test('mots qui suivent « né à », « demeurant », « représenté par »', () => {
  assert.deepEqual(suggestions('il est né à trifouilly en 1980'), ['trifouilly']);
  assert.deepEqual(suggestions('elle est née à Villefictive (Rhône imaginaire)'), ['Villefictive', 'Rhône']);
  assert.deepEqual(suggestions('demeurant à Villefictive, sans emploi'), ['Villefictive']);
  assert.deepEqual(suggestions('la société, représentée par son gérant'), []);
  assert.deepEqual(suggestions('représentée par Cunégonde Fictive, gérante'), ['Cunégonde Fictive']);
  assert.deepEqual(suggestions('il est né à la maternité'), []);
});

test('une étiquette déjà posée reste intacte', () => {
  assert.deepEqual(suggestions('selon [NOM 1], entendu par M. [NOM 2] à [ADRESSE 1]'), []);
});

test('suggestions : positions, catégorie et source', () => {
  const texte = 'entendu M. Tartempion puis le témoin Cunégonde Fictive.';
  const trouvees = noms.suggerer(texte);
  assert.equal(trouvees.length, 2);
  for (const d of trouvees) {
    assert.equal(texte.slice(d.debut, d.fin), d.valeur);
    assert.equal(d.categorie, 'NOM');
    assert.equal(d.source, 'suggestion');
  }
  assert.equal(trouvees[1].cle, 'NOM:cunegonde fictive');
});

test('une valeur suggérée est ensuite recherchée partout sous sa forme à majuscule', () => {
  const termes = [{ valeur: 'Rose Tartempion', source: 'suggestion' }];
  const texte = 'Tartempion conteste. La rose est rouge. ROSE TARTEMPION signe. Rose aussi.';
  assert.deepEqual(noms.chercherTermes(texte, termes).map((d) => d.valeur), ['Tartempion', 'ROSE TARTEMPION', 'Rose']);
});

test('un mot du lexique juridique tiré d’une suggestion reste hors de la recherche du mot seul', () => {
  const termes = [{ valeur: 'Assurances Imaginaires', source: 'suggestion' }];
  assert.deepEqual(noms.chercherTermes('Les Assurances couvrent. Imaginaires ou non.', termes).map((d) => d.valeur), ['Imaginaires']);
});

test('civilité collée au nom, forme de société en fin de nom', () => {
  assert.deepEqual(suggestions('Entendu M.Tartempion hier'), ['Tartempion']);
  assert.deepEqual(suggestions('la société ASSURANCES IMAGINAIRES SA, prise'), ['ASSURANCES IMAGINAIRES']);
  assert.deepEqual(suggestions('examiné au CHU de Villefictive hier'), ['Villefictive']);
});

test('la commune d’une juridiction reste dans le texte même quand elle est suggérée ailleurs ; un terme de la liste est masqué partout', () => {
  const texte = 'Il est né à Lyon. Le Tribunal judiciaire de Lyon a statué.';
  assert.deepEqual(noms.chercherTermes(texte, [{ valeur: 'Lyon', source: 'suggestion' }]).map((d) => d.debut), [12]);
  assert.deepEqual(noms.chercherTermes(texte, ['Lyon']).map((d) => d.debut), [12, 44]);
});
