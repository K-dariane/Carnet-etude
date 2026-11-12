# Guide : mettre l'app sur Cloudflare Pages (adresse gratuite)

But : l'app quitte GitHub Pages (`k-dariane.github.io/Carnet-etude`) pour une adresse gratuite chez Cloudflare, du type `carnet-etude.pages.dev`. Ensuite, le dépôt GitHub peut devenir privé.

Supabase ne change pas : comptes, base de données, fichiers et fonction du tuteur restent où ils sont. Seule l'adresse des pages de l'app change.

Durée : environ 30 minutes. L'ancienne adresse GitHub reste en ligne pendant toute la transition.

---

## Partie 1 — Créer le site sur Cloudflare (environ 10 minutes)

1. Va sur https://dash.cloudflare.com/sign-up et crée un compte gratuit (adresse e-mail et mot de passe). Confirme l'adresse avec l'e-mail reçu.
2. Dans le menu de gauche, ouvre **Workers & Pages** (parfois **Compute (Workers)**).
3. Clique sur **Create** (« Créer »), choisis l'onglet **Pages**, puis **Import an existing Git repository** (ou **Connect to Git**).
4. Choisis **GitHub**, puis **Connect GitHub** :
   - une fenêtre GitHub s'ouvre : connecte-toi ;
   - à la question **Repository access**, choisis **Only select repositories**, puis **K-dariane/Carnet-etude** ;
   - clique sur **Install & Authorize**.
5. De retour chez Cloudflare, choisis le dépôt **Carnet-etude**, puis **Begin setup**.
6. Remplis exactement ces champs :

   | Champ | Valeur |
   | --- | --- |
   | **Project name** | `carnet-etude`. Ce nom donne l'adresse : `carnet-etude.pages.dev`. S'il est déjà pris, essaie `carnet-etude-app`. |
   | **Production branch** | `main` |
   | **Framework preset** | `None` |
   | **Build command** | laisse **vide** |
   | **Build output directory** | `app-etude/web/app` |
   | **Root directory (advanced)** | laisse **vide** |
   | **Environment variables** | aucune (la configuration publique est déjà dans `config.js`) |

7. Clique sur **Save and Deploy**. Attends le message **Success**, environ 1 minute.
8. Cloudflare affiche l'adresse du site, par exemple `https://carnet-etude.pages.dev`. **Note-la et envoie-la à Claude** : il faut la mettre dans les réglages et dans la documentation.

Désormais, chaque modification fusionnée dans `main` est mise en ligne automatiquement chez Cloudflare.

---

## Partie 2 — Brancher Supabase sur la nouvelle adresse (environ 5 minutes)

Remplace `carnet-etude.pages.dev` par l'adresse obtenue à l'étape 8.

1. Supabase → ton projet → **Authentication** → **URL Configuration** :
   - **Site URL** : remplace l'adresse GitHub par `https://carnet-etude.pages.dev/`, puis **Save**.
   - **Redirect URLs** : **Add URL** → `https://carnet-etude.pages.dev/**`. Garde l'ancienne adresse GitHub pour l'instant : elle sera retirée à la partie 4.
2. Si tu as créé le secret `ALLOWED_ORIGINS` (Edge Functions → Secrets), mets-y les deux adresses pendant la transition : `https://carnet-etude.pages.dev,https://k-dariane.github.io`. Sinon, ne fais rien.
3. Rien à changer dans les modèles d'e-mail : `{{ .SiteURL }}` prend tout seul la nouvelle adresse.
4. Rien à changer chez Google pour la connexion : l'adresse de retour reste celle de Supabase (`…supabase.co/auth/v1/callback`).

---

## Partie 3 — Vérifier que tout marche à la nouvelle adresse (environ 10 minutes)

Sur ton téléphone, ouvre la nouvelle adresse :

1. **Connexion par e-mail** : connecte-toi avec ton e-mail et ton mot de passe.
2. **Mot de passe oublié** : l'e-mail reçu doit contenir un lien vers la **nouvelle** adresse.
3. **Google** : « Continuer avec Google » doit te ramener sur la nouvelle adresse.
4. **Tes projets** : ouvre un projet et pose une question au tuteur. La réponse doit s'écrire au fil de l'eau.
5. **La voix** : 🎤 et « 🔊 Écouter » doivent marcher.
6. **Installer l'app** : ajoute-la à l'écran d'accueil depuis la nouvelle adresse. L'ancienne icône pointe vers GitHub, tu peux la supprimer.

Tes projets ne bougent pas : ils sont dans Supabase. En revanche, la connexion est liée à l'adresse du site : **il faut se reconnecter une fois** sur la nouvelle adresse.

Si quelque chose ne marche pas, envoie une capture à Claude avant de passer à la partie 4.

---

## Partie 4 — Fermer l'ancienne adresse et rendre le code privé (environ 5 minutes)

À faire **seulement quand la partie 3 marche**.

1. **Prévenir les testeurs** : envoie-leur la nouvelle adresse, et dis-leur qu'ils devront se reconnecter une fois.
2. **Arrêter la publication sur GitHub Pages** : Claude prépare une pull request qui retire `.github/workflows/pages.yml` et met la nouvelle adresse dans la documentation et la page de confidentialité. Fusionne-la.
3. **Dépublier GitHub Pages** : https://github.com/K-dariane/Carnet-etude/settings/pages → **Unpublish site** (selon l'affichage, dans le menu **⋯**). L'ancienne adresse ne répond plus.
4. **Supabase** → **URL Configuration** → **Redirect URLs** : supprime l'adresse `https://k-dariane.github.io/Carnet-etude/**` (icône poubelle).
   Si tu as `ALLOWED_ORIGINS`, ne garde que `https://carnet-etude.pages.dev`.
5. **Rendre le dépôt privé** : https://github.com/K-dariane/Carnet-etude/settings → tout en bas, **Danger Zone** → **Change visibility** → **Make private**, puis confirme.
   - Cloudflare continue de publier l'app : son accès au dépôt reste valable.
   - Le déploiement automatique de la fonction du tuteur (GitHub Actions) continue : 2 000 minutes gratuites par mois pour un dépôt privé, et un déploiement en prend environ 3.

---

## Plus tard : ton propre nom de domaine

Quand tu auras choisi le nom de l'app, par exemple `carnetetude.com` (environ 10 à 12 $ par an) :

1. Cloudflare → **Domain Registration** → achète le domaine.
2. Ton projet Pages → **Custom domains** → **Set up a custom domain** → ton domaine.
3. Refais la **partie 2** avec la nouvelle adresse, puis la partie Branding de Google (`GUIDE-CONNEXION.md`).
