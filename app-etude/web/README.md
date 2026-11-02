# Carnet d'étude — version web (Supabase)

App web autonome pour les testeurs, sans compte Claude. En cours de construction, étape par étape.
La V1 (`../carnet/index.html`, artifact claude.ai) n'est pas modifiée.

| Étape | État |
| --- | --- |
| Schéma de la base, règles d'accès, import | Fait, testé |
| Fonction serveur IA (Haiku / Sonnet, streaming) | À faire |
| Quota : 500 000 tokens par testeur et par semaine | À faire |
| Fichiers (Supabase Storage) | À faire |
| Connexion (lien e-mail, Google) | À faire |
| Branchement de l'app | À faire |

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

Les fichiers d'origine (photos, PDF) restent dans l'artifact pour l'instant : le **texte extrait** est importé, c'est lui que l'IA utilise. Leur copie vers Supabase Storage se fera à l'étape « Fichiers ».

## Tests

Il faut Postgres 15 ou plus en local, ou une base de test dans `PGURL`.

```bash
npm test
```

Pour tester aussi l'import sur un vrai export (rien n'est envoyé ailleurs, la base de test est jetable) :

```bash
IMPORT_REEL=chemin/vers/export npm test
```
