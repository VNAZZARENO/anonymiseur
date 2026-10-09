'use strict';
// Règles déterministes : pour chaque catégorie, des formes reconnues et des formes voisines laissées.
// Toutes les valeurs sont inventées pour les tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { detecter } = require('../public/detecteurs.js');

const trouve = (texte) => detecter(texte).map((d) => [d.categorie, d.valeur]);
const valeurs = (texte, categorie) => detecter(texte).filter((d) => d.categorie === categorie).map((d) => d.valeur);
const categories = (texte) => detecter(texte).map((d) => d.categorie);

test('les positions rendues désignent exactement la valeur dans le texte', () => {
  const texte = 'Écrire à zebulon@exemple.test ou appeler le 01 23 45 67 89 avant le 12/03/2024.';
  const detections = detecter(texte);
  assert.equal(detections.length, 3);
  for (const d of detections) assert.equal(texte.slice(d.debut, d.fin), d.valeur);
  for (let i = 1; i < detections.length; i += 1) assert.ok(detections[i].debut >= detections[i - 1].fin);
});

test('courriel : trois formes reconnues, deux formes voisines laissées', () => {
  assert.deepEqual(valeurs('Contact : zebulon.tartempion@exemple.test.', 'COURRIEL'), ['zebulon.tartempion@exemple.test']);
  assert.deepEqual(valeurs('Écrire à Z_T+dossier@cabinet-fictif.exemple.test, merci', 'COURRIEL'), ['Z_T+dossier@cabinet-fictif.exemple.test']);
  assert.deepEqual(valeurs('(greffe@tribunal.exemple)', 'COURRIEL'), ['greffe@tribunal.exemple']);
  assert.deepEqual(valeurs('rendez-vous @ 14 heures', 'COURRIEL'), []);
  assert.deepEqual(valeurs('le compte @zebulon sur un réseau', 'COURRIEL'), []);
});

test('adresse web : trois formes reconnues, deux formes voisines laissées', () => {
  assert.deepEqual(valeurs('Voir https://www.cabinet-fictif.exemple.test/equipe?id=3.', 'URL'), ['https://www.cabinet-fictif.exemple.test/equipe?id=3']);
  assert.deepEqual(valeurs('site www.garage-fictif.fr, rubrique contact', 'URL'), ['www.garage-fictif.fr']);
  assert.deepEqual(valeurs('consulter garage-fictif.fr pour le devis', 'URL'), ['garage-fictif.fr']);
  assert.deepEqual(valeurs('Cass. civ. 2e, pourvoi rejeté', 'URL'), []);
  assert.deepEqual(valeurs('fin de phrase.Fr ancien', 'URL'), []);
});

test('téléphone : avec +33, points, espaces, tirets, collé', () => {
  assert.deepEqual(valeurs('Tél. 01 23 45 67 89', 'TELEPHONE'), ['01 23 45 67 89']);
  assert.deepEqual(valeurs('Tél. 06.12.34.56.78.', 'TELEPHONE'), ['06.12.34.56.78']);
  assert.deepEqual(valeurs('Tél. +33 6 12 34 56 78', 'TELEPHONE'), ['+33 6 12 34 56 78']);
  assert.deepEqual(valeurs('Tél. +33 (0)1 23 45 67 89', 'TELEPHONE'), ['+33 (0)1 23 45 67 89']);
  assert.deepEqual(valeurs('Tél. 0033612345678', 'TELEPHONE'), ['0033612345678']);
  assert.deepEqual(valeurs('Tél. 0612345678', 'TELEPHONE'), ['0612345678']);
  assert.deepEqual(valeurs('Tél. 06-12-34-56-78', 'TELEPHONE'), ['06-12-34-56-78']);
  assert.deepEqual(valeurs('Tél. 06 12 34 56 78', 'TELEPHONE'), ['06 12 34 56 78']);
});

