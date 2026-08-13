# Sécurité plateforme — défense en profondeur

Mis en place le 13/08/2026 (mig `0452_security_shield.sql`). Ce document est le
runbook de référence : ce qui protège quoi, comment activer le captcha, quoi
faire pendant une attaque, et les phases suivantes.

## Architecture (couches, de l'extérieur vers l'intérieur)

| #   | Couche                                                                            | État                                                  |
| --- | --------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 1   | Cloudflare (DNS-only aujourd'hui — proxy/WAF **non actifs**)                      | Phase 2, voir plus bas                                |
| 2   | Vercel edge : anti-DDoS L3/L4 automatique + **Attack Challenge Mode** manuel      | ✅ (disjoncteur : `scripts/security/attack-mode.mjs`) |
| 3   | En-têtes HTTP durcis (HSTS, X-Frame-Options, nosniff, Permissions-Policy)         | ✅ `next.config.ts`                                   |
| 4   | Middleware : blocage IP admin (mig 0287) sur les 6 pages de login                 | ✅ existant                                           |
| 5   | **Rate limiting applicatif Postgres** (mig 0452) sur toutes les surfaces anonymes | ✅                                                    |
| 6   | **Honeypot** (toujours actif) + **captcha Turnstile** (dormant sans clés)         | ✅ / 🔑 à activer                                     |
| 7   | Rate limits natifs GoTrue (Supabase Auth)                                         | ✅ (défauts)                                          |
| 8   | RLS partout + moteur anti-fraude post-login (mig 0373-0374)                       | ✅ existant                                           |

Pourquoi le rate limiting vit dans Postgres et pas chez Vercel/GoTrue :

- plan Vercel **Hobby** → pas de règles WAF de rate limiting ;
- les appels Supabase côté serveur partent des **IP de sortie Vercel** → les
  limites « par IP » de GoTrue ne voient jamais l'IP du client réel ;
- serverless → un compteur en mémoire ne voit qu'une instance. Seule la DB
  voit le trafic global.

Philosophie : **fail-open** (une panne du compteur ne bloque jamais un humain)
et seuils **généreux** — le CGNAT mobile algérien fait partager une IP publique
à des milliers d'abonnés ; on vise les scripts, pas les quartiers.

## Limites en place (mig 0452, `lib/security/rate-limit.ts`)

| Surface                                                   | Bucket(s)                          | Limite                         | Notes                                                                                                        |
| --------------------------------------------------------- | ---------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Inscriptions (5 rôles, **partagé**)                       | `signup_ip_h` / `signup_ip_d`      | 20/h et 60/j par IP            | + honeypot + Turnstile ; `captchaToken` transmis au `signUp`                                                 |
| Login client/commerçant/livreur/chauffeur/agent           | `login_ip`                         | 30/10 min par IP (par rôle)    |                                                                                                              |
| Échecs de login par compte                                | `login_fail`                       | 10/15 min                      | **peek avant, hit après échec seulement** → impossible de verrouiller la victime en spammant son identifiant |
| Portail super-admin                                       | `login_ip` / `login_fail`          | 10/10 min IP · 5/15 min compte | plus strict                                                                                                  |
| Reset mot de passe                                        | `pwreset_ip`, `pwreset_email_h/_d` | 6/h IP · 3/h + 6/j par email   | dépassement = réponse générique **sans envoi** (anti-enum intact, boîte de la victime protégée)              |
| Drafts inscription commerçant (service_role sans session) | `merchant_draft_ip`                | 120/h IP                       | étouffé en silence (fire-and-forget)                                                                         |
| Proxy téléchargement APK                                  | `apk_ip_h/_d`                      | 10/h et 30/j IP                | ~50 Mo relayés par appel → protège la bande passante                                                         |
| `/api/marketing-topics` (sans auth)                       | `mkt_topics_ip`                    | 30/h IP                        | anti-abus topics FCM                                                                                         |

Journal : table `security_events` (`rate_limited`, `honeypot`, `captcha_*`) —
service_role seul. Inspection rapide :

```sql
-- Activité des dernières 24 h par type
select kind, count(*), min(created_at), max(created_at)
from security_events where created_at > now() - interval '24 hours'
group by kind order by count(*) desc;

-- Top IP bloquées
select ip, count(*) from security_events
where kind = 'rate_limited' and created_at > now() - interval '24 hours'
group by ip order by count(*) desc limit 20;
```

## 🔑 Activer le captcha Turnstile (5 minutes, une fois)

1. https://dash.cloudflare.com → **Turnstile** → _Add widget_ :
   hostnames `coligo.app` + `commercant.coligo.app` (+ `localhost` pour le dev),
   mode **Managed** (invisible sauf doute — fonctionne dans la WebView
   Capacitor puisque l'app charge coligo.app).
2. `node scripts/security/enable-turnstile.mjs <SITE_KEY> <SECRET_KEY>`
   → pose les env vars Vercel + `.env.local`.
3. Redéployer (n'importe quel push sur `main`).

Sans les clés, tout le code est **dormant** : seuls honeypot + rate limits
travaillent. ⚠️ Ne PAS cocher « Captcha protection » dans le dashboard
Supabase (voir Phase 3) : les logins n'envoient pas encore de token.

## 🚨 Pendant une attaque (runbook incident)

1. **Flood massif (site lent/inaccessible)** :
   `node scripts/security/attack-mode.mjs on` → challenge JS pour tout nouveau
   visiteur. Redescendre avec `off` dès l'accalmie (la WebView APK et les
   webhooks Chargily/Stripe souffrent si on le laisse).
2. **IP/plage précise** : `/admin` → Confiance → Appareils & IP
   (`admin_block_ip`, mig 0287) — bloque les pages de login instantanément.
3. **Diagnostic** : requêtes SQL ci-dessus sur `security_events` + logs Vercel.
4. **Inscriptions massives passées** : les comptes sont en attente de
   validation (commerçant/livreur/chauffeur/agent) → purge côté admin ; le
   moteur anti-fraude (mig 0373) score aussi les nouveaux comptes.

## Phase 2 — proxy Cloudflare (recommandé AVANT l'ouverture publique)

Le domaine est déjà chez Cloudflare (registrar + DNS) mais en **DNS-only** :
aucune protection Cloudflare n'est active. Basculer en proxy (nuage orange)
apporte gratuitement : anti-DDoS L7 managé, 5 règles WAF, 1 règle de rate
limiting edge, Bot Score de base. Étapes exactes :

1. SSL/TLS → mode **Full (strict)** — OBLIGATOIRE avant d'orangir, sinon
   boucle de redirection avec Vercel.
2. Speed → **désactiver Rocket Loader** ; ne PAS activer Mirage/Email
   obfuscation (injection de scripts = mismatch d'hydratation React #418 vécu).
3. DNS : passer `coligo.app` + `commercant.coligo.app` (+ www) en proxy 🟠.
   Laisser tout sous-domaine Supabase/externe intact.
4. WAF → règle de rate limiting edge (ex. > 300 req/10 s par IP → block 10 s).
   **Exclure** `/api/chargily*` et `/api/stripe*` de toute règle à challenge
   (les webhooks ne résolvent pas un challenge).
5. **Ne PAS activer Bot Fight Mode** (non scopable : il challengerait les
   webhooks et la WebView APK).
6. Vérifier : paiement Chargily test, login APK, Realtime (direct Supabase,
   non affecté), `scripts/_shot-header.mjs`.

Pour que je l'applique moi-même : créer un token API Cloudflare
(_My Profile → API Tokens_, modèle « Edit zone settings » + WAF sur la zone
coligo.app) et le coller dans `.env.local` sous `CLOUDFLARE_API_TOKEN=`.

## Phase 3 — captcha GoTrue (ferme le dernier trou théorique)

Aujourd'hui un attaquant qui extrait la clé anon (publique par nature) peut
appeler **directement** l'API Supabase Auth en contournant le site. Il reste
borné par les rate limits IP natifs de GoTrue (sur SON IP réelle) et ne crée
que des lignes `auth.users` orphelines (les profils métier passent par nos
actions), mais pour fermer complètement :

1. Ajouter `<TurnstileField />` + transmission du token aux **6 logins** et au
   flux OTP du PIN Coligo Pay (`signInWithOtp`/`verifyOtp`).
2. Ensuite seulement : dashboard Supabase → Auth → _Enable Captcha
   protection_ (provider Turnstile + secret) — GoTrue exigera alors un token
   valide pour **tout** signup/login/reset, même en appel direct.

## Non activé volontairement (décisions à prendre plus tard)

- **Leaked password protection (HIBP)** et politique de complexité Supabase :
  bloquerait « 123456 » à l'inscription — friction produit à arbitrer.
- **CSP stricte** : exige un audit nonce complet (GA4, Tawk, Firebase,
  Turnstile) — chantier séparé.
- **Play Integrity / App Attest** : attestation forte « c'est bien notre APK »
  (le cookie `coligo_native` n'est qu'un marqueur d'UA falsifiable). À faire si
  l'abus se déplace vers l'émulation d'app.
