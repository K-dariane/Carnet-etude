# Guide : mettre l'app sur carnet-etude.app (Cloudflare Pages)

**Nouvelle adresse de l'app : https://carnet-etude.app**

Le domaine `carnet-etude.app` a été acheté chez Cloudflare le 2026-11-12. L'app quitte GitHub Pages (`k-dariane.github.io/Carnet-etude`) pour Cloudflare Pages, avec ce domaine. Ensuite, le dépôt GitHub devient privé.

**Ce qui ne change pas :** Supabase. Comptes, base de données, fichiers et fonction du tuteur restent où ils sont. Seule l'adresse des pages de l'app change.

Durée totale : environ 45 minutes, en 5 parties. L'ancienne adresse GitHub reste en ligne jusqu'à la partie 5 : les testeurs ne sont pas coupés.

| Partie | Quoi | Qui | Durée |
| --- | --- | --- | --- |
| 1 | Créer le site sur Cloudflare Pages | toi | 10 min |
| 2 | Relier carnet-etude.app au site | toi | 5 min (+ quelques minutes d'attente) |
| 3 | Brancher Supabase sur la nouvelle adresse | toi | 5 min |
| 4 | Vérifier sur ton téléphone | toi | 10 min |
| 5 | Fermer l'ancienne adresse, rendre le code privé | Claude puis toi | 10 min |

---

## Partie 1 — Créer le site sur Cloudflare Pages

1. Va sur https://dash.cloudflare.com et connecte-toi (le compte avec lequel tu as acheté le domaine).
2. Dans le menu de gauche, clique sur **Workers & Pages** (parfois **Compute (Workers)** → **Workers & Pages**).
3. Clique sur le bouton bleu **Create** (« Créer »).
4. Choisis l'onglet **Pages** (pas « Workers »), puis **Import an existing Git repository** (ou **Connect to Git**).
5. Choisis **GitHub**, puis **Connect GitHub**. Une fenêtre GitHub s'ouvre :
   - connecte-toi à GitHub si on te le demande ;
   - à **Repository access**, choisis **Only select repositories** ;
   - dans la liste, choisis **K-dariane/Carnet-etude** ;
   - clique sur **Install & Authorize**. La fenêtre se ferme et tu reviens chez Cloudflare.
6. Choisis le dépôt **Carnet-etude**, puis **Begin setup**.
7. Remplis **exactement** ces champs :

   | Champ | Valeur |
   | --- | --- |
   | **Project name** | `carnet-etude` |
   | **Production branch** | `main` |
   | **Framework preset** | `None` |
   | **Build command** | laisse **vide** |
   | **Build output directory** | `app-etude/web/app` |
   | **Root directory (advanced)** | laisse **vide** |
   | **Environment variables** | aucune |

8. Clique sur **Save and Deploy**. Attends environ 1 minute, jusqu'au message **Success! Your project is deployed**.
9. Cloudflare affiche une adresse provisoire, par exemple `https://carnet-etude.pages.dev`. Ouvre-la : l'écran de connexion du Carnet doit s'afficher. **Ne te connecte pas encore** : il faut d'abord la partie 3.

Désormais, chaque modification fusionnée dans `main` est mise en ligne automatiquement chez Cloudflare.

---

## Partie 2 — Relier carnet-etude.app au site

1. Toujours dans **Workers & Pages**, ouvre ton projet **carnet-etude**.
2. Va dans l'onglet **Custom domains**, puis clique sur **Set up a custom domain**.
3. Tape `carnet-etude.app` (sans `www`, sans `https://`), puis **Continue**.
4. Cloudflare propose d'ajouter l'enregistrement DNS lui-même, puisque le domaine est chez lui : clique sur **Activate domain**.
5. L'état passe de **Initializing** (ou **Verifying**) à **Active** en quelques minutes. Rafraîchis la page de temps en temps. Ça peut prendre jusqu'à 30 minutes, le temps de créer le certificat de sécurité (https).
6. **Facultatif mais conseillé** : recommence les étapes 2 à 5 avec `www.carnet-etude.app`, pour que l'adresse avec « www » marche aussi.
7. Ouvre **https://carnet-etude.app** : l'écran de connexion du Carnet doit s'afficher.

À savoir : les adresses en `.app` marchent **seulement en https**. Cloudflare s'en occupe tout seul, il n'y a rien à régler.

---

## Partie 3 — Brancher Supabase sur la nouvelle adresse

1. Va sur https://supabase.com/dashboard, ouvre ton projet, puis **Authentication** → **URL Configuration**.
2. **Site URL** : efface l'adresse GitHub et mets exactement :
   ```
   https://carnet-etude.app/
   ```
   puis clique sur **Save**.
3. **Redirect URLs** → **Add URL** → mets exactement :
   ```
   https://carnet-etude.app/**
   ```
   puis **Save URLs**.
   **Garde l'ancienne adresse GitHub** dans la liste pour l'instant : elle sera retirée à la partie 5.
4. **Seulement si tu as créé le secret `ALLOWED_ORIGINS`** (Edge Functions → Secrets) : mets les deux adresses, séparées par une virgule, pendant la transition :
   ```
   https://carnet-etude.app,https://k-dariane.github.io
   ```
   Si tu ne l'as pas créé, ne fais rien.

Rien à changer :
- **dans les modèles d'e-mail** : `{{ .SiteURL }}` prend tout seul la nouvelle adresse ;
- **chez Google pour la connexion** : l'adresse de retour reste celle de Supabase (`…supabase.co/auth/v1/callback`).

---

## Partie 4 — Vérifier sur ton téléphone

Ouvre **https://carnet-etude.app** et teste, dans l'ordre :

1. **Connexion par e-mail** : connecte-toi avec ton e-mail et ton mot de passe. Il faut se reconnecter une fois, car la connexion est liée à l'adresse du site. Tes projets ne bougent pas : ils sont dans Supabase.
2. **Mot de passe oublié** : demande un e-mail. Le lien qu'il contient doit commencer par `https://carnet-etude.app`.
3. **Google** : « Continuer avec Google » doit te ramener sur `carnet-etude.app`. Ça suppose que le secret Google soit réglé (étape 1.c de la liste des tâches).
4. **Le tuteur** : ouvre un projet et pose une question. La réponse doit s'écrire au fil de l'eau.
5. **La voix** : 🎤 dictée et « 🔊 Écouter ». Le navigateur redemandera l'accès au micro pour cette nouvelle adresse.
6. **Installer l'app** : ajoute-la à l'écran d'accueil depuis `carnet-etude.app`, puis supprime l'ancienne icône, qui pointe vers GitHub.

Si quelque chose ne marche pas, envoie une capture à Claude **avant** la partie 5.

---

## Partie 5 — Fermer l'ancienne adresse et rendre le code privé

À faire **seulement quand la partie 4 marche**.

1. **Claude** prépare une pull request qui retire la publication sur GitHub Pages (`.github/workflows/pages.yml`) et met `carnet-etude.app` dans la documentation, la page de confidentialité et les tests. **Toi** : fusionne-la.
2. **Préviens les testeurs** : envoie-leur le nouveau lien, https://carnet-etude.app, et dis-leur qu'ils devront se reconnecter une fois.
3. **Dépublie GitHub Pages** : https://github.com/K-dariane/Carnet-etude/settings/pages → **Unpublish site** (selon l'affichage, dans le menu **⋯**). L'ancienne adresse ne répond plus.
4. **Supabase** → **Authentication** → **URL Configuration** → **Redirect URLs** : supprime `https://k-dariane.github.io/Carnet-etude/**` (icône poubelle).
   Si tu as `ALLOWED_ORIGINS`, ne garde que `https://carnet-etude.app`.
5. **Rends le dépôt privé** : https://github.com/K-dariane/Carnet-etude/settings → tout en bas, **Danger Zone** → **Change visibility** → **Make private**, puis confirme.
   - Cloudflare continue de publier l'app : son accès au dépôt reste valable.
   - Le déploiement automatique de la fonction du tuteur continue : 2 000 minutes gratuites par mois pour un dépôt privé, et un déploiement en prend environ 3.

---

## Ensuite (avec l'adresse définitive)

- **Branding Google** : guide `GUIDE-CONNEXION.md`, partie 1. Les valeurs y sont déjà adaptées à `carnet-etude.app`.
- **Facebook**, si tu le veux.
- **Plus tard** : une adresse e-mail au nom de l'app (par exemple `contact@carnet-etude.app`), pour envoyer les e-mails de connexion depuis le domaine plutôt que depuis Gmail.
- **Le renouvellement du domaine** : il se fait chaque année chez Cloudflare (Domain Registration). Vérifie que le **renouvellement automatique** est activé et que ta carte est à jour : si le domaine expire, l'app devient inaccessible.
