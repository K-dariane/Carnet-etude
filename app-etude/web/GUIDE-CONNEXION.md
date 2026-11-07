# Guide : connexion des utilisateurs

Modes de connexion : e-mail et mot de passe, code reçu par e-mail, Google, Facebook. Apple n'est pas proposé (décision du 2026-11-07).

Projet Supabase : `xyrlifukufcntwinrtvz`. App : https://k-dariane.github.io/Carnet-etude/

Adresse de retour à donner à Google et Facebook (toujours la même) :

```
https://xyrlifukufcntwinrtvz.supabase.co/auth/v1/callback
```

## 0. Avant de mettre en ligne la nouvelle version (une seule fois)

1. **Créer la table des profils** : Supabase → **SQL Editor** → **New query**. Colle le contenu de `supabase/migrations/20261107000004_profils.sql`, puis clique sur **Run**.
   Sans cette table, l'app marche, mais Claude ne connaît pas le niveau des utilisateurs.
2. **Réglages des comptes par e-mail** : Supabase → **Authentication** → **Sign In / Providers** → **Email**.
   - **Confirm email** : activé (l'adresse doit être confirmée par un e-mail).
   - **Minimum password length** : `8`.
   - Enregistre.
3. **Les trois modèles d'e-mail** : Supabase → **Authentication** → **Emails** → **Templates**. Pour chaque modèle, clique sur **Source** (pas Preview), efface tout, colle le texte, puis **Save changes**.

   **Confirm signup** (e-mail d'activation) — sujet : `Active ton compte Carnet d'étude`
   ```html
   <h2>Bienvenue dans le Carnet d'étude</h2>
   <p>Pour activer ton compte, touche ce lien :</p>
   <p><a href="{{ .SiteURL }}?token_hash={{ .TokenHash }}&type=email">Activer mon compte</a></p>
   <p>Ou saisis ce code dans l'app : <strong>{{ .Token }}</strong></p>
   <p>Si tu n'as rien demandé, ignore cet e-mail.</p>
   ```

   **Magic Link** (connexion par code) — sujet : `Ton code de connexion au Carnet d'étude`
   ```html
   <h2>Connexion au Carnet d'étude</h2>
   <p>Touche ce lien pour te connecter :</p>
   <p><a href="{{ .SiteURL }}?token_hash={{ .TokenHash }}&type=email">Me connecter</a></p>
   <p>Ou saisis ce code dans l'app : <strong>{{ .Token }}</strong></p>
   <p>Si tu n'as rien demandé, ignore cet e-mail.</p>
   ```

   **Reset Password** (mot de passe oublié) — sujet : `Choisis un nouveau mot de passe`
   ```html
   <h2>Mot de passe oublié</h2>
   <p>Pour choisir un nouveau mot de passe, touche ce lien :</p>
   <p><a href="{{ .SiteURL }}?token_hash={{ .TokenHash }}&type=recovery">Choisir un nouveau mot de passe</a></p>
   <p>Ou saisis ce code dans l'app : <strong>{{ .Token }}</strong></p>
   <p>Si tu n'as rien demandé, ignore cet e-mail : ton mot de passe ne change pas.</p>
   ```

   Garde `{{ .SiteURL }}`, `{{ .TokenHash }}` et `{{ .Token }}` tels quels. Supabase les remplace par l'adresse de l'app, le lien et le code. Ces liens ouvrent l'app, et c'est l'app qui valide : les aperçus automatiques de WhatsApp ou des messageries ne peuvent plus « griller » le lien.

4. **Fusionner la pull request** : l'app se met à jour toute seule en 1 à 2 minutes.

## 1. Google : régler le problème « lien expiré »

Supabase et Google acceptent bien la demande : la page « Choisir un compte » s'affiche. Le problème arrive **après** le choix du compte. Vérifie dans l'ordre :

1. **L'application Google est-elle en mode « Test » ?** C'est la cause la plus fréquente. En mode Test, seuls les comptes ajoutés à la main peuvent se connecter.
   Google Cloud (https://console.cloud.google.com/) → ton projet → **Google Auth Platform** → **Audience** (ou **API et services** → **Écran de consentement OAuth**) → **Publier l'application**. Pour le nom et l'e-mail seulement, Google ne demande pas de vérification.
2. **Le secret client est-il le bon ?** Google Cloud → **Google Auth Platform** → **Clients** (ou **API et services** → **Identifiants**) → ton client Web. Copie le **code secret du client**.
   Supabase → **Authentication** → **Sign In / Providers** → **Google** : recolle-le dans **Client Secret (for OAuth)**, vérifie le **Client ID**, puis **Save**.
3. **L'adresse de retour est-elle autorisée ?** Dans le même client Google, sous **URI de redirection autorisés**, il doit y avoir exactement `https://xyrlifukufcntwinrtvz.supabase.co/auth/v1/callback`.
4. **L'adresse de l'app est-elle bonne ?** Supabase → **Authentication** → **URL Configuration** :
   - Site URL `https://k-dariane.github.io/Carnet-etude/` ;
   - Redirect URLs `https://k-dariane.github.io/Carnet-etude/**`.
5. **Réessaie sur l'app.** La nouvelle version affiche le **vrai message** de Supabase au lieu de « lien expiré ». Si ça bloque encore, fais une capture de ce message.

## 2. Facebook (gratuit, environ 1 h)

1. Va sur https://developers.facebook.com/ → **Mes apps** → **Créer une app**.
   - Cas d'utilisation : **Authentifier les utilisateurs avec Facebook Login** (« Authenticate and request data from users with Facebook Login »).
   - Nom : `Carnet d'étude`. Adresse de contact : la tienne.
2. Dans l'app → **Cas d'utilisation** → **Personnaliser** → **Paramètres** de Facebook Login :
   - **URI de redirection OAuth valides** : `https://xyrlifukufcntwinrtvz.supabase.co/auth/v1/callback`
   - Permissions : `email` et `public_profile` (déjà présentes par défaut).
3. **Paramètres de l'app** → **Général** : note l'**ID de l'app** et la **Clé secrète**. Remplis aussi :
   - **URL de la politique de confidentialité** et **URL des instructions de suppression des données** : ces deux pages n'existent pas encore. Dis-moi quand tu en es là : je les crée dans l'app, avec ton adresse de contact, à faire relire.
4. Supabase → **Authentication** → **Sign In / Providers** → **Facebook** : active-le, colle l'**ID** dans **Facebook client ID** et la **clé secrète** dans **Facebook secret**, puis **Save**.
5. De retour chez Meta : passe l'app en mode **Live** (« En ligne ») en haut de la page. En mode « Développement », seuls toi et les testeurs ajoutés à l'app peuvent se connecter.

Le bouton « Continuer avec Facebook » apparaît tout seul dans l'app dès que Facebook est activé dans Supabase.

## 3. Mot de passe oublié et récupération du compte

| Situation | Solution dans l'app |
| --- | --- |
| Mot de passe oublié | « Mot de passe oublié ? » : e-mail avec un lien et un code, puis nouveau mot de passe |
| Pas envie de mot de passe | « Me connecter avec un code reçu par e-mail » |
| Compte créé avec Google ou Facebook | Même adresse e-mail : Supabase relie les comptes. « Mon compte » permet aussi d'ajouter un mot de passe. |
| Plus d'accès à son adresse e-mail | Toi, dans Supabase → **Authentication** → **Users** → la personne → changer son adresse, ou **Send password recovery** |
| Plus tard : par SMS | Code par SMS au numéro de téléphone (service Twilio, payant, environ 0,05 à 0,15 $ par SMS vers la RDC, à vérifier) |

## 4. Mineurs (niveaux primaire et secondaire)

- **À la création du compte** : l'app demande « As-tu 18 ans ou plus ? ». Si la réponse est non, il faut cocher « Un parent ou un tuteur est d'accord ». La base refuse un mineur sans cet accord.
- **À préciser avant l'ouverture au public** :
  - les règles d'Anthropic pour les produits utilisés par des mineurs (protections supplémentaires) ;
  - la loi sur l'accord des parents (RDC, et RGPD si les données sont dans l'UE).

  Voir le document administratif.
