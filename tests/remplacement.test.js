'use strict';
// Étiquettes stables, chevauchements, décalage des dates. Valeurs inventées pour les tests.
const test = require('node:test');
const assert = require('node:assert/strict');

const r = require('../public/remplacement.js');

const OPTIONS = { modeDates: 'decaler', masquerMontants: false };

// Enchaîne analyse, choix par défaut et remplacement sur un texte seul.
function traiter(texte, { termes = [], session = r.creerSession({ alea: () => 0.5 }), options = OPTIONS, coches = new Map() } = {}) {
  const [candidats] = r.analyser([texte], termes);
  return r.remplacer(texte, candidats, session, options, coches).texte;
}

function sessionDecalee(jours) {
  const session = r.creerSession({ alea: () => 0.5 });
  session.decalage = jours;
  return session;
}

test('même valeur, même étiquette dans deux documents de la session', () => {
  const session = r.creerSession({ alea: () => 0.5 });
  const un = traiter('Écrire à zebulon@exemple.test puis à cunegonde@exemple.test.', { session });
  const deux = traiter('Réponse de cunegonde@exemple.test, copie à ZEBULON@exemple.test.', { session });
  assert.equal(un, 'Écrire à [COURRIEL 1] puis à [COURRIEL 2].');
  assert.equal(deux, 'Réponse de [COURRIEL 2], copie à [COURRIEL 1].');
});

test('deux valeurs, deux étiquettes ; une numérotation par catégorie', () => {
  const sortie = traiter('Véhicules AB-123-CD et EF-456-GH, puis AB 123 CD ; IBAN FR76 3000 6000 0112 3456 7890 189.');
  assert.equal(sortie, 'Véhicules [IMMATRICULATION 1] et [IMMATRICULATION 2], puis [IMMATRICULATION 1] ; IBAN [IBAN 1].');
});

test('une nouvelle session repart de 1', () => {
  assert.equal(traiter('tél. 01 23 45 67 89'), 'tél. [TÉLÉPHONE 1]');
  assert.equal(traiter('tél. 06 12 34 56 78'), 'tél. [TÉLÉPHONE 1]');
});

test('nom complet et nom seul : la même étiquette pour la même personne', () => {
  const sortie = traiter('Zébulon Tartempion conteste. M. Tartempion ajoute que Cunégonde Fictive était présente.', {
    termes: ['Zébulon Tartempion', 'Cunégonde Fictive'],
  });
  assert.equal(sortie, '[NOM 1] conteste. M. [NOM 1] ajoute que [NOM 2] était présente.');
});

test('chevauchement : un courriel qui contient un nom est résolu par la détection la plus longue', () => {
  const sortie = traiter('Écrire à zebulon.tartempion@exemple.test, merci.', { termes: ['Zébulon Tartempion'] });
  assert.equal(sortie, 'Écrire à [COURRIEL 1], merci.');
});

test('chevauchement : une suggestion contenue dans une adresse disparaît derrière elle', () => {
  const sortie = traiter('il demeure 12 rue des Lilas, 69003 Lyon, depuis peu');
  assert.equal(sortie, 'il demeure [ADRESSE 1], depuis peu');
});

test('décocher une détection longue fait reparaître le terme de la liste qu’elle contenait', () => {
  const texte = 'Écrire à zebulon.tartempion@exemple.test, merci.';
  const [candidats] = r.analyser([texte], ['Tartempion']);
  const coches = new Map([['COURRIEL:zebulon.tartempion@exemple.test', false]]);
  const sortie = r.remplacer(texte, candidats, r.creerSession({ alea: () => 0.5 }), OPTIONS, coches).texte;
  assert.equal(sortie, 'Écrire à zebulon.[NOM 1]@exemple.test, merci.');
});

test('chevauchement partiel : le reste d’un nom évincé est masqué aussi', () => {
  const actives = r.resoudre(
    [
      { debut: 0, fin: 11, categorie: 'ADRESSE', valeur: '75008 Paris', cle: 'ADRESSE:75008 paris' },
      { debut: 6, fin: 16, categorie: 'NOM', valeur: 'Paris Jean', cle: 'NOM:paris jean', entite: 'NOM:paris jean', source: 'suggestion' },
    ],
    () => true
  ).actives;
  assert.deepEqual(actives.map((d) => [d.debut, d.fin, d.categorie]), [[0, 11, 'ADRESSE'], [12, 16, 'NOM']]);
});

