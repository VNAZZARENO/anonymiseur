'use strict';
// Fabrique des fichiers .docx minimaux pour les tests, avec des contenus inventés.
const zip = require('../../public/zip.js');

const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const EN_TETE = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const octets = (texte) => new TextEncoder().encode(texte);
const texte = (donnees) => new TextDecoder().decode(donnees);

const p = (...segments) => '<w:p>' + segments.map((s) => (s.startsWith('<') ? s : r(s))).join('') + '</w:p>';
const r = (contenu, proprietes = '') => '<w:r>' + (proprietes ? '<w:rPr>' + proprietes + '</w:rPr>' : '') + '<w:t>' + contenu + '</w:t></w:r>';

function partieW(racine, corps) {
  return EN_TETE + '<w:' + racine + ' xmlns:w="' + NS_W + '" xmlns:r="' + NS_R + '">' + corps + '</w:' + racine + '>';
}

function relations(liste) {
  return (
    EN_TETE +
    '<Relationships xmlns="' + NS_REL + '">' +
    liste.map((rel, i) => '<Relationship Id="rId' + (i + 1) + '" Type="' + rel.type + '" Target="' + rel.cible + '"' + (rel.externe ? ' TargetMode="External"' : '') + '/>').join('') +
    '</Relationships>'
  );
}

const TYPE = {
  document: NS_R + '/officeDocument',
  coeur: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
  application: NS_R + '/extended-properties',
  personnalisees: NS_R + '/custom-properties',
  vignette: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail',
  lien: NS_R + '/hyperlink',
  enTete: NS_R + '/header',
  pied: NS_R + '/footer',
  notes: NS_R + '/footnotes',
  notesDeFin: NS_R + '/endnotes',
  image: NS_R + '/image',
  modele: NS_R + '/attachedTemplate',
  reglages: NS_R + '/settings',
  personnes: 'http://schemas.microsoft.com/office/2011/relationships/people',
};

/*
 * corps : XML placé dans <w:body>. options.parties : { 'word/header1.xml': '...' } ajoutées telles quelles.
 * options.relationsRacine / relationsDocument : relations supplémentaires.
 * options.section : élément w:sectPr du corps (références d'en-tête et de pied de page).
 */
async function fabriquer(corps, options = {}) {
  const parties = options.parties || {};
  const surcharges = ['<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'];
  const TYPES_DE_CONTENU = [
    [/^docProps\/custom\.xml$/, 'application/vnd.openxmlformats-officedocument.custom-properties+xml'],
    [/^docProps\/core\.xml$/, 'application/vnd.openxmlformats-package.core-properties+xml'],
    [/^docProps\/app\.xml$/, 'application/vnd.openxmlformats-officedocument.extended-properties+xml'],
    [/^word\/people\.xml$/, 'application/vnd.openxmlformats-officedocument.wordprocessingml.people+xml'],
    [/^word\/header\d*\.xml$/, 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml'],
    [/^word\/footer\d*\.xml$/, 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml'],
    [/^word\/footnotes\.xml$/, 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml'],
    [/^word\/endnotes\.xml$/, 'application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml'],
    [/^word\/settings\.xml$/, 'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml'],
    [/^word\/comments\.xml$/, 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml'],
  ];
  Object.keys(parties).forEach((nom) => {
    TYPES_DE_CONTENU.forEach(([motif, type]) => {
      if (motif.test(nom)) surcharges.push('<Override PartName="/' + nom + '" ContentType="' + type + '"/>');
    });
  });
  const entrees = [
    {
      nom: '[Content_Types].xml',
      donnees: octets(
        EN_TETE +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>' +
          surcharges.join('') +
          '</Types>'
      ),
    },
    { nom: '_rels/.rels', donnees: octets(relations([{ type: TYPE.document, cible: 'word/document.xml' }].concat(options.relationsRacine || []))) },
    { nom: 'word/document.xml', donnees: octets(partieW('document', '<w:body>' + corps + (options.section || '<w:sectPr/>') + '</w:body>')) },
  ];
  if (options.relationsDocument) {
    entrees.push({ nom: 'word/_rels/document.xml.rels', donnees: octets(relations(options.relationsDocument)) });
  }
  Object.keys(parties).forEach((nom) => {
    const contenu = parties[nom];
    entrees.push({ nom, donnees: typeof contenu === 'string' ? octets(contenu) : contenu });
  });
  return zip.ecrire(entrees);
}

async function lirePartie(archive, nom) {
  const entree = (await zip.lire(archive)).find((e) => e.nom === nom);
  return entree ? texte(entree.donnees) : null;
}

module.exports = { fabriquer, lirePartie, partieW, relations, p, r, TYPE, EN_TETE, octets, texte, NS_W };
