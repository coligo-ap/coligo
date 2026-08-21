"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, MapPin, ShoppingCart, User } from "lucide-react";
import { Logo } from "@/components/shared/logo";
import { WILAYAS } from "@/lib/config/wilayas";
import { APP_THEMES, type AppThemeKey } from "@/lib/config/app-themes";
import { cn } from "@/lib/utils";
import {
  LOCATION_PICKER_OPEN_EVENT,
  useCustomerLocation,
  useLocationResolving,
} from "@/lib/customer/location-store";
import { useCart, totalUnits } from "@/lib/customer/cart-store";
import { LocationPicker } from "@/components/customer/location-picker";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { NotificationBell } from "@/components/shared/notification-bell";
import { CustomerDrawer } from "@/components/customer/customer-drawer";

type Props = {
  isAuth: boolean;
  customerName?: string | null;
  /** Onglets masqués par le super-admin (drive/pay) — repris dans le drawer. */
  hiddenKeys?: string[];
  /**
   * Thème « occasion » de l'accueil (mig 0415/0416, activé par le super-admin).
   * Appliqué UNIQUEMENT sur la route « / » : le header se peint en g1 uni et
   * forme un seul bloc avec le héro dégradé de la home. Ailleurs : blanc.
   */
  homeTheme?: { theme: AppThemeKey } | null;
};

