# Templates email Supabase — Coligo

Supabase n'envoie pas automatiquement les fichiers de ce dossier : il faut les coller dans le **Dashboard Supabase**. Ce dossier sert de **source de vérité versionnée** pour les templates.

## Installation du template "Confirm signup"

1. Ouvrir le dashboard Supabase : <https://supabase.com/dashboard/project/_/auth/templates>
2. Sélectionner **Confirm signup**
3. Copier-coller **tout le contenu** de `confirm-signup.html` dans le champ "Message body"
4. Définir le sujet (champ "Subject heading") :
   ```
   Confirmez votre inscription sur Coligo
   ```
5. **Save changes**

## Installation du template "Change Email Address" (code de confirmation)

La page **Compte** client permet de changer d'email avec un **code à 6 chiffres**.
Pour que le client reçoive ce code (et pas seulement un lien), le template doit
afficher `{{ .Token }}`.

1. Dashboard → **Authentication → Email Templates → Change Email Address**
2. Coller tout le contenu de `change-email.html` dans "Message body"
3. Sujet : `Confirme ta nouvelle adresse email — Coligo`
4. **Save changes**

> Le flux applicatif appelle `supabase.auth.verifyOtp({ type: 'email_change' })`
> avec le code saisi. Le bouton/lien `{{ .ConfirmationURL }}` reste un repli qui
> passe par `app/auth/confirm/route.ts`. Pour une expérience à un seul code,
> garder « Secure email change » désactivé (Authentication → Providers → Email),
> sinon Supabase exige une confirmation depuis l'ancienne ET la nouvelle adresse.

## Configurer l'URL de redirection

Pour que le bouton "Confirmer mon inscription" pointe vers la bonne page :

1. **Authentication → URL Configuration**
2. **Site URL** : `http://localhost:3000` en dev, `https://commercant.coligo.app` en prod
3. **Redirect URLs** (ajouter à l'allowlist) :
   - `http://localhost:3000/auth/confirm`
   - `http://localhost:3000/auth/confirmed`
   - `https://commercant.coligo.app/auth/confirm`
   - `https://commercant.coligo.app/auth/confirmed`

La variable `{{ .ConfirmationURL }}` dans le template génère automatiquement un lien du type :

```
{SITE_URL}/auth/confirm?token_hash=xxx&type=signup&next=/dashboard
```

Le route handler `app/auth/confirm/route.ts` intercepte cette URL, vérifie le token, puis redirige vers `/auth/confirmed` (page de succès avec bouton "Se connecter").

## Variables disponibles dans les templates Supabase

- `{{ .ConfirmationURL }}` — URL complète avec token (à utiliser dans le bouton)
- `{{ .Token }}` — OTP code (si flow par code)
- `{{ .TokenHash }}` — hash du token (pour construire l'URL soi-même)
- `{{ .SiteURL }}` — Site URL configurée
- `{{ .Email }}` — email du destinataire
- `{{ .Data.merchant_name }}` — metadata custom passée lors du `signUp`

## Désactiver le bandeau "Powered by Supabase"

Plan Pro requis. Sinon, garder la marque Coligo en footer et accepter la signature Supabase en bas.