test('suggestions cochées par défaut, et recherchées partout, début de phrase compris', () => {
  const blocs = ['Nous entendons Monsieur Zébulon TARTEMPION.', 'Tartempion conteste les faits.'];
  const candidats = r.analyser(blocs, []);
  const session = r.creerSession({ alea: () => 0.5 });
  assert.equal(r.remplacer(blocs[0], candidats[0], session, OPTIONS, new Map()).texte, 'Nous entendons Monsieur [NOM 1].');
  assert.equal(r.remplacer(blocs[1], candidats[1], session, OPTIONS, new Map()).texte, '[NOM 1] conteste les faits.');
});

test('une suggestion décochée reste dans le texte', () => {
  const texte = 'devant le témoin Cunégonde Fictive, présente';
  const [candidats] = r.analyser([texte], []);
  const coches = new Map([['NOM:cunegonde fictive', false], ['NOM:cunegonde fictive#cunegonde', false], ['NOM:cunegonde fictive#fictive', false]]);
  assert.equal(r.remplacer(texte, candidats, r.creerSession({ alea: () => 0.5 }), OPTIONS, coches).texte, texte);
});

test('montants : conservés par défaut, masqués sur option', () => {
  const texte = 'La somme de 1 500 € puis 1 500 € et 300 euros.';
  assert.equal(traiter(texte), texte);
  assert.equal(traiter(texte, { options: { modeDates: 'decaler', masquerMontants: true } }), 'La somme de [MONTANT 1] puis [MONTANT 1] et [MONTANT 2].');
});

test('tirage du décalage : entre 30 et 365 jours, dans un sens ou l’autre', () => {
  const suites = [[0, 0], [0.999999, 0.999999], [0.5, 0.2], [0.5, 0.8]];
  const valeurs = suites.map((suite) => {
    let i = 0;
    return r.creerSession({ alea: () => suite[i++ % suite.length] }).decalage;
  });
  for (const v of valeurs) assert.ok(Math.abs(v) >= 30 && Math.abs(v) <= 365 && Number.isInteger(v), 'décalage ' + v);
  assert.ok(valeurs.some((v) => v < 0) && valeurs.some((v) => v > 0));
  assert.equal(Math.min(...valeurs.map(Math.abs)), 30);
  assert.equal(Math.max(...valeurs.map(Math.abs)), 365);
});

test('décalage des dates : même écart pour toutes, intervalle conservé', () => {
  const session = sessionDecalee(40);
  const sortie = traiter('Accident le 02/03/2024, expertise le 12/03/2024.', { session });
  assert.equal(sortie, 'Accident le 11/04/2024, expertise le 21/04/2024.');
});

test('décalage des dates : format d’origine conservé', () => {
  const session = sessionDecalee(40);
  assert.equal(traiter('le 2/3/24', { session }), 'le 11/4/24');
  assert.equal(traiter('le 02.03.2024', { session }), 'le 11.04.2024');
  assert.equal(traiter('le 2024-03-02', { session }), 'le 2024-04-11');
  assert.equal(traiter('le 2 mars 2024', { session }), 'le 11 avril 2024');
  assert.equal(traiter('LE 2 MARS 2024', { session }), 'LE 11 AVRIL 2024');
  assert.equal(traiter('le 2 Mars 2024', { session }), 'le 11 Avril 2024');
  assert.equal(traiter('le 5 déc. 2022', { session }), 'le 14 janv. 2023');
  assert.equal(traiter('en mars 2024', { session }), 'en avril 2024');
  assert.equal(traiter('survenu le 2 mars vers midi', { session }), 'survenu le 11 avril vers midi');
  assert.equal(traiter('du 2 au 12 mars 2024', { session }), 'du 11 au 21 avril 2024');
});

