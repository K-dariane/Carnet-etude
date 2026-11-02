# Carnet d'étude — version web (Supabase)

App web autonome pour les testeurs, sans compte Claude. En cours de construction, étape par étape.

Projet Supabase : `https://xyrlifukufcntwinrtvz.supabase.co` (référence `xyrlifukufcntwinrtvz`). Configuration publique de l'app : `app/config.js`.
La V1 (`../carnet/index.html`, artifact claude.ai) n'est pas modifiée.

| Étape | État |
| --- | --- |
| Schéma de la base, règles d'accès, import | Fait, testé |
| Fonction serveur IA (Haiku / Sonnet, streaming) | Fait, testé (fausse API Claude) |
| Quota : 500 000 tokens par testeur et par semaine | Fait, testé |
| Fichiers (Supabase Storage) et copie des fichiers de l'artifact | Fait, testé ; copie à lancer |
| Connexion (lien e-mail, code, Google) | Fait, testé (faux Supabase) |
| Branchement de l'app | Fait, testé (faux Supabase) ; à mettre en ligne |

## L'app (`app/`)

| Fichier | Rôle |
| --- | --- |
| `app/index.html` | Copie de la V1 avec 5 changements seulement : chargement de Supabase, champ e-mail, messages d'erreur du serveur, plus de mode test local, bouton « Se déconnecter ». Les consignes envoyées à Claude (`RULES`, `TYPES`) sont identiques. |
| `app/backend.js` | Fournit à l'app les mêmes services que l'artifact (`db`, `user`, `sample`, `assets`), branchés sur Supabase. Les chemins de la V1 (`data/users/<uid>/carnet/projets/…`) sont traduits vers les tables. |
| `app/config.js` | Adresse du projet et clé publique (`anon`). |

