# Aide à l'anonymisation

Page statique qui aide un cabinet à préparer un exemple de document (procès-verbal, conclusions, courrier, modèle Word) avant de le déposer sur un espace client. Adresse prévue : `anonymiseur.nazzareno.fr`. Éditeur : Nazzareno Systems (Vincent Nazzareno, entreprise individuelle), nazzareno.fr.

Deux promesses, toutes deux vérifiables :

1. **Le document reste dans le navigateur.** Tout le traitement est en JavaScript côté client. La page n'émet aucune requête après son chargement, ne pose aucun cookie, n'écrit rien sur le poste et ne mesure aucune audience.
2. **Aucun modèle de langage.** Des règles lisibles, dans ce dépôt, que le cabinet ou son conseil peut relire.

L'outil est une aide. La qualification d'« exemple anonymisé » et la décision de dépôt appartiennent au cabinet, qui relit chaque document en entier.

## Ce que fait l'outil

| Entrée | Sortie |
|---|---|
| Texte collé | texte à copier, fichier `.txt` |
| Fichier `.txt` | fichier `.txt` |
| Fichier Word `.docx` | fichier `.docx` de même mise en forme |

Le fichier produit reçoit un nom neutre (`exemple-anonymise-1.docx`). Les fichiers `.doc`, `.xls`, `.xlsx` se convertissent en `.docx` depuis Word ou se collent en texte. Le PDF est prévu pour une version ultérieure ; un scan demande une reconnaissance de caractères, hors de portée d'un outil à règles.

Le parcours tient en un écran et trois temps :

1. **Préparer** : dépôt ou collage du document, liste des noms à masquer, choix pour les dates (décaler, étiqueter, conserver) et pour les montants (conservés par défaut).
2. **Relire** : texte surligné par catégorie, liste des éléments détectés avec une case par valeur (tout est coché par défaut), ajout d'une expression à masquer partout, panneau « À vérifier » sur ce qui reste.
3. **Exporter** : contrôle de sortie bloquant, cases de relecture obligatoires, téléchargement.

### Règles déterministes

| Catégorie | Motif | Contrôle |
|---|---|---|
| Courriel, adresse web | forme standard ; nom de domaine nu en minuscules | |
| Téléphone | numéros français, `+33` ou `0033`, espaces, points, tirets | 10 chiffres utiles |
| IBAN | `FR76…` et autres pays | clé modulo 97, longueur du pays |
| Numéro de sécurité sociale | 13 caractères et clé (Corse comprise) | clé modulo 97 |
| SIREN, SIRET | 9 ou 14 chiffres | clé de Luhn |
| Immatriculation | `AA-123-AA`, ancien format `1234 AB 75` | |
| Date | `12/03/2024`, `12.03.2024`, `2024-03-12`, `12 mars 2024`, `mars 2024`, `12 mars`, « né en 1980 », « du 3 au 15 mars » | date du calendrier |
| Montant | nombre suivi de `€`, `euros`, `EUR`, « millions d'euros » | |
| Adresse postale | numéro, type de voie, nom, code postal et commune ; code postal et commune seuls | département du code postal |
| Numéro de rôle | après `RG`, `Portalis`, `parquet` | |
| Numéro long | au moins six chiffres d'affilée, ou trois groupes de chiffres séparés par une espace | |

### Noms propres

- **Liste fournie par l'utilisateur** : chaque terme est recherché en toute casse, sans accents, nom seul et prénom seul, tirets et espaces équivalents. Le nom complet et le nom seul partagent la même étiquette.
- **Suggestions** : mots qui suivent une civilité ou un titre, suites de mots à majuscule initiale en milieu de phrase, mots en majuscules d'au moins trois lettres hors d'un lexique juridique, mots qui suivent « né à », « demeurant », « représenté par ». Une valeur suggérée est ensuite recherchée dans tout le document sous sa forme à majuscule, début de phrase compris.

### Remplacement

- **Étiquettes stables** : `[NOM 1]`, `[IBAN 1]`… La même valeur garde son étiquette dans tout le document et dans tous les documents de la session.
- **Dates** : décalées d'un même nombre de jours tiré au hasard pour la session (30 à 365, dans un sens ou l'autre), écrites dans leur forme d'origine. Autres modes : étiquette `[DATE 1]`, conservation.
- **Montants** : conservés par défaut, masquables.
- **Table de correspondance** : en mémoire seulement, effacée à la fermeture ou au rechargement de la page. Aucun export.