test('décalage des dates : premier du mois écrit « 1er », retour à un chiffre ensuite', () => {
  assert.equal(traiter('le 1er mars 2024', { session: sessionDecalee(31) }), 'le 1er avril 2024');
  assert.equal(traiter('le 1er mars 2024', { session: sessionDecalee(40) }), 'le 10 avril 2024');
  assert.equal(traiter('le 20 février 2024', { session: sessionDecalee(40) }), 'le 31 mars 2024');
});

test('décalage des dates : passage d’année et année bissextile gérés', () => {
  assert.equal(traiter('le 20/12/2024', { session: sessionDecalee(30) }), 'le 19/01/2025');
  assert.equal(traiter('le 15/01/2024', { session: sessionDecalee(-30) }), 'le 16/12/2023');
  assert.equal(traiter('le 30/01/2024', { session: sessionDecalee(30) }), 'le 29/02/2024');
  assert.equal(traiter('le 30/01/2023', { session: sessionDecalee(30) }), 'le 01/03/2023');
  assert.equal(traiter('le 31/12/99', { session: sessionDecalee(30) }), 'le 30/01/00');
});

test('décalage des dates : le même écart dans tous les documents de la session', () => {
  const session = sessionDecalee(-45);
  assert.equal(traiter('le 20/03/2024', { session }), 'le 04/02/2024');
  assert.equal(traiter('le 21/03/2024', { session }), 'le 05/02/2024');
});

test('dates en mode étiquette : la même date reçoit la même étiquette quelle que soit sa graphie', () => {
  const sortie = traiter('Le 12/03/2024, puis le 12 mars 2024, puis le 13 mars 2024.', { options: { modeDates: 'etiquette', masquerMontants: false } });
  assert.equal(sortie, 'Le [DATE 1], puis le [DATE 1], puis le [DATE 2].');
});

test('dates en mode conservation : laissées', () => {
  const texte = 'Le 12/03/2024, puis le 12 mars 2024.';
  assert.equal(traiter(texte, { options: { modeDates: 'conserver', masquerMontants: false } }), texte);
});

test('une date d’un texte de loi reste intacte quand les autres sont décalées', () => {
  const sortie = traiter('Accident du 02/03/2024, loi n° 85-677 du 5 juillet 1985.', { session: sessionDecalee(40) });
  assert.equal(sortie, 'Accident du 11/04/2024, loi n° 85-677 du 5 juillet 1985.');
});

test('le plan de remplacement décrit chaque substitution', () => {
  const texte = 'tél. 01 23 45 67 89';
  const [candidats] = r.analyser([texte], []);
  const { plan } = r.remplacer(texte, candidats, r.creerSession({ alea: () => 0.5 }), OPTIONS, new Map());
  assert.deepEqual(plan.map((p) => [p.debut, p.fin, p.nouveau]), [[5, 19, '[TÉLÉPHONE 1]']]);
});

test('la session retient les dates produites, pour le contrôle de sortie', () => {
  const session = sessionDecalee(40);
  traiter('le 02/03/2024 et en mars 2024', { session });
  assert.ok(session.datesProduites.has('DATE:2024-04-11'));
  assert.ok(session.datesProduites.has('DATE:2024-04'));
});

test('bloc technique (code de champ, cible de lien) : règles et liste appliquées, sans suggestion de nom', () => {
  const blocs = [{ texte: ' HYPERLINK "mailto:zebulon@exemple.test" \\o "Tartempion" ', technique: true }, { texte: 'Texte courant.', technique: false }];
  const candidats = r.analyser(blocs, ['Tartempion']);
  assert.deepEqual(candidats[0].map((d) => [d.categorie, d.valeur]), [['COURRIEL', 'zebulon@exemple.test'], ['NOM', 'Tartempion']]);
});

test('un mot pris dans une adresse reste hors des suggestions recherchées ailleurs', () => {
  const blocs = ['Il demeure 12 rue des Lilas, 69003 Lyon.', 'Lilas en fleurs devant le Tribunal judiciaire de Lyon.'];
  const candidats = r.analyser(blocs, []);
  const session = r.creerSession({ alea: () => 0.5 });
  assert.equal(r.remplacer(blocs[0], candidats[0], session, OPTIONS, new Map()).texte, 'Il demeure [ADRESSE 1].');
  assert.equal(r.remplacer(blocs[1], candidats[1], session, OPTIONS, new Map()).texte, blocs[1]);
});