**Connexion** : au choix, lien reçu par e-mail, code à 6 chiffres reçu dans le même e-mail (utile si le lien s'ouvre dans un autre navigateur), ou Google. La session reste ouverte sur l'appareil.

**Fichiers** : la base garde la référence `storage:supports/<chemin>`. L'app la remplace par un lien temporaire de 24 h pour l'affichage, et refait le lien quand tu reviens sur la page.

**Mise à jour des données** : l'app relit les données après chaque modification et quand tu reviens sur la page. Il n'y a pas de synchronisation en direct entre deux appareils ouverts en même temps.

### Réglages Supabase pour la connexion

1. **Authentication → URL Configuration** :
   - **Site URL** : l'adresse où l'app est en ligne (par exemple `https://carnet.example.com/`).
   - **Redirect URLs** : ajoute cette même adresse.
2. **Authentication → Providers → Email** : activé.
3. **Authentication → Email Templates → Magic Link** : ajoute le code dans le message, par exemple `Ton code : {{ .Token }}`, en plus du lien `{{ .ConfirmationURL }}`.
4. **Authentication → Providers → Google** : identifiant client et secret de Google Cloud. Dans Google Cloud, l'URI de redirection autorisée est `https://xyrlifukufcntwinrtvz.supabase.co/auth/v1/callback`.
5. **`app/config.js`** : contient la clé publique (`sb_publishable_…`). Elle est faite pour être visible.

### Mise en ligne

`app/` est un site statique (3 fichiers). N'importe quel hébergeur statique convient : Cloudflare Pages, Netlify, GitHub Pages. L'adresse obtenue doit être mise dans les réglages de connexion ci-dessus et, si tu veux restreindre l'accès à la fonction, dans le secret `ALLOWED_ORIGINS`.

## Base de données

`supabase/migrations/20261102000001_carnet.sql` crée 3 tables :

| Table | Colonnes | JSON (jsonb) |
| --- | --- | --- |
| `projets` | `id`, `owner`, `titre`, `type`, `matiere`, `objectif`, `echeance` (date), `parent_id`, `focus`, `nb_supports`, `created_at`, `updated_at` | `plan`, `evolutions`, `extra` |
| `supports` | `id`, `owner`, `projet_id`, `nom`, `kind`, `texte`, `actif`, `url`, `asset_id`, `pages`, `tronque`, `herite`, `created_at` | `extra` |
| `fils` | `owner`, `projet_id`, `id` (`principal`), `updated_at` | `turns` |

- Correspondance avec la V1 : `parentId` → `parent_id`, `nbSupports` → `nb_supports`, `assetId` → `asset_id`, `createdAt`/`updatedAt` → `created_at`/`updated_at`. Les autres champs gardent leur nom.
- `extra` garde les champs inconnus de la V1 : rien n'est perdu à l'import.
- Règles d'accès : chaque utilisateur ne voit et ne modifie que ses lignes. Un visiteur non connecté n'a accès à rien.
- Suppressions en cascade : supprimer un projet supprime ses supports et sa conversation. Supprimer un compte supprime toutes ses données. Un sous-projet est **gardé** quand son projet principal est supprimé (comme dans la V1) : il devient autonome.
- Un sous-projet ne peut pointer que vers un projet du même utilisateur.

Installation : Supabase → SQL Editor → coller le contenu du fichier de migration → Run.

## Fonction serveur IA (`supabase/functions/chat`)

L'app n'appelle jamais Claude directement : elle appelle la fonction `chat`, qui garde la clé API en secret.

| Étape | Ce que fait la fonction |
| --- | --- |
| 1 | Vérifie que le testeur est connecté (jeton Supabase). Sinon : `session_expired`. |
| 2 | Vérifie la demande (rôles, tailles, images). Sinon : `requete_invalide`, `prompt_too_large` ou `image_rejected`. |
| 3 | Vérifie le quota de la semaine. S'il est épuisé : `quota_atteint`, avec la date de remise à zéro. |
| 4 | Appelle Claude et renvoie le texte au fil de l'écriture. |
| 5 | Enregistre les tokens consommés dans `ia_appels`, même si la réponse est arrêtée en cours de route. |

**Modèles** (choisis par le serveur, jamais par le navigateur) :

| `tier` envoyé par l'app | Modèle | Effort |
| --- | --- | --- |
| `default` (séances, transcriptions, plan, résumé) | `claude-haiku-5-5` | `medium` |
| `complex` (mode approfondi) | `claude-sonnet-5-5` | `high` |

- **Cache de prompt** : activé automatiquement. Le début de la conversation (consignes et supports) est relu depuis le cache au tour suivant, ce qui coûte environ 10 fois moins cher.
- **Refus de sécurité** : avec Sonnet, l'API relance la demande sur un autre modèle (repli serveur `fallbacks: "default"`). Haiku n'a pas de repli : le testeur voit « Claude n'a pas pu répondre à cette demande. Reformule-la. »
- **Limites par demande** : 16 000 tokens de réponse au plus, 300 000 octets de texte, 5 images de 5 Mo au plus.

**Format des échanges** : `POST /functions/v1/chat` avec `{ messages, tier, tache, images }` (ou `prompt` à la place de `messages`). Réponse en NDJSON (une ligne JSON par événement) :
`{"type":"texte","delta":"…"}` … puis `{"type":"fin","text","tronque","modele","tokens","quota"}`, ou `{"type":"erreur","code","message"}`.

### Quota (`supabase/migrations/20261102000002_ia_quota.sql`)

- **Ce qui compte** : 500 000 tokens par testeur et par semaine, tous modèles confondus (entrée + cache écrit + cache lu + sortie).
- **La semaine** : elle commence le lundi à 00:00, heure de Kinshasa.
- **Changer le quota de tout le monde** : `update ia_config set quota_semaine = 800000;`
- **Changer le quota d'un seul testeur** : `insert into ia_quotas (owner, quota_semaine) values ('<uuid>', 1000000);`
- **Voir ce qu'il reste** : un testeur connecté lit son quota avec `ia_mon_quota()`. Il ne voit que sa propre consommation et ne peut rien écrire.
- **Dépassement possible** : le quota est vérifié avant chaque demande. La dernière réponse de la semaine peut donc faire passer un peu au-dessus de la limite (au plus 16 000 tokens de réponse, plus l'entrée de cette demande). Pareil si plusieurs demandes partent en même temps.

### Limite connue

C'est l'app qui écrit les consignes envoyées à Claude (`RULES`, modes). Un testeur malin pourrait donc utiliser la fonction comme un Claude généraliste, mais seulement dans la limite de son quota. Pour la version commerciale, il faudra déplacer les consignes côté serveur.

### Déploiement

Dans le tableau de bord Supabase :

1. **SQL Editor** : exécuter les fichiers de `supabase/migrations/`, dans l'ordre (`…01_carnet`, `…02_ia_quota`, `…03_stockage`).
2. **Edge Functions → Secrets** : ajouter `ANTHROPIC_API_KEY` (ta clé Claude Console). Facultatif : `ALLOWED_ORIGINS` = adresse de l'app, par exemple `https://carnet.example.com`. `SUPABASE_URL` et la clé serveur (`SUPABASE_SERVICE_ROLE_KEY` ou `SUPABASE_SECRET_KEYS`) sont fournis automatiquement.
3. Déployer la fonction. **Sans rien installer** : Edge Functions → Deploy a new function → Via Editor, nommer la fonction `chat`, coller tout le contenu de `deploiement/chat-un-fichier.ts`, puis Deploy. Ensuite, dans les réglages de la fonction, désactiver « Verify JWT ». Ce fichier est fabriqué à partir du code testé par `node scripts/fichier-unique.mjs`, et `npm test` vérifie qu'il est à jour.

   **Ou** avec la CLI Supabase, depuis `app-etude/web` :
   ```bash
   npx supabase login
   ```
   ```bash
   npx supabase functions deploy chat --project-ref xyrlifukufcntwinrtvz --no-verify-jwt
   ```
   `--no-verify-jwt` : ton projet utilise les nouvelles clés (`sb_publishable_…`). Avec ces clés, Supabase conseille de vérifier le jeton dans la fonction plutôt qu'à l'entrée. Ce n'est pas une faille : la fonction `chat` refuse toute demande sans jeton valide (`auth.getUser`), ce qui est testé.

## Fichiers (Supabase Storage)

`supabase/migrations/20261102000003_stockage.sql` crée le bucket privé `supports` (10 Mo par fichier ; JPEG, PNG, WebP, GIF, PDF).

- Chaque testeur a son dossier `<uid>/…` : il ne peut lire, ajouter, renommer ou supprimer que ses fichiers.
- Dans la base : `url` = `storage:supports/<chemin>` (adresse d'affichage, l'app en fera un lien temporaire) et `asset_id` = `<chemin>` pour le support qui possède le fichier.
- Comme dans la V1, les copies d'un sous-projet ont une `url` mais pas d'`asset_id` : supprimer une copie ne supprime pas le fichier d'origine.
- Limite connue : supprimer un compte ne supprime pas ses fichiers dans Storage (Supabase interdit de le faire en SQL). Il faudra les supprimer depuis le tableau de bord (Storage → supports → dossier du compte).

## Importer tes projets de l'artifact

1. Connecte-toi une fois à l'app web avec ton adresse e-mail pour que ton compte existe.
2. Récupère l'export de la base de l'artifact (Claude Code peut le faire : documents `data/users/me/carnet/projets/...`). Garde-le hors du dépôt, il contient tes données.
3. Génère le script :
   ```bash
   node import/import.mjs chemin/vers/export --email ton@adresse.com --out import/import.sql
   ```
   Le script affiche ce qu'il a trouvé et les corrections faites (par exemple `nbSupports` recalculé).
4. Supabase → SQL Editor → coller `import/import.sql` → Run.
   - Tout se fait dans une transaction : en cas d'erreur, rien n'est importé.
   - Tu peux le relancer : les projets déjà importés sont mis à jour, pas dupliqués.

### Avec les photos et PDF

1. Récupère les fichiers de l'artifact dans un dossier, un fichier par `assetId` (`<assetId>.jpg`, `<assetId>.pdf`). Claude Code peut le faire.
2. Téléverse-les dans ton dossier Storage (il faut ton uuid : Authentication → Users) :
   ```bash
   SUPABASE_SERVICE_ROLE_KEY=ta-cle node import/televerser.mjs --dossier chemin/vers/fichiers --owner ton-uuid
   ```
   La clé `service_role` donne tous les droits sur le projet : ne la mets jamais dans le code, dans le dépôt ou dans le chat.
3. Génère le script d'import avec l'option `--fichiers` : les adresses `/_blob/…` de l'artifact sont remplacées par les adresses Storage.
   ```bash
   node import/import.mjs chemin/vers/export --email ton@adresse.com --fichiers chemin/vers/fichiers --out import/import.sql
   ```
   Un fichier absent est signalé. Son support est importé quand même, avec son texte.

## Tests

Il faut Postgres 15 ou plus en local, ou une base de test dans `PGURL`. Installe d'abord les outils de test (le SDK Anthropic, supabase-js et Deno, en versions figées) :

```bash
npm install
```

```bash
npm test
```

Ce que lance `npm test` :

| Fichier | Ce qu'il teste |
| --- | --- |
| `test/db.test.mjs` | Schéma, règles d'accès, quota (SQL), import |
| `test/chat.test.mjs` | Fonction `chat` avec le vrai SDK et une fausse API Claude (modèles, cache, streaming, quota, erreurs, arrêt en cours de réponse) |
| `test/chat.deno.test.ts` | La même fonction sous Deno, l'environnement réel des Edge Functions |
| `test/televerser.test.mjs` | Téléversement des fichiers vers Storage (faux serveur) |
| `test/app.test.mjs` | L'app de bout en bout dans Chromium (Playwright), avec un faux Supabase (`test/fake_supabase.js`) et une fausse fonction `chat` : connexion, projets, supports, plan, séance, mode approfondi, photo, quota, refus, sous-projet, rechargement, suppression, autre testeur, déconnexion, base injoignable |
| `test/supabase_reel.test.mjs` | Forme exacte des requêtes de `backend.js` avec la vraie bibliothèque supabase-js |

Aucun test n'appelle la vraie API Claude : ils ne coûtent rien.

Pour tester aussi l'import sur un vrai export (rien n'est envoyé ailleurs, la base de test est jetable) :

```bash
IMPORT_REEL=chemin/vers/export FICHIERS_REEL=chemin/vers/fichiers npm test
```