test('téléphone : formes voisines laissées à cette catégorie', () => {
  assert.deepEqual(valeurs('code 01 23 45 67', 'TELEPHONE'), [], '8 chiffres');
  assert.deepEqual(valeurs('référence 00 12 34 56 78', 'TELEPHONE'), [], 'indicatif 00');
  assert.deepEqual(valeurs('article 1240 du code civil', 'TELEPHONE'), []);
});

test('IBAN : français et étrangers reconnus par la clé modulo 97', () => {
  assert.deepEqual(valeurs('IBAN : FR76 3000 6000 0112 3456 7890 189 (compte fictif)', 'IBAN'), ['FR76 3000 6000 0112 3456 7890 189']);
  assert.deepEqual(valeurs('IBAN FR7630006000011234567890189.', 'IBAN'), ['FR7630006000011234567890189']);
  assert.deepEqual(valeurs('IBAN DE89 3704 0044 0532 0130 00 BIC FICTDEFF', 'IBAN'), ['DE89 3704 0044 0532 0130 00']);
  assert.deepEqual(valeurs('IBAN GB82 WEST 1234 5698 7654 32', 'IBAN'), ['GB82 WEST 1234 5698 7654 32']);
  assert.deepEqual(valeurs('IBAN BE68 5390 0754 7034 TITULAIRE', 'IBAN'), ['BE68 5390 0754 7034']);
});

test('IBAN à clé fausse : laissé à cette catégorie, ses chiffres passent en numéro long', () => {
  const texte = 'IBAN : FR76 3000 6000 0112 3456 7890 188';
  assert.deepEqual(valeurs(texte, 'IBAN'), []);
  assert.deepEqual(valeurs(texte, 'NUMERO'), ['3000 6000 0112 3456 7890 188']);
  assert.deepEqual(valeurs('référence AB12 court', 'IBAN'), []);
});

test('numéro de sécurité sociale : 13 chiffres et clé modulo 97', () => {
  assert.deepEqual(valeurs('NIR 1 84 12 76 451 089 46', 'NIR'), ['1 84 12 76 451 089 46']);
  assert.deepEqual(valeurs('NIR 255081416802538.', 'NIR'), ['255081416802538']);
  assert.deepEqual(valeurs('NIR 1 80 05 2A 123 456 84 (Corse)', 'NIR'), ['1 80 05 2A 123 456 84']);
  assert.deepEqual(valeurs('NIR 1 84 12 76 451 089 47', 'NIR'), [], 'clé fausse');
  assert.deepEqual(valeurs('NIR 1 84 12 76 451 089', 'NIR'), [], 'clé absente');
  assert.deepEqual(valeurs('NIR 1 84 12 76 451 089 47', 'NUMERO'), ['1 84 12 76 451 089 47'], 'reste masqué comme numéro long');
});

test('SIREN et SIRET : clé de Luhn', () => {
  assert.deepEqual(trouve('SIREN 732 829 320'), [['SIREN', '732 829 320']]);
  assert.deepEqual(trouve('SIREN 732829320,'), [['SIREN', '732829320']]);
  assert.deepEqual(trouve('RCS Paris B 552 100 554'), [['SIREN', '552 100 554']]);
  assert.deepEqual(trouve('SIRET 732 829 320 00074'), [['SIRET', '732 829 320 00074']]);
  assert.deepEqual(trouve('SIRET 73282932000074'), [['SIRET', '73282932000074']]);
  assert.deepEqual(trouve('SIRET 404 833 048 00022.'), [['SIRET', '404 833 048 00022']]);
});

test('suite de 9 chiffres à clé de Luhn fausse : laissée à SIREN, masquée comme numéro long', () => {
  assert.deepEqual(trouve('dossier 123456789'), [['NUMERO', '123456789']]);
  assert.deepEqual(trouve('dossier 123 456 789'), [['NUMERO', '123 456 789']]);
  assert.deepEqual(valeurs('SIRET 732 829 320 00075', 'SIRET'), []);
});

