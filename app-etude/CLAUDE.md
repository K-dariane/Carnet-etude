# App d'étude

## Objectif
- **But** : une app qui m'aide pendant tout mon parcours universitaire et qui fonctionne dans toutes les situations (téléphone surtout, mais aussi tous les appareils).
- **Public** : d'abord moi (usage personnel). Ensuite, d'autres étudiants, avec une version payante (RDC, Kinshasa, paiement mobile money).
- **Matières** : toutes les matières de mon cursus, liste à préciser. Les tests ont surtout porté sur les mathématiques.
- **Principe** : je crée un projet d'étude (étude accompagnée, révision, exercices, aide aux devoirs, quiz, préparation d'examen), je fournis mes supports (PDF, photos, notes) et l'IA m'accompagne avec des explications claires, concises et illustrées.

## Instructions du projet
- **Instructions personnalisées du projet claude.ai** : aucune n'est définie.
- **Description du projet** (mot pour mot) : « je veux que cette app puisse m'aider tout au long de mon parkour universitaire et qu'elle puisse être utilisable dans tout le situations »
- **Ma façon de travailler** :
  - Langue : français, partout (réponses, interface, commentaires utiles).
  - Ton : direct, simple, tutoiement.
  - Format : réponses concises et factuelles ; listes ou tableaux quand ça aide ; pas de remplissage.
  - Si une information manque, l'écrire (« à préciser ») au lieu de l'inventer.

## Fichiers et ressources
La base de connaissances du projet claude.ai est vide. Ressources existantes :
- `carnet/index.html` : tout le code de la V1 « Carnet d'étude » (un seul fichier HTML, CSS et JS). C'est la source de l'artifact publié.
- `test/mock.js`, `test/mock_guest.js`, `test/mock_nosample.js` : faux environnement Claude (base de données, IA, fichiers) pour tester sans claude.ai. `mock_guest.js` simule un testeur sans droit d'écriture ; `mock_nosample.js` un testeur sans accès à Claude.
- `test/run.js`, `test/run_guest.js`, `test/run_copy.js` : tests de bout en bout Playwright (propriétaire, testeur, mode copie).
- `web/` : version web autonome (Supabase) pour les testeurs, sans compte Claude. En cours, voir `web/README.md`.
  - `web/supabase/migrations/` : schéma de la base et règles d'accès.
  - `web/supabase/functions/chat/` et `_shared/chat.ts` : fonction serveur IA (clé Claude en secret, Haiku / Sonnet, streaming, quota).
  - `web/import/import.mjs` : import des projets de l'artifact (génère un script SQL).
  - `web/import/televerser.mjs` : copie des photos et PDF de l'artifact vers Supabase Storage.
  - `web/app/index.html` : l'app web (copie de la V1, mêmes `RULES` et `TYPES`) ; `web/app/backend.js` : branchement Supabase (base, IA, fichiers, connexion) ; `web/app/config.js` : configuration publique (projet Supabase `xyrlifukufcntwinrtvz`).
  - Une modification de la V1 (`carnet/index.html`) n'est pas reportée automatiquement dans `web/app/index.html`.
  - `web/test/` : tests (`npm install` puis `npm test` dans `web/` ; Postgres local, fausse API Claude, Deno).
- `couts/modele.py` : modèle de coûts (IA par séance et par étudiant, coûts fixes, scénarios de prix).
- Artifact « Carnet d'étude » : https://claude.ai/artifact/Mr8uMTEjFs1su6snCTDPhr (slug `a8d3168d-afef-460f-a726-8c73c818a0f9`), partagé publiquement.
- Doc « Partie administrative du Carnet d'étude » : https://claude.ai/artifact/U2M9uAi6h4yvGYB5J8hPiS (statut juridique RDC, fiscalité, paiements, textes juridiques, règles Anthropic, back-office, checklist de lancement).

## État d'avancement
**Fait et fonctionnel (V1, artifact claude.ai) :**
- Projets : création et modification (titre, type, matière, objectif, échéance), accueil avec progression.
- 7 types de projet : étude accompagnée, révision, exercices, aide aux devoirs, quiz et QCM, préparation d'examen, autre. Chaque type a ses instructions et ses raccourcis.
- Supports : extraction du texte des PDF (pdf.js) ; PDF scannés et photos transcrits par Claude (10 pages max pour un scan) ; notes écrites ; activer ou désactiver un support par séance.
- Séance : conversation avec Claude, réponse affichée au fil de l'écriture, Markdown, formules (MathJax), schémas SVG, photo jointe, « mode approfondi » (modèle le plus puissant), effacement de la conversation.
- Plan : généré par Claude ou ajouté à la main, étapes à cocher, progression affichée.
- « Faire évoluer » un projet (changement de type, historique conservé) et « sous-projets » ciblés sur une facette (copie des supports, résumé de la séance transmis).
- Stockage : base de données de l'artifact pour le propriétaire ; « mode test » dans le navigateur (IndexedDB) pour les visiteurs sans droit d'écriture.
- « Mode copie » pour les visiteurs sans accès à Claude (lien public, droit « Peut consulter ») : le carnet prépare la demande (consignes, type de séance, supports, échanges récents), le testeur la colle dans Claude, puis peut recoller la réponse dans sa séance.
- Tests automatisés (Playwright + faux environnement) : tous réussis.