### Fichiers Word

- Lecture et écriture de l'archive ZIP sans bibliothèque (`DecompressionStream`, `CompressionStream`, CRC-32 calculé en JavaScript). L'archive produite porte une date fixe (1er janvier 1980).
- Parties traitées : corps, en-têtes, pieds de page, notes de bas de page et de fin, zones de texte, codes de champ, infobulles de liens, cibles des liens externes (`mailto:`, adresses web). Une cible qui contient une donnée à masquer devient `about:blank`.
- Texte coupé entre plusieurs segments `w:r` : le texte du paragraphe est reconstitué, le remplacement s'écrit dans le premier segment touché, le texte couvert est retiré des suivants.
- Métadonnées : `docProps/core.xml` et `docProps/app.xml` vidés ; `docProps/custom.xml`, la vignette de première page et la liste des auteurs (`word/people.xml`) retirés ; chemin du modèle attaché neutralisé ; nom, titre et description des images neutralisés.
- Refus avec la marche à suivre dans Word : commentaires, modifications suivies, données XML liées (`customXml/`).
- Images comptées et signalées, laissées telles quelles ; une case « J'ai vérifié les N images » est exigée avant l'export.

## Arbitrages de détection

Principe : un masquage de trop coûte un peu de lisibilité, un oubli coûte la confidentialité. Trois exceptions gardent le texte juridique utilisable :

- **Numéros d'article et de texte** (`article 1240`, `L. 211-1`, `R. 4127-28`, `loi n° 85-677`, `règlement (UE) 2016/679`, pourvoi `n° 19-12.345`) : laissés. La règle des numéros longs demande six chiffres d'affilée ou trois groupes séparés par une espace.
- **Dates des textes de loi et des décisions citées** (« loi du 5 juillet 1985 », « Cass. civ. 2e, 12 mars 2020 ») : laissées, pour que la référence reste exacte. Une décision de l'affaire elle-même (« par ordonnance du 10 février 2016 », « CA Paris, 12 mars 2020 ») suit la règle commune : sa date est traitée.
- **Juridictions** : la commune qui suit « Cour d'appel de », « Tribunal judiciaire de », « Barreau de »… reste dans le texte et apparaît dans « À vérifier ».

Faux positifs connus, à décocher : numéro d'une décision du Conseil d'État à six chiffres (`n° 418142`), identifiants ECLI et NOR, un intitulé en capitales absent du lexique, un mot courant écrit avec une majuscule en milieu de phrase, une suite « mot de deux lettres, trois chiffres, deux lettres » en capitales lue comme une immatriculation, une suite de neuf chiffres lue comme un SIREN quand sa clé de Luhn tombe juste.

Faux négatifs connus, à traiter par la liste de noms ou à la main : nom en début de phrase jamais repris ailleurs, nom sans majuscule, nom qui est aussi un mot courant, initiales, surnom, IBAN écrit en minuscules, numéro de moins de six chiffres (numéro de rôle sans la mention `RG`), numéro de téléphone étranger, adresse sans numéro de voie, date sans mois (« en 2019 »), période dont le premier jour change de mois après décalage (« du 28 au 9 juin »).

## Limites

- **Les noms.** Les règles reconnaissent une forme et ignorent le sens. La liste fournie par l'utilisateur est le moyen le plus sûr.
- **L'identification indirecte.** Une profession, une commune, une date d'accident, une blessure rare ou un fait relaté par la presse suffisent parfois à reconnaître une personne. Aucune règle ne le voit ; le remède est humain.
- **Les dates et les montants.** Décalés ou conservés, ils restent des indices quand on les combine.
- **Ce que l'outil laisse intact.** Images, tampons, signatures, écriture manuscrite, objets incorporés (feuille de calcul d'un graphique), réglages de publipostage, zones de texte de formes inhabituelles.
- **La portée juridique.** Le résultat est au mieux une pseudonymisation soignée.

## Vérifier la promesse