test('immatriculation : format actuel et ancien format', () => {
  assert.deepEqual(trouve('véhicule AB-123-CD'), [['IMMATRICULATION', 'AB-123-CD']]);
  assert.deepEqual(trouve('véhicule AB 123 CD,'), [['IMMATRICULATION', 'AB 123 CD']]);
  assert.deepEqual(trouve('véhicule AB123CD'), [['IMMATRICULATION', 'AB123CD']]);
  assert.deepEqual(trouve('véhicule 1234 AB 75'), [['IMMATRICULATION', '1234 AB 75']]);
  assert.deepEqual(trouve('véhicule 123 ABC 2A.'), [['IMMATRICULATION', '123 ABC 2A']]);
  assert.deepEqual(valeurs('lot AB-12-CD', 'IMMATRICULATION'), []);
  assert.deepEqual(valeurs('pièce IO-123-OU', 'IMMATRICULATION'), [], 'lettres I, O et U absentes du format');
  assert.deepEqual(valeurs('en 2019 il a 45 ans', 'IMMATRICULATION'), []);
});

test('date numérique : formes reconnues', () => {
  assert.deepEqual(valeurs('le 12/03/2024 à midi', 'DATE'), ['12/03/2024']);
  assert.deepEqual(valeurs('le 1/3/24.', 'DATE'), ['1/3/24']);
  assert.deepEqual(valeurs('le 12.03.2024,', 'DATE'), ['12.03.2024']);
  assert.deepEqual(valeurs('le 12-03-2024', 'DATE'), ['12-03-2024']);
  assert.deepEqual(valeurs('le 2024-03-12', 'DATE'), ['2024-03-12']);
  assert.deepEqual(valeurs('le 29/02/2024', 'DATE'), ['29/02/2024'], 'année bissextile');
});

test('date impossible ou forme voisine : laissée', () => {
  assert.deepEqual(trouve('le 31/02/2024'), []);
  assert.deepEqual(trouve('le 29/02/2023'), []);
  assert.deepEqual(trouve('le 12/13/2024'), []);
  assert.deepEqual(trouve('le 00/01/2024'), []);
  assert.deepEqual(trouve('ratio 3/4 du prix'), []);
  assert.deepEqual(trouve('le 31 novembre 2024'), [['DATE', 'novembre 2024']], 'jour impossible : le mois et l’année restent une date');
});

test('date en toutes lettres, mois et année, jour et mois, né le, né en', () => {
  assert.deepEqual(valeurs('le 12 mars 2024', 'DATE'), ['12 mars 2024']);
  assert.deepEqual(valeurs('le 1er août 2023', 'DATE'), ['1er août 2023']);
  assert.deepEqual(valeurs('LE 3 FÉVRIER 2021', 'DATE'), ['3 FÉVRIER 2021']);
  assert.deepEqual(valeurs('le 3 fevrier 2021', 'DATE'), ['3 fevrier 2021']);
  assert.deepEqual(valeurs('le 5 déc. 2022', 'DATE'), ['5 déc. 2022']);
  assert.deepEqual(valeurs('en mars 2024', 'DATE'), ['mars 2024']);
  assert.deepEqual(valeurs('survenu le 12 mars vers midi', 'DATE'), ['12 mars']);
  assert.deepEqual(valeurs('né le 4 mai 1980 à Trifouilly', 'DATE'), ['4 mai 1980']);
  assert.deepEqual(valeurs('née en 1975', 'DATE'), ['1975']);
  assert.deepEqual(valeurs('le lundi 12 mars 2024', 'DATE'), ['12 mars 2024']);
});

test('date : la détection porte sa valeur calendaire', () => {
  const [d] = detecter('le 12/03/2024');
  assert.equal(d.cle, 'DATE:2024-03-12');
  const [e] = detecter('le 12 mars 2024');
  assert.equal(e.cle, 'DATE:2024-03-12');
  const [f] = detecter('le 1/3/24');
  assert.equal(f.cle, 'DATE:2024-03-01');
});