**Problèmes connus et en cours :**
- Les testeurs doivent se connecter à un compte Claude (18 ans et plus). Les séances utilisent leur propre quota.
- Confirmé par une capture d'écran d'un testeur : avec le lien public (« Peut consulter »), Claude n'est pas accessible depuis le carnet, ni dans l'app Claude ni dans Safari. Le mode copie contourne ce blocage ; il n'a pas encore été testé par un vrai testeur.
- Erreurs réseau chez certains testeurs (« serveur introuvable », page noire). Cause probable : forfaits limités à WhatsApp ou connexion lente. Non résolu.
- En mode test, je ne vois pas les données de mes testeurs.

## Décisions prises
| Décision | Raison |
| --- | --- |
| Application web installable (PWA) plutôt qu'app native | Un seul code pour tous les appareils, mises à jour immédiates sans store, photos et PDF accessibles. Le hors-ligne n'est pas nécessaire. |
| V1 construite comme artifact claude.ai, avec l'IA du compte de l'utilisateur, sans API | Pas de budget pour l'API ; usage personnel d'abord. |
| Version commerciale prévue plus tard : serveur propre et API Claude | Supprime la connexion Claude obligatoire ; nécessaire pour vendre. |
| Pour la version commerciale : surtout Haiku 5.5, Sonnet 5.5 pour les notions difficiles, cache de prompt, contexte sous 100 000 tokens | Coût estimé d'environ 0,10 $ par heure de séance (mélange 70/30). |
| Modèles de la V1 : catégorie « par défaut » (Sonnet) pour les séances, « complexe » (Opus) en mode approfondi | Bon compromis qualité et vitesse. |
| Formules avec MathJax (rendu SVG), pas KaTeX | Les polices de KaTeX ne se chargent pas dans l'artifact. |
| Bibliothèques chargées depuis jsDelivr, versions figées (marked 12.0.2, DOMPurify 3.1.6, MathJax 3.2.2, pdfjs-dist 3.11.174) | Seuls quelques CDN sont autorisés ; versions vérifiées dans npm. |
| Supports copiés (texte) dans les sous-projets, sans lien vers le fichier d'origine | Un sous-projet reste indépendant. |
| Testeurs sans droit d'écriture → stockage local dans leur navigateur | Un lien public ne donne qu'un droit de lecture. |
| **Proposé, non validé** : passes prépayés (semaine, mois, semestre), offre gratuite limitée à Haiku, environ 3 $/mois (5 à 6 $ en intensif), paiement par agrégateur mobile money (FlexPay ou MaxiCash), Supabase en région UE, entreprise individuelle puis SARLU | Voir le doc administratif et `couts/modele.py`. |
| Version web (`web/`) : Haiku 5.5 par défaut, Sonnet 5.5 en mode approfondi (séances, transcriptions, plan) | Validé le 2026-11-02. La V1 garde Sonnet / Opus. |
| Version web : ~~quota de 500 000 tokens par semaine~~ remplacé le 2026-11-08 par un **crédit quotidien de 0,35 $ par utilisateur** calculé sur le coût réel (cache lu peu cher, Sonnet environ 20 fois Haiku), remis à zéro à minuit (Kinshasa) | Validé le 2026-11-08 (option B, 0,35 $) : estimation : environ 89 messages par jour (environ 2h40 intense) avec 10 % en mode approfondi ; 210 à 300 messages avec Haiku seul ; 10 à 15 en mode approfondi seul ; au plus environ 10,50 $ par utilisateur et par mois. Prix dans `TARIFS` (chat.ts) et `ia_cout()` (SQL). |
| Version web : appel à Claude via une Edge Function Supabase, clé API en secret côté serveur | La clé n'est jamais dans le navigateur. |
| Version web : tables `projets`, `supports`, `fils` ; colonnes pour les champs simples (`parent_id`, `nb_supports`, `asset_id`, `created_at`, `updated_at` en snake_case), JSONB pour `plan`, `evolutions`, `turns` ; règles d'accès par `owner` ; cascade sur supports et fils ; sous-projet gardé si le projet principal est supprimé | Validé le 2026-11-02. Les autres noms de champs restent ceux de la V1. |
| Version web : pas de mode copie ni de mode test local ; connexion par lien e-mail ou Google | Validé le 2026-11-02 : chaque testeur a un compte. |
| Version web : comptes par e-mail et mot de passe (confirmation de l'adresse, mot de passe oublié, code de secours), Google et Facebook (Facebook activable dans Supabase) ; Apple retiré le 2026-11-07 ; profil `profils` (prénom, niveau `primaire`/`secondaire`/`universitaire`, majeur, accord parental obligatoire pour un mineur) | Validé le 2026-11-07. Guides : `web/GUIDE-CONNEXION.md`. |
| Version web : première ligne de `RULES` changée en « Tu es le tuteur personnel d'un élève ou d'un étudiant, dans son « Carnet d'étude ». » ; ligne de niveau ajoutée (`NIVEAUX_IA` dans `web/app/index.html`) ; `TYPES` inchangés | Validé le 2026-11-07. La V1 (`carnet/index.html`) garde ses `RULES`. |
| Version web : voix gratuite du téléphone (`web/app/voix.js`) : dictée 🎤 (reconnaissance vocale du navigateur), écoute 🔊 des réponses (synthèse vocale du téléphone, formules traduites en paroles par `paroles()`), « Mode oral » (question envoyée seule, réponse lue, micro rouvert) ; consigne orale ajoutée seulement en mode oral (`CONSIGNE_ORALE` dans `web/app/index.html`) | Validé le 2026-11-08. Voix payante plus naturelle possible plus tard. |
| **À faire plus tard** : rendre le dépôt privé (confidentialité du code) après avoir déplacé l'hébergement (Cloudflare Pages conseillé) | Demandé le 2026-11-04, pas pour tout de suite. |
| **Écartés pour l'instant** : app native et stores, mode hors-ligne, stockage principal en localStorage | Pas nécessaires, ou peu fiables. |

## Reste à faire
1. **Tests en cours** : vérifier que les séances marchent pour les testeurs et recueillir leurs avis (un bouton « Donner mon avis » a été proposé).
2. **Rappels de révision à heure précise et notifications d'avancement** : demandés dès le départ, pas encore faits. Prévus via des tâches programmées dans Claude (V1), puis Web Push (version commerciale).
3. **Version commerciale** : serveur, API Claude, connexion par numéro de téléphone, quotas par offre, paiement mobile money, page légère qui se charge vite.
4. **Back-office V1** : tableau de bord, utilisateurs, paiements, quotas et coûts IA, offres et prix, exports comptables.
5. **Administratif** : immatriculation, compte bancaire pro, agrégateur, compte Claude Console de l'entreprise, déclaration des données (ARPTC).
6. **Textes** : CGU, CGV et politique de confidentialité, à faire relire par un juriste.
7. À préciser : nom définitif de l'app, liste des matières, prix final.

## Règles pour Claude Code
- **Langue** : tout texte visible par l'utilisateur est en français et tutoie l'utilisateur. Messages d'erreur : dire ce qui s'est passé et quoi faire.
- **Nommage** :
  - JS en camelCase.
  - Champs de données en français, à garder tels quels : `titre`, `type`, `matiere`, `objectif`, `echeance`, `plan` (`id`, `titre`, `detail`, `fait`), `nbSupports`, `parentId`, `focus`, `evolutions`, `createdAt`, `updatedAt`.
  - Supports : `nom`, `kind` (`pdf` | `image` | `note`), `texte`, `actif`, `url`, `assetId`.
  - Conversation : `fil/principal` avec `turns` (`role` : `user` | `assistant` | `event`).
- **Organisation** :
  - La V1 reste un seul fichier `carnet/index.html` : style en haut avec les couleurs dans `:root` (thèmes clair et sombre), puis le script.
  - Pas de framework, JS natif en `"use strict"`.
  - Tests dans `test/`.
- **Style de code** :
  - Échapper tout texte utilisateur avec `esc()` avant `innerHTML`.
  - Nettoyer le HTML produit par l'IA avec DOMPurify.
  - Une seule écriture à la fois par document, via `write()`.
  - Versions des bibliothèques figées.
  - Lancer les tests après chaque modification (`npm test` dans `test/` : `run.js`, `run_guest.js`, `run_copy.js`).
- **Ne pas modifier sans me demander** :
  - Les chemins et la structure des données (`data/users/<uid>/carnet/projets/...` ; en mode test : `local/carnet/projets/...`). Sinon, mes projets existants sont perdus.
  - Les capacités déclarées de l'artifact (`db`, `user`, `sample` avec images, `assets`).
  - Les instructions envoyées à Claude (`RULES` et le `mode` de chaque type dans `TYPES`).
  - Le choix des modèles et des tiers.
  - Les prix et les quotas.
  - Toute suppression de données.
  - La republication de l'artifact public.
- **Secrets** : aucune clé API dans le code côté navigateur ; dans la version commerciale, les clés restent sur le serveur.