export function CustomerHeader({
  isAuth,
  customerName,
  hiddenKeys = [],
  homeTheme = null,
}: Props) {
  const t = useTranslations("header");
  const pathname = usePathname();
  // Coque PERSISTANTE : le même header sert toutes les routes client — le
  // thème ne s'applique que sur l'accueil.
  const themed = !!homeTheme && pathname === "/";
  const tp = themed ? APP_THEMES[homeTheme.theme] : null;
  const loc = useCustomerLocation();
  // Détection de la position à l'ouverture de l'app : tant qu'elle tourne, le
  // header n'affiche PAS l'ancienne adresse (le client a pu changer de ville
  // depuis) — il annonce la détection en cours.
  const locResolving = useLocationResolving();
  const cart = useCart();
  const cartCount = totalUnits(cart);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Gouttières du bloc d'emplacement MOBILE, mesurées sur les blocs latéraux
  // RÉELS (16 px de marge du conteneur + bloc + 6 px d'air). Mesurer plutôt que
  // figer : quand la cloche est absente (aucune notification), l'adresse
  // récupère sa place — et elle la rend à l'instant où la cloche apparaît
  // (Realtime), le ResizeObserver voit le bloc grossir. Valeurs initiales =
  // l'estimation statique (identiques serveur/client, pas d'écart d'hydratation).
  const sideStartRef = useRef<HTMLDivElement | null>(null);
  const sideEndRef = useRef<HTMLDivElement | null>(null);
  const [gutters, setGutters] = useState({ start: 133, end: 60 });
  useEffect(() => {
    const measure = () => {
      const s = sideStartRef.current?.offsetWidth ?? 0;
      const e = sideEndRef.current?.offsetWidth ?? 0;
      if (s > 0 && e > 0) setGutters({ start: 16 + s + 6, end: 16 + e + 6 });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (sideStartRef.current) ro.observe(sideStartRef.current);
    if (sideEndRef.current) ro.observe(sideEndRef.current);
    return () => ro.disconnect();
  }, []);

  // D'autres écrans (état vide de la home…) ouvrent LA MÊME feuille de
  // position que le header via cet événement — une seule UX de changement
  // de zone dans toute l'app.
  useEffect(() => {
    const onOpen = () => setPickerOpen(true);
    window.addEventListener(LOCATION_PICKER_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(LOCATION_PICKER_OPEN_EVENT, onOpen);
  }, []);

  const wilayaLabel = locResolving
    ? t("locating")
    : loc?.wilaya_code
      ? (WILAYAS.find((w) => w.code === loc.wilaya_code)?.name ??
        `Wilaya ${loc.wilaya_code}`)
      : t("chooseZone");

  // Si le client a confirmé une POSITION EXACTE (GPS ou repère carte), on
  // affiche son adresse précise telle quelle → il voit que sa vraie position
  // est prise en compte. Sinon on retombe sur « wilaya · commune ».
  const exactAddress =
    !locResolving && loc?.address?.trim() ? loc.address.trim() : null;

  return (
    <>
      <header
        className={cn(
          "sticky top-0 z-30 pt-[env(safe-area-inset-top)]",
          // Téléphone : le filet est INSÉRÉ dans la barre (maquette v2), il ne
          // touche pas les bords — il est rendu sous la rangée mobile.
          themed ? "text-white" : "border-border bg-white lg:border-b"
        )}
        style={tp ? { backgroundColor: tp.g1 } : undefined}
      >
        {/* Desktop — MÊME barre qu'avant, seules les PLACES changent : trois
            colonnes `1fr · auto · 1fr` pour que la zone tombe au centre vrai.
            « Devenir commerçant » passe à gauche avec la marque : c'est ce qui
            égalise les deux côtés, sans quoi la colonne d'actions déborde de sa
            moitié et repousse le centre. */}
        <div className="mx-auto hidden h-16 max-w-[1400px] grid-cols-[1fr_auto_1fr] items-center gap-4 px-6 lg:grid">
          <div className="flex items-center gap-4">
            {/* Drawer de navigation (desktop : remplace la bottom-nav absente). */}
            <CustomerDrawer hiddenKeys={hiddenKeys} />

            <Link href="/" className="shrink-0">
              <Logo variant="amber" size="md" onColor={themed} />
            </Link>

            <Link
              href="/login"
              className={cn(
                // `whitespace-nowrap` : sans lui le libellé passe à la ligne
                // vers 1440 px, la colonne grossit et le centre se décale.
                "hidden text-sm font-medium whitespace-nowrap xl:inline",
                themed
                  ? "text-white/85 hover:text-white"
                  : "text-muted hover:text-foreground"
              )}
            >
              {t("becomeMerchant")}
            </Link>
          </div>

          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            aria-label={t("deliverTo")}
            aria-haspopup="dialog"
            aria-expanded={pickerOpen}
            className={cn(
              "rounded-control inline-flex min-w-0 items-center gap-2 border px-3 py-2 text-sm",
              themed
                ? "border-white/25 hover:bg-white/10"
                : "hover:bg-surface-2 border-border"
            )}
          >
            <MapPin
              className={cn(
                "size-4 shrink-0",
                themed ? "text-white" : "text-primary-600"
              )}
            />
            <span className="max-w-[220px] min-w-0 truncate font-medium">
              {exactAddress ?? (
                <>
                  {wilayaLabel}
                  {!locResolving && loc?.commune && (
                    <span className={themed ? "text-white/70" : "text-muted"}>
                      {" "}
                      · {loc.commune}
                    </span>
                  )}
                </>
              )}
            </span>
            <ChevronDown
              className={cn(
                "size-3.5 shrink-0",
                themed ? "text-white/70" : "text-muted"
              )}
            />
          </button>

          {/* Colonne de droite. La LUNE n'est plus ici (décision produit du
              10/08/2026) : l'app s'ouvre toujours en clair, le mode sombre se
              choisit dans Compte › Préférences. */}
          <div className="flex items-center justify-end gap-4">
            {/* Sur fond thémé, déclencheur en blanc (prop explicite — les
                MENUS en portal restent normaux). */}
            <LanguageSwitcher onColor={themed} />

            {isAuth && (
              <NotificationBell
                source={{ table: "user_notifications", audience: "customer" }}
                // Aucune notification → aucune cloche : elle n'ouvrirait qu'un
                // écran vide. Elle apparaît à la première reçue et reste.
                hideWhenEmpty
                className={cn(
                  "rounded-full p-2",
                  themed ? "text-white hover:bg-white/10" : "hover:bg-surface-2"
                )}
                iconClassName="size-5"
              />
            )}

            <Link
              href="/cart"
              className={cn(
                "relative rounded-full p-2",
                themed ? "hover:bg-white/10" : "hover:bg-surface-2"
              )}
              aria-label={t("cart")}
            >
              <ShoppingCart className="size-5" />
              {cartCount > 0 && (
                <span className="bg-primary-600 text-micro absolute -top-0.5 -right-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 font-bold text-white">
                  {cartCount}
                </span>
              )}
            </Link>

            {isAuth ? (
              <Link
                href="/compte"
                className="hover:bg-surface-2 inline-flex items-center gap-2 rounded-full p-1 text-sm"
              >
                <div className="bg-primary-100 text-primary-700 flex size-9 items-center justify-center rounded-full text-sm font-semibold">
                  {(customerName ?? "C").charAt(0).toUpperCase()}
                </div>
              </Link>
            ) : (
              <Link
                href="/se-connecter"
                className={cn(
                  "rounded-control inline-flex items-center gap-2 px-4 py-2 text-sm font-medium",
                  themed
                    ? "bg-white text-neutral-900 hover:bg-white/90"
                    : "bg-primary-600 hover:bg-primary-700 text-white"
                )}
              >
                <User className="size-4" />
                {t("signIn")}
              </Link>
            )}
          </div>
        </div>

        {/* MOBILE — zone · langue · thème · notifications · panier : les MÊMES
            éléments qu'avant, avec les mêmes styles. Seules les PLACES
            changent — langue + thème passent à gauche, cloche + panier restent
            à droite, et l'emplacement se pose au MILIEU.

            Le COMPTE n'est toujours PAS ici : l'onglet « Compte » de la barre
            du bas y mène déjà (et /compte renvoie un visiteur vers la
            connexion) — deux portes pour la même pièce. Le header DESKTOP le
            garde : il n'y a pas de barre du bas au-dessus de `lg`, c'est lui
            qui fait la navigation. */}
        <div className="lg:hidden">
          <div className="relative flex items-center gap-2 px-4 py-3">
            {/* Gauche — langue seule. La LUNE est partie dans Compte ›
                Préférences (décision produit du 10/08/2026 : l'app s'ouvre
                toujours en clair) — et l'espace libéré revient à l'adresse
                via les gouttières mesurées. */}
            <div
              ref={sideStartRef}
              className="flex shrink-0 items-center gap-2"
            >
              <LanguageSwitcher compact framed={!themed} onColor={themed} />
            </div>

            {/* CENTRE — l'emplacement, posé en absolu entre les deux blocs
                latéraux, avec des gouttières MESURÉES en direct (ResizeObserver
                sur chaque bloc). Tout l'espace libre va donc à l'adresse : pas
                de cloche (aucune notification) = ~40 px de plus pour le texte,
                et l'agrandissement de police système est absorbé aussi (les
                blocs mesurés grossissent, les gouttières suivent). Une grille
                `1fr auto 1fr` ne suffirait pas : dès qu'une adresse remplit la
                barre, le côté le plus large force son plancher, l'autre
                s'écrase, et le bloc chevauche les contrôles. Ici le bouton se
                centre entre les contrôles et ne les touche jamais. */}
            <div
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
              style={{
                paddingInlineStart: gutters.start,
                paddingInlineEnd: gutters.end,
              }}
            >
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                aria-label={t("deliverTo")}
                aria-haspopup="dialog"
                aria-expanded={pickerOpen}
                className="pointer-events-auto flex max-w-full min-w-0 items-center gap-2 text-start"
              >
                <MapPin
                  className={cn(
                    "size-4 shrink-0",
                    themed ? "text-white" : "text-primary-600"
                  )}
                />
                <span className="min-w-0 truncate text-sm font-medium">
                  {exactAddress ?? (
                    <>
                      {wilayaLabel}
                      {!locResolving && loc?.commune && (
                        <span
                          className={themed ? "text-white/70" : "text-muted"}
                        >
                          {" "}
                          · {loc.commune}
                        </span>
                      )}
                    </>
                  )}
                </span>
                <ChevronDown
                  className={cn(
                    "size-3.5 shrink-0",
                    themed ? "text-white/70" : "text-muted"
                  )}
                />
              </button>
            </div>

            {/* Droite — notifications + panier. */}
            <div
              ref={sideEndRef}
              className="ms-auto flex shrink-0 items-center gap-2"
            >
              {isAuth && (
                <NotificationBell
                  source={{ table: "user_notifications", audience: "customer" }}
                  // Idem téléphone : pas de cloche sans notification. Le bloc
                  // d'actions est `ms-auto`, donc le panier reste collé à
                  // droite — rien ne bouge quand la cloche apparaît.
                  hideWhenEmpty
                  className={cn(
                    "grid size-[38px] place-items-center rounded-full",
                    themed
                      ? "bg-white/15 text-white"
                      : "bg-surface-2 text-foreground"
                  )}
                />
              )}
              <Link
                href="/cart"
                aria-label={t("cart")}
                className={cn(
                  "relative grid size-[38px] place-items-center rounded-full",
                  themed
                    ? "bg-white/15 text-white"
                    : "bg-surface-2 text-foreground"
                )}
              >
                <ShoppingCart className="size-[18px]" />
                {cartCount > 0 && (
                  <span className="bg-primary-600 text-nano absolute -top-0.5 -right-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full border-2 border-white px-1 font-bold text-white">
                    {cartCount}
                  </span>
                )}
              </Link>
            </div>
          </div>
          {/* Filet INSÉRÉ (maquette v2) : il s'arrête aux gouttières de la
              page, il ne file pas d'un bord à l'autre. */}
          {!themed && <div className="border-border mx-4 border-b" />}
          {/* Search bar mobile : retirée du header — désormais sur la home
              (sticky sous le header). */}
        </div>
      </header>

      {pickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPickerOpen(false);
          }}
        >
          <div
            className="bg-surface flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-t-xl pb-[env(safe-area-inset-bottom)] sm:max-h-[90vh] sm:rounded-xl"
            style={{
              paddingBottom: "calc(0px + env(safe-area-inset-bottom))",
            }}
          >
            <div className="overflow-y-auto overscroll-contain px-5 pt-5 pb-5">
              <LocationPicker
                initial={loc}
                onClose={() => setPickerOpen(false)}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
