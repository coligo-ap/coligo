-- =============================================================================
-- 0334 — DURCISSEMENT STORAGE : allowlist MIME + taille sur TOUS les buckets
-- =============================================================================
-- Audit 06/07/2026 : 6 buckets acceptaient N'IMPORTE QUEL type de fichier
-- (dont 4 PUBLICS : products, delivery-proofs, driver-avatars,
-- category-filters) → un utilisateur authentifié pouvait y déposer du
-- text/html ou un script servi publiquement (phishing / XSS hébergé).
-- `merchant-logos` acceptait de plus image/svg+xml — un SVG peut embarquer
-- <script> (XSS à l'ouverture directe) → retiré.
--
-- Règles :
--   • chaque bucket n'accepte QUE les types nécessaires à son usage ;
--   • taille bornée partout ;
--   • jamais de SVG (vecteur XSS), jamais de text/html ni d'exécutable ;
--   • les Server Actions vérifient EN PLUS la signature binaire réelle
--     (lib/security/file-validation.ts) — le type déclaré par le client
--     n'est jamais la source de vérité.
-- L'allowlist ne s'applique qu'aux NOUVEAUX uploads (l'existant est conservé).
-- =============================================================================

-- Images produits (public, lu sur toutes les vitrines).
UPDATE storage.buckets SET
  allowed_mime_types = ARRAY['image/png','image/jpeg','image/webp'],
  file_size_limit    = 5 * 1024 * 1024
WHERE id = 'products';

-- Vignettes catégories/filtres éditoriaux (public, écrit par le super-admin).
UPDATE storage.buckets SET
  allowed_mime_types = ARRAY['image/png','image/jpeg','image/webp'],
  file_size_limit    = 3 * 1024 * 1024
WHERE id = 'category-filters';

-- Preuves de livraison (photos livreur).
UPDATE storage.buckets SET
  allowed_mime_types = ARRAY['image/png','image/jpeg','image/webp'],
  file_size_limit    = 8 * 1024 * 1024
WHERE id = 'delivery-proofs';

-- Avatars livreurs (public).
UPDATE storage.buckets SET
  allowed_mime_types = ARRAY['image/png','image/jpeg','image/webp'],
  file_size_limit    = 3 * 1024 * 1024
WHERE id = 'driver-avatars';

-- Documents livreurs/chauffeurs (privé) : images + PDF.
UPDATE storage.buckets SET
  allowed_mime_types = ARRAY['image/png','image/jpeg','image/webp','application/pdf'],
  file_size_limit    = 10 * 1024 * 1024
WHERE id = 'driver-docs';

-- Logos commerçants : RETRAIT du SVG (XSS). Les logos existants restent servis.
UPDATE storage.buckets SET
  allowed_mime_types = ARRAY['image/png','image/jpeg','image/webp']
WHERE id = 'merchant-logos';

-- Distribution APK (/telecharger) : APK uniquement (+ octet-stream, type
-- couramment envoyé par les outils d'upload pour un .apk), taille bornée.
UPDATE storage.buckets SET
  allowed_mime_types = ARRAY['application/vnd.android.package-archive','application/octet-stream'],
  file_size_limit    = 300 * 1024 * 1024
WHERE id = 'app-downloads';