test('date d’un texte de loi ou d’une référence de jurisprudence : laissée', () => {
  assert.deepEqual(trouve('la loi n° 85-677 du 5 juillet 1985 tendant à l’amélioration'), []);
  assert.deepEqual(trouve('la loi du 5 juillet 1985'), []);
  assert.deepEqual(trouve('le décret n° 2011-1202 du 28 septembre 2011'), []);
  assert.deepEqual(trouve('l’ordonnance n° 2016-131 du 10 février 2016 portant réforme'), []);
  assert.deepEqual(trouve('par ordonnance du 10 février 2016, le juge'), [['DATE', '10 février 2016']], 'décision de justice : date masquée');
  assert.deepEqual(trouve('le CE de la société s’est réuni le 12 juin 2020'), [['DATE', '12 juin 2020']]);
  assert.deepEqual(trouve('Cass. civ. 2e, 12 mars 2020, n° 19-12.345'), []);
  assert.deepEqual(trouve('(Civ. 2e, 4 avril 2019, n° 18-13.704)'), []);
  assert.deepEqual(trouve('Cass. crim., 3 mai 2018, n° 17-82.034, publié au Bulletin'), []);
  assert.deepEqual(trouve('CE, 12 juin 2020, n° 418142'), [['NUMERO', '418142']]);
});

test('références de droit : numéros d’article et de texte laissés entiers', () => {
  assert.deepEqual(trouve('l’article 1240 du Code civil'), []);
  assert.deepEqual(trouve('les articles L. 211-1 et R. 4127-28 du code'), []);
  assert.deepEqual(trouve('l’article 700 du code de procédure civile'), []);
  assert.deepEqual(trouve('articles 1231-1 et 1231-2'), []);
  assert.deepEqual(trouve('l’alinéa 3 de l’article 16-1-1'), []);
  assert.deepEqual(trouve('le règlement (UE) 2016/679'), []);
  assert.deepEqual(trouve('page 12 sur 345'), []);
});

test('montant : formes reconnues', () => {
  assert.deepEqual(trouve('la somme de 1 500 €'), [['MONTANT', '1 500 €']]);
  assert.deepEqual(trouve('la somme de 1 500,50 euros.'), [['MONTANT', '1 500,50 euros']]);
  assert.deepEqual(trouve('soit 12000 EUR'), [['MONTANT', '12000 EUR']]);
  assert.deepEqual(trouve('soit 1.250.000,00 €'), [['MONTANT', '1.250.000,00 €']]);
  assert.deepEqual(trouve('soit 250 000 € au total'), [['MONTANT', '250 000 €']]);
  assert.deepEqual(trouve('soit 2,5 millions d’euros'), [['MONTANT', '2,5 millions d’euros']]);
  assert.deepEqual(trouve('1 euro symbolique'), [['MONTANT', '1 euro']]);
});

test('montant : formes voisines laissées', () => {
  assert.deepEqual(trouve('un taux de 12 %'), []);
  assert.deepEqual(trouve('la zone euro et 3 pays'), []);
  assert.deepEqual(trouve('une distance de 1 500 mètres'), []);
});

test('adresse postale : voie, code postal et commune', () => {
  assert.deepEqual(trouve('demeurant 12 rue des Lilas, 69003 Lyon, sans profession'), [['ADRESSE', '12 rue des Lilas, 69003 Lyon']]);
  assert.deepEqual(trouve('sis 4 bis avenue du Général-Fictif 75008 Paris.'), [['ADRESSE', '4 bis avenue du Général-Fictif 75008 Paris']]);
  assert.deepEqual(trouve('3, boulevard de la Fiction\n13100 Aix-en-Provence'), [['ADRESSE', '3, boulevard de la Fiction\n13100 Aix-en-Provence']]);
  assert.deepEqual(trouve('12 rue des Lilas, Bâtiment B, 69003 LYON CEDEX 03'), [['ADRESSE', '12 rue des Lilas, Bâtiment B, 69003 LYON CEDEX 03']]);
});