- **Réseau coupé** : charger la page, couper le Wi-Fi ou débrancher le câble, traiter un document en entier, télécharger le résultat.
- **Onglet « Réseau »** : outils du navigateur (F12), onglet « Réseau », traiter un document ; la liste reste vide après le chargement.
- **Lecture du code** : `tests/page.test.js` vérifie à chaque exécution que `public/` ne contient ni `fetch`, ni `XMLHttpRequest`, ni `WebSocket`, ni `sendBeacon`, ni `EventSource`, ni stockage local, ni cookie, ni service worker, ni import dynamique, ni adresse externe (hormis le lien vers ce dépôt en pied de page), ni script en ligne.
- **CSP** : `default-src 'none'`, `connect-src 'none'`, `form-action 'none'`, en en-tête HTTP (bloc Caddy) et en balise `<meta>` (elle suit la page enregistrée sur le poste). La directive `frame-ancestors` vit dans l'en-tête seul : un navigateur l'ignore dans une balise `<meta>` et l'écrit dans sa console.

## Usage local

Télécharger le dépôt, puis ouvrir `public/index.html` depuis le disque : scripts classiques, chemins relatifs, aucun serveur requis.

Pour servir la page en local :

```
python3 -m http.server 8765 --bind 127.0.0.1 --directory public
```

## Arborescence

```
public/
  index.html        page unique
  favicon.ico       icône de 16 points (évite une demande sans réponse au chargement)
  app.css           feuille de style, polices du système
  app.js            interface : saisies, affichage, téléchargement
  detecteurs.js     règles déterministes et contrôles (modulo 97, Luhn, calendrier)
  noms.js           liste de l'utilisateur, variantes, suggestions, lexique juridique
  remplacement.js   assemblage des détections, étiquettes de session, décalage des dates
  zip.js            archives ZIP : lecture, écriture, CRC-32
  docx.js           fichiers Word : blocs de texte, réécriture du XML, métadonnées, refus
  sortie.js         contrôle de sortie, nom du fichier produit, panneau « À vérifier »
tests/
  *.test.js         tests lancés par node --test
  aides/            fabrique de fichiers .docx minimaux pour les tests
  fixtures/         textes inventés pour les tests
  navigateur/       parcours complet dans Chrome sans tête (recette)
Caddyfile.anonymiseur
```

Aucune dépendance : ni paquet, ni étape de construction.

## Tests

```
node --test
```

Node 20 ou plus récent ; les tests appellent `zip` et `unzip` du système. Tous les noms, numéros et documents des tests sont inventés.

Parcours complet dans un navigateur réel (Chrome ou Chromium installé, aucun paquet à ajouter) :

```
node tests/navigateur/parcours.mjs
```

Ce script sert `public/`, pilote Chrome sans tête, joue le parcours avec un `.docx` fabriqué, vérifie qu'aucune requête ne part après le chargement, que la console reste vide, puis rouvre le fichier téléchargé.

## Déploiement

Hébergement : VPS partagé, Caddy `file_server`. Aucun processus, aucun port, aucune unité systemd : le sous-domaine ajoute des fichiers et un bloc.

1. **DNS.** Enregistrement **A** `anonymiseur` dans la zone `nazzareno.fr` (OVH) vers l'IPv4 du VPS, TTL 300 pendant la mise en service, aucun AAAA, aucun enregistrement générique `*`.
2. **Fichiers.** Utilisateur système `suite` sans shell ; arbre `/srv/suite/anonymiseur/public` lisible par l'utilisateur `caddy`. Déploiement par `git pull --ff-only` du dépôt public, puis copie du dossier `public/`.
3. **Caddy.** Après propagation du DNS, ajouter le contenu de `Caddyfile.anonymiseur` à `/etc/caddy/Caddyfile` **et** à `/etc/caddy/Caddyfile.findelaprune`.
4. **Rechargement.** `sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy`. Une erreur de syntaxe bloque le rechargement des sites déjà servis : valider d'abord.
5. **Recette.**
   - HTTPS actif, redirection de `http` vers `https` ;
   - `curl -sI https://anonymiseur.nazzareno.fr/` montre la CSP, HSTS, `nosniff`, `no-referrer`, `Cache-Control: no-cache` ;
   - onglet « Réseau » vide après chargement pendant un traitement complet ;
   - traitement réussi réseau coupé ;
   - ouverture de `public/index.html` depuis le disque ;
   - un `.docx` produit s'ouvre dans Word et dans LibreOffice sans avertissement ;
   - service et `/sante` de findelaprune et de l'espace inchangés.

À faire en dehors de ce dépôt : paragraphe sur l'outil dans la politique de confidentialité de la vitrine, lien depuis l'espace client, ligne dans le registre de la suite.
