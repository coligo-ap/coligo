"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, MapPin, ShoppingCart, User } from "lucide-react";
import { Logo } from "@/components/shared/logo";
import { WILAYAS } from "@/lib/config/wilayas";
import { APP_THEMES, type AppThemeKey } from "@/lib/config/app-themes";
import { cn } from "@/lib/utils";
import {
  LOCATION_PICKER_OPEN_EVENT,
  useCustomerLocation,
} from "@/lib/customer/location-store";
import { useCart, totalUnits } from "@/lib/customer/cart-store";
import { LocationPicker } from "@/components/customer/location-picker";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { ThemeSwitcher } from "@/components/shared/theme-switcher";
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
  const cart = useCart();
  const cartCount = totalUnits(cart);
  const [pickerOpen, setPickerOpen] = useState(false);

  // D'autres écrans (état vide de la home…) ouvrent LA MÊME feuille de
  // position que le header via cet événement — une seule UX de changement
  // de zone dans toute l'app.
  useEffect(() => {
    const onOpen = () => setPickerOpen(true);
    window.addEventListener(LOCATION_PICKER_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(LOCATION_PICKER_OPEN_EVENT, onOpen);
  }, []);

  const wilayaLabel = loc?.wilaya_code
    ? (WILAYAS.find((w) => w.code === loc.wilaya_code)?.name ??
      `Wilaya ${loc.wilaya_code}`)
    : t("chooseZone");

  // Si le client a confirmé une POSITION EXACTE (GPS ou repère carte), on
  // affiche son adresse précise telle quelle → il voit que sa vraie position
  // est prise en compte. Sinon on retombe sur « wilaya · commune ».
  const exactAddress = loc?.address?.trim() ? loc.address.trim() : null;

  // Le client a-t-il DÉJÀ une zone ? Tant que non, le header ne joue pas à
  // « Livrer à … rien » : il affiche un APPEL À L'ACTION sur une seule ligne.
  const hasZone = !!(exactAddress || loc?.wilaya_code);

  // Libellé de zone — UNE seule source pour le téléphone et l'ordinateur.
  const zoneLabel = exactAddress ?? (
    <>
      {wilayaLabel}
      {loc?.commune && (
        <span className={themed ? "text-white/70" : "text-muted"}>
          {" "}
          · {loc.commune}
        </span>
      )}
    </>
  );

  // Pastille d'action ronde du header téléphone (cloche, panier) — même
  // gabarit pour toutes : 38px, plat, fond doux (ou verre sur header thémé).
  const pillClass = cn(
    "relative grid size-[38px] place-items-center rounded-full transition-colors",
    themed
      ? "bg-white/15 text-white hover:bg-white/25 active:bg-white/30"
      : "bg-surface-2 text-foreground hover:bg-surface-3 active:bg-surface-3"
  );

  return (
    <>
      <header
        className={cn(
          "sticky top-0 z-30 pt-[env(safe-area-inset-top)]",
          themed ? "text-white" : "border-border border-b bg-white"
        )}
        style={tp ? { backgroundColor: tp.g1 } : undefined}
      >
        {/* ================================ DESKTOP ==========================
            TROIS COLONNES `1fr · auto · 1fr` : les deux colonnes latérales se
            partagent EXACTEMENT le reste de la barre, donc la zone (colonne du
            milieu) est posée au CENTRE VRAI du header — plus au petit bonheur
            de la largeur du logo. Si l'adresse devient trop longue, sa colonne
            mange la place disponible puis tronque (min-w-0), au lieu de pousser
            les actions hors écran. */}
        <div className="mx-auto hidden h-16 max-w-[1400px] grid-cols-[1fr_auto_1fr] items-center gap-4 px-6 lg:grid">
          {/* Gauche — navigation + marque. PAS de `min-w-0` sur les colonnes
              latérales : elles gardent le plancher de leur contenu, donc une
              adresse à rallonge tronque au lieu d'écraser le logo. */}
          <div className="flex items-center gap-3">
            {/* Drawer de navigation (desktop : remplace la bottom-nav absente). */}
            <CustomerDrawer hiddenKeys={hiddenKeys} />

            <Link href="/" className="shrink-0">
              <Logo variant="amber" size="md" />
            </Link>

            {/* Lien MARKETING, rangé à GAUCHE avec la marque (et plus au
                milieu des actions du compte) : c'est ce qui rééquilibre les
                deux colonnes latérales, donc ce qui pose vraiment la zone au
                centre. Masqué sous 1280 px, où la place manque. */}
            <Link
              href="/login"
              className={cn(
                // `whitespace-nowrap` : sans lui le libellé passait à la ligne
                // dès 1440 px (« Devenir / commerçant ») et faisait grandir la
                // colonne, donc bouger le centre.
                "ms-1 hidden text-sm font-medium whitespace-nowrap xl:inline",
                themed
                  ? "text-white/85 hover:text-white"
                  : "text-muted hover:text-foreground"
              )}
            >
              {t("becomeMerchant")}
            </Link>
          </div>

          {/* Centre — LA ZONE. Puce plate (fond doux + bordure), légende
              « Livrer à » en petit devant l'adresse en gras : d'un coup d'œil
              on sait CE QUE veut dire l'adresse affichée. */}
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            aria-label={t("deliverTo")}
            aria-haspopup="dialog"
            aria-expanded={pickerOpen}
            className={cn(
              "rounded-control inline-flex min-w-0 items-center gap-2 border px-3.5 py-2 text-sm transition-colors",
              themed
                ? "border-white/25 hover:bg-white/10 active:bg-white/20"
                : "border-border bg-surface-2 hover:bg-surface-3 active:bg-surface-3"
            )}
          >
            <MapPin
              className={cn(
                "size-4 shrink-0",
                themed ? "text-white" : "text-primary-600"
              )}
            />
            {/* La légende n'a de sens que s'il Y A une adresse derrière. */}
            {hasZone && (
              <span
                className={cn(
                  "text-caption shrink-0 font-bold tracking-wide uppercase",
                  themed ? "text-white/70" : "text-muted"
                )}
              >
                {t("deliverTo")}
              </span>
            )}
            {/* Pas encore de zone → le libellé passe en ACCENT (même signal
                que sur téléphone) : c'est un appel à l'action, pas une donnée. */}
            <span
              className={cn(
                "max-w-[280px] min-w-0 truncate font-bold",
                !hasZone && !themed && "text-primary-600"
              )}
            >
              {zoneLabel}
            </span>
            <ChevronDown
              className={cn(
                "size-3.5 shrink-0",
                themed ? "text-white/70" : "text-muted"
              )}
            />
          </button>

          {/* Droite — actions du COMPTE uniquement (langue, thème, cloche,
              panier, profil) : une colonne homogène de contrôles, aucun lien
              éditorial au milieu. */}
          <div className="flex items-center justify-end gap-1.5">
            {/* Sur fond thémé, déclencheurs en blanc (prop explicite — les
                MENUS en portal restent normaux). */}
            <LanguageSwitcher onColor={themed} />
            <ThemeSwitcher onColor={themed} />

            {isAuth && (
              <NotificationBell
                source={{ table: "user_notifications", audience: "customer" }}
                className={cn(
                  "rounded-full p-2 transition-colors",
                  themed ? "text-white hover:bg-white/10" : "hover:bg-surface-2"
                )}
                iconClassName="size-5"
              />
            )}

            <Link
              href="/cart"
              className={cn(
                "relative rounded-full p-2 transition-colors",
                themed ? "hover:bg-white/10" : "hover:bg-surface-2"
              )}
              aria-label={t("cart")}
            >
              <ShoppingCart className="size-5" />
              {cartCount > 0 && (
                <span className="bg-success-600 text-micro absolute top-0 right-0 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 font-bold text-white">
                  {cartCount}
                </span>
              )}
            </Link>

            {isAuth ? (
              <Link
                href="/compte"
                aria-label={t("myAccount")}
                className="hover:bg-surface-2 rounded-full p-1 transition-colors"
              >
                <span className="bg-primary-100 text-primary-700 flex size-9 items-center justify-center rounded-full text-sm font-extrabold">
                  {(customerName ?? "C").charAt(0).toUpperCase()}
                </span>
              </Link>
            ) : (
              <Link
                href="/se-connecter"
                className={cn(
                  "rounded-control inline-flex items-center gap-2 px-4 py-2 text-sm font-bold transition-colors",
                  themed
                    ? "text-primary-700 bg-white hover:bg-white/90"
                    : "bg-primary-600 hover:bg-primary-700 text-white"
                )}
              >
                <User className="size-4" />
                {t("signIn")}
              </Link>
            )}
          </div>
        </div>

        {/* ================================ MOBILE ===========================
            Barre de 56px en TROIS COLONNES `1fr · auto · 1fr` :

              [ marque ]        [ Livrer à / adresse ⌄ ]        [ 🔔  🛒 ]

            Les deux colonnes latérales se partagent EXACTEMENT le reste de la
            largeur : la zone est donc au CENTRE VRAI de la barre, quelle que
            soit la largeur de la marque à gauche ou du nombre d'actions à
            droite (visiteur = pas de cloche). Elle porte `min-w-0` : une
            adresse exacte longue prend toute la place restante puis tronque,
            au lieu de pousser la cloche et le panier hors de l'écran.

            La zone est en DEUX LIGNES (style Bolt Food) : une légende minuscule
            « Livrer à » + l'adresse en gras — on comprend enfin à quoi sert
            cette adresse, alors qu'elle flottait seule avant.

            La LANGUE et le MODE SOMBRE ne sont plus ici : ils vivent dans
            « Compte › Préférences » (et sur les écrans de connexion pour un
            visiteur). Le header DESKTOP les garde : il est large, et c'est lui
            qui fait toute la navigation au-dessus de `lg`. Le COMPTE non plus :
            l'onglet « Compte » de la barre du bas y mène déjà. */}
        <div className="lg:hidden">
          <div className="relative flex h-14 items-center px-3">
            {/* Marque — retour à l'accueil d'un tap depuis n'importe quel
                écran client. Sur header thémé, la tuile passe en verre pour ne
                pas poser du violet sur du violet. */}
            <Link href="/" aria-label="Coligo" className="shrink-0">
              <Logo
                iconOnly
                size="sm"
                className={themed ? "bg-white/15" : undefined}
              />
            </Link>

            {/* ZONE — CENTRÉE AU PIXEL, en position absolue avec des
                GOUTTIÈRES SYMÉTRIQUES (`paddingInline`) larges comme le plus
                gros bloc latéral.

                Pourquoi pas une grille `1fr auto 1fr` : ces colonnes ne se
                partagent le reste à égalité que TANT QU'il reste de la place.
                Dès qu'une adresse exacte remplit la barre (320 px), la colonne
                de droite (cloche + panier) force son plancher, la gauche
                s'écrase, et le bloc part 25 px à côté du centre. Ici le centre
                ne dépend plus du contenu des côtés : il est centré, point — et
                il ne bouge PAS quand la cloche apparaît à la connexion.

                Gouttière = bloc le plus large + 6 px d'air : connecté
                12+38+6+38 = 94 → 100 ; visiteur (panier seul) 12+38 = 50 → 56,
                ce qui laisse l'adresse respirer quand il y a moins d'icônes. */}
            <div
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
              style={{ paddingInline: isAuth ? 100 : 56 }}
            >
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                aria-label={t("deliverTo")}
                aria-haspopup="dialog"
                aria-expanded={pickerOpen}
                className={cn(
                  // h-11 : 44 px de cible tactile dans une barre de 56 px.
                  // CHIP à fond doux (même langage que la puce du desktop) :
                  // le bloc central se LIT comme un contrôle, pas comme du
                  // texte décoratif — c'est le geste n°1 du marketplace.
                  "rounded-control pointer-events-auto flex h-11 max-w-full min-w-0 flex-col items-center justify-center gap-1 px-3 leading-none transition-colors",
                  themed
                    ? "bg-white/12 active:bg-white/25"
                    : "bg-surface-2 active:bg-surface-3"
                )}
              >
                {hasZone ? (
                  <>
                    {/* Ligne 1 — la LÉGENDE porte le chevron : la ligne 2 garde
                        alors TOUTE la largeur pour l'adresse. */}
                    <span
                      className={cn(
                        "text-caption flex items-center gap-0.5 font-bold tracking-wide uppercase",
                        themed ? "text-white/70" : "text-muted"
                      )}
                    >
                      {t("deliverTo")}
                      <ChevronDown className="size-3.5 shrink-0" />
                    </span>
                    {/* Ligne 2 — l'adresse, pleine largeur. Pas d'épingle ici :
                        la légende dit déjà de quoi il s'agit, et les 20 px
                        gagnés vont au texte utile. */}
                    <span className="max-w-full min-w-0 truncate text-sm font-extrabold">
                      {zoneLabel}
                    </span>
                  </>
                ) : (
                  /* Aucune zone encore choisie → pas de « Livrer à … rien » :
                     une seule ligne, en appel à l'action. */
                  <span
                    className={cn(
                      "flex max-w-full min-w-0 items-center gap-1 text-sm font-extrabold",
                      themed ? "text-white" : "text-primary-600"
                    )}
                  >
                    <MapPin className="size-4 shrink-0" />
                    <span className="min-w-0 truncate">{zoneLabel}</span>
                    <ChevronDown className="size-3.5 shrink-0" />
                  </span>
                )}
              </button>
            </div>

            {/* Actions — notifications · panier, RIEN d'autre. */}
            <div className="ms-auto flex shrink-0 items-center gap-1.5">
              {isAuth && (
                <NotificationBell
                  source={{ table: "user_notifications", audience: "customer" }}
                  className={pillClass}
                />
              )}
              <Link href="/cart" aria-label={t("cart")} className={pillClass}>
                <ShoppingCart className="size-[18px]" />
                {cartCount > 0 && (
                  <span className="bg-success-600 text-nano absolute -top-0.5 -right-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 font-bold text-white">
                    {cartCount}
                  </span>
                )}
              </Link>
            </div>
          </div>
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