test('adresse postale : voie seule avec numéro, code postal et commune seuls', () => {
  assert.deepEqual(trouve('devant le 27 chemin du Moulin et plus loin'), [['ADRESSE', '27 chemin du Moulin']]);
  assert.deepEqual(trouve('domicilié à 69003 Lyon'), [['ADRESSE', '69003 Lyon']]);
  assert.deepEqual(trouve('97400 Saint-Denis de La Réunion'), [['ADRESSE', '97400 Saint-Denis de La Réunion']]);
});

test('adresse postale : formes voisines laissées', () => {
  assert.deepEqual(trouve('au cours de l’année, la rue était mouillée'), []);
  assert.deepEqual(trouve('les 3 voies de recours'), []);
  assert.deepEqual(trouve('la Cour d’appel de Paris a jugé'), []);
  assert.deepEqual(trouve('une indemnité de 12345 points'), [], 'cinq chiffres sans commune');
  assert.deepEqual(trouve('code 00123 Test'), [], 'département 00 inexistant');
});

test('numéro long : au moins six chiffres hors des autres catégories', () => {
  assert.deepEqual(trouve('permis n° 123456'), [['NUMERO', '123456']]);
  assert.deepEqual(trouve('avis de contravention 4012345678'), [['NUMERO', '4012345678']]);
  assert.deepEqual(trouve('police AB1234567X'), [['NUMERO', 'AB1234567X']]);
  assert.deepEqual(trouve('contrat 12 345 678 souscrit'), [['NUMERO', '12 345 678']]);
  assert.deepEqual(trouve('numéro 12345'), [], 'cinq chiffres');
  assert.deepEqual(trouve('en 2023 150 dossiers'), [], 'deux nombres voisins');
});

test('numéro de rôle : reconnu après la mention RG ou Portalis', () => {
  assert.deepEqual(trouve('N° RG 21/01234'), [['NUMERO', '21/01234']]);
  assert.deepEqual(trouve('RG n° 23/00456 - N° Portalis DBVX-V-B7H-FICT'), [['NUMERO', '23/00456'], ['NUMERO', 'DBVX-V-B7H-FICT']]);
  assert.deepEqual(trouve('le ratio 21/01234'), []);
});

test('une valeur déjà remplacée par une étiquette reste intacte', () => {
  assert.deepEqual(trouve('IBAN [IBAN 1], SIRET [SIRET 12], né le [DATE 3], tél. [TÉLÉPHONE 2]'), []);
});

test('chevauchements entre règles : la détection la plus longue l’emporte', () => {
  assert.deepEqual(categories('SIRET 732 829 320 00074'), ['SIRET']);
  assert.deepEqual(categories('IBAN FR76 3000 6000 0112 3456 7890 189'), ['IBAN']);
  assert.deepEqual(categories('voir https://exemple.test/dossier/123456789'), ['URL']);
  assert.deepEqual(categories('écrire à 0612345678@exemple.test'), ['COURRIEL']);
});

test('texte d’essai complet : relevé attendu, rien d’autre', () => {
  const texte = fs.readFileSync(path.join(__dirname, 'fixtures', 'proces-verbal-fictif.txt'), 'utf8');
  const releve = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'proces-verbal-fictif.attendu.json'), 'utf8'));
  assert.deepEqual(trouve(texte), releve);
});

test('immatriculation : un mot courant suivi d’un nombre reste du texte', () => {
  assert.deepEqual(trouve('LE 150 CV ÉTAIT NEUF'), []);
  assert.deepEqual(trouve('DE 100 ML'), []);
});

test('date : premier jour d’une période (« du 1er au 15 janvier 2024 »)', () => {
  assert.deepEqual(trouve('du 1er au 15 janvier 2024'), [['DATE', '1er'], ['DATE', '15 janvier 2024']]);
  assert.deepEqual(trouve('les 3 et 5 mars'), [['DATE', '3'], ['DATE', '5 mars']]);
  assert.equal(detecter('du 3 au 15 janvier 2024')[0].cle, 'DATE:2024-01-03');
  assert.deepEqual(trouve('les articles 3 et 4 du code'), []);
});
