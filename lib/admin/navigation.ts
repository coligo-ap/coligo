import {
  Banknote,
  BarChart3,
  Bell,
  Bike,
  Boxes,
  Building2,
  Car,
  ClipboardCheck,
  Crown,
  FileSignature,
  Fingerprint,
  FolderOpen,
  Gauge,
  Image as ImageIcon,
  LayoutDashboard,
  ListOrdered,
  Map,
  Megaphone,
  Percent,
  QrCode,
  Radar,
  Receipt,
  Route,
  ScanBarcode,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Store,
  Tag,
  Ticket,
  Truck,
  UserCog,
  Users,
  Wallet,
} from "lucide-react";
import type { AlertDomain } from "@/lib/alerts/alert-model";

// =============================================================================
// SUPER ADMIN — LE PLAN DE LA MAISON, écrit UNE SEULE FOIS.
//
// Avant : les 8 domaines vivaient dans la barre latérale, et leurs sous-pages
// dans 8 listes d'onglets codées à part. Résultat : pour savoir que « Pass
// Prioritaire » existe, il fallait déjà être entré dans le bon hub. Une
// fonctionnalité qu'on ne voit pas est une fonctionnalité qui n'existe pas.
//
// Ici, l'arborescence COMPLÈTE est décrite une fois — domaine › section › page —
// et tout en découle : le tiroir (deux niveaux), les onglets de chaque hub, le
// fil d'Ariane, et la RECHERCHE (⌘K) qui amène n'importe quelle page en deux
// touches. Ajouter une page = une ligne ici, et elle apparaît partout.
//
// Les URLs ne bougent PAS : c'est une couche de navigation, pas un déménagement.
// Les anciennes routes (/admin/agents, /admin/recharges, /admin/notifications…)
// continuent de répondre ; simplement, chaque fonctionnalité n'est plus listée
// qu'à UN seul endroit — celui où on la cherche.
// =============================================================================

export type AdminNavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Actif seulement sur l'URL exacte (racines de hub). */
  exact?: boolean;
  /** Porte le compteur « à traiter » du hub (inscriptions en attente,
   *  commandes en retard…). */
  pending?: boolean;
  /** Réservé au propriétaire (le staff ne la voit pas — la vraie barrière
   *  reste serveur). */
  ownerOnly?: boolean;
  /** Mots que l'utilisateur pourrait taper pour trouver cette page. */
  keywords?: string[];
  /** SOUS-PAGES (3ᵉ niveau) : elles vivent DANS cette page et ont leur propre
   *  sous-navigation (ex. Identité › Dossiers). Le tiroir les montre sous leur
   *  parent, la recherche les indexe — mais les onglets du hub ne les répètent
   *  pas : ce serait dire deux fois la même chose sur le même écran. */
  children?: AdminNavItem[];
};

export type AdminNavSection = {
  /** Titre de section (absent = items posés directement sous le domaine). */
  label?: string;
  items: AdminNavItem[];
};

export type AdminNavDomain = {
  key: AlertDomain;
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
  /** Préfixes hérités qui appartiennent encore au domaine (état actif). */
  match?: string[];
  sections: AdminNavSection[];
};

export const ADMIN_NAV: AdminNavDomain[] = [
  {
    key: "pilotage",
    href: "/admin",
    label: "Pilotage",
    icon: LayoutDashboard,
    exact: true,
    match: ["/admin/orders", "/admin/alertes"],
    sections: [
      {
        items: [
          {
            href: "/admin",
            label: "Vue d'ensemble",
            icon: Gauge,
            exact: true,
            keywords: ["accueil", "dashboard", "chiffres", "kpi"],
          },
          {
            href: "/admin/orders",
            label: "Commandes",
            icon: ListOrdered,
            pending: true, // commandes en retard
            keywords: ["commande", "retard", "litige", "remboursement"],
          },
          {
            href: "/admin/alertes",
            label: "Alertes",
            icon: Radar,
            keywords: ["incident", "anomalie", "surveillance"],
          },
        ],
      },
    ],
  },

  {
    key: "commercants",
    href: "/admin/merchants",
    label: "Commerçants",
    icon: Store,
    sections: [
      {
        label: "Comptes",
        items: [
          {
            href: "/admin/merchants",
            label: "Commerçants",
            icon: Building2,
            exact: true,
            keywords: ["boutique", "magasin", "restaurant", "compte"],
          },
          {
            href: "/admin/merchants/inscriptions",
            label: "Inscriptions",
            icon: ClipboardCheck,
            pending: true,
            keywords: ["validation", "en attente", "nouveau commerçant"],
          },
        ],
      },
      {
        label: "Activité",
        items: [
          {
            href: "/admin/merchants/commandes",
            label: "Commandes",
            icon: ListOrdered,
            keywords: ["ventes", "historique"],
          },
        ],
      },
      {
        label: "Argent",
        items: [
          {
            href: "/admin/merchants/finances",
            label: "Versements",
            icon: Banknote,
            keywords: ["payout", "virement", "facture", "solde"],
          },
          {
            href: "/admin/merchants/taux",
            label: "Taux & paiement",
            icon: Percent,
            keywords: ["commission", "frais de service", "en ligne"],
          },
          {
            href: "/admin/merchants/contrats",
            label: "Contrats",
            icon: FileSignature,
            keywords: ["convention", "signature", "pdf"],
          },
        ],
      },
      {
        label: "Contenu",
        items: [
          {
            href: "/admin/merchants/visuels",
            label: "Visuels",
            icon: ImageIcon,
            keywords: ["photo", "logo", "couverture", "banque d'images"],
          },
        ],
      },
    ],
  },

  {
    key: "livraison",
    href: "/admin/drivers",
    label: "Livraison",
    icon: Bike,
    match: ["/admin/livraison"],
    sections: [
      {
        label: "Comptes",
        items: [
          {
            href: "/admin/drivers",
            label: "Livreurs",
            icon: Truck,
            exact: true,
            keywords: ["coursier", "compte", "gel", "blocage"],
          },
          {
            href: "/admin/drivers/inscriptions",
            label: "Inscriptions",
            icon: ClipboardCheck,
            pending: true,
            keywords: ["kyc", "dossier", "pièces", "validation"],
          },
        ],
      },
      {
        label: "Argent",
        items: [
          {
            href: "/admin/drivers/finances",
            label: "Finances livraison",
            icon: Banknote,
            keywords: ["gains", "versement", "cod", "portefeuille"],
          },
          {
            href: "/admin/drivers/contrats",
            label: "Contrats",
            icon: FileSignature,
            keywords: ["convention", "signature"],
          },
        ],
      },
      {
        label: "Réglages",
        items: [
          {
            href: "/admin/drivers/pass-prioritaire",
            label: "Pass Prioritaire",
            icon: Crown,
            keywords: ["priorité", "abonnement livreur"],
          },
          {
            href: "/admin/drivers/parametres",
            label: "Paramètres & zones",
            icon: SlidersHorizontal,
            keywords: ["dispatch", "express", "rayon", "tarif"],
          },
        ],
      },
    ],
  },

  {
    key: "drive",
    href: "/admin/chauffeurs",
    label: "Coligo Drive",
    icon: Car,
    match: ["/admin/drive"],
    sections: [
      {
        label: "Comptes",
        items: [
          {
            href: "/admin/chauffeurs",
            label: "Chauffeurs",
            icon: Users,
            exact: true,
            keywords: ["vtc", "compte", "gel"],
          },
          {
            href: "/admin/chauffeurs/inscriptions",
            label: "Inscriptions",
            icon: ClipboardCheck,
            pending: true,
            keywords: ["dossier", "permis", "carte grise"],
          },
        ],
      },
      {
        label: "Activité",
        items: [
          {
            href: "/admin/chauffeurs/courses",
            label: "Courses",
            icon: Route,
            keywords: ["trajet", "vtc", "annulation", "no-show"],
          },
        ],
      },
      {
        label: "Argent",
        items: [
          {
            href: "/admin/chauffeurs/abonnements",
            label: "Abonnements",
            icon: Ticket,
            keywords: ["plan", "commission", "paiement chauffeur"],
          },
          {
            href: "/admin/chauffeurs/contrats",
            label: "Contrats",
            icon: FileSignature,
            keywords: ["convention", "signature"],
          },
        ],
      },
      {
        label: "Réglages",
        items: [
          {
            href: "/admin/chauffeurs/config",
            label: "Configuration Drive",
            icon: Settings2,
            keywords: ["gamme", "tarif", "prix", "classic", "confort"],
          },
          {
            href: "/admin/chauffeurs/parametres",
            label: "Paramètres & zones",
            icon: SlidersHorizontal,
            keywords: ["dispatch", "rayon", "zone"],
          },
        ],
      },
    ],
  },

  {
    key: "finances",
    href: "/admin/coligo-pay",
    label: "Coligo Pay & Finances",
    icon: Wallet,
    match: ["/admin/agents", "/admin/recharges", "/admin/versements"],
    sections: [
      {
        items: [
          {
            href: "/admin/coligo-pay",
            label: "Surveillance",
            icon: BarChart3,
            exact: true,
            keywords: ["fraude", "flux", "anomalie", "paiement qr"],
          },
        ],
      },
      {
        label: "Comptes",
        items: [
          {
            href: "/admin/coligo-pay/portefeuilles",
            label: "Portefeuilles",
            icon: Wallet,
            keywords: ["solde", "client", "opérateur", "grand livre"],
          },
          {
            href: "/admin/coligo-pay/agents",
            label: "Agents",
            icon: UserCog,
            keywords: ["agent coligo pay", "point de recharge"],
          },
          {
            href: "/admin/coligo-pay/inscriptions",
            label: "Inscriptions agents",
            icon: ClipboardCheck,
            pending: true,
            keywords: ["validation agent", "en attente"],
          },
        ],
      },
      {
        label: "Flux",
        items: [
          {
            href: "/admin/coligo-pay/recharges",
            label: "Recharges",
            icon: QrCode,
            keywords: ["créditer", "ccp", "baridimob", "chargily"],
          },
          {
            href: "/admin/coligo-pay/versements",
            label: "Versements",
            icon: Receipt,
            keywords: ["payout", "retrait", "virement"],
          },
        ],
      },
    ],
  },

  {
    key: "marketing",
    href: "/admin/marketing",
    label: "Marketing",
    icon: Megaphone,
    match: ["/admin/bannieres", "/admin/notifications"],
    sections: [
      {
        items: [
          {
            href: "/admin/marketing",
            label: "Bannières",
            icon: ImageIcon,
            exact: true,
            keywords: ["accueil client", "mise en avant", "offre"],
          },
          {
            href: "/admin/marketing/codes",
            label: "Codes promo",
            icon: Tag,
            keywords: ["réduction", "coupon", "promo"],
          },
          {
            href: "/admin/marketing/bons",
            label: "Bons d'achat",
            icon: Ticket,
            keywords: ["voucher", "cadeau", "avoir"],
          },
          {
            href: "/admin/marketing/notifications",
            label: "Notifications",
            icon: Bell,
            keywords: ["push", "campagne", "message"],
          },
        ],
      },
    ],
  },

  {
    key: "confiance",
    href: "/admin/reports",
    label: "Confiance & Sécurité",
    icon: ShieldCheck,
    match: [
      "/admin/devices",
      "/admin/security",
      "/admin/integrity",
      "/admin/identite",
      "/admin/anti-fraude",
    ],
    sections: [
      {
        label: "Traitement",
        items: [
          {
            href: "/admin/reports",
            label: "Signalements",
            icon: ShieldAlert,
            keywords: ["plainte", "litige", "abus", "no-show"],
          },
          {
            href: "/admin/anti-fraude",
            label: "Anti-fraude",
            icon: Radar,
            exact: true,
            keywords: [
              "fraude",
              "trust score",
              "risque",
              "annulation",
              "collusion",
              "commission",
            ],
            children: [
              {
                href: "/admin/anti-fraude/alertes",
                label: "Alertes fraude",
                icon: ShieldAlert,
                pending: true,
                keywords: ["examiner", "confirmer", "faux positif", "verdict"],
              },
              {
                href: "/admin/anti-fraude/comptes",
                label: "Comptes à risque",
                icon: Users,
                keywords: ["classement", "score", "investigation", "timeline"],
              },
              {
                href: "/admin/anti-fraude/regles",
                label: "Règles & réglages",
                icon: SlidersHorizontal,
                keywords: ["seuil", "poids", "apprentissage", "détecteur"],
              },
            ],
          },
          {
            href: "/admin/identite",
            label: "Vérification d'identité",
            icon: Fingerprint,
            exact: true,
            keywords: ["kyc", "idv", "selfie", "passeport", "face match"],
            children: [
              {
                href: "/admin/identite/dossiers",
                label: "Dossiers à examiner",
                icon: FolderOpen,
                pending: true,
                keywords: ["revue", "recours", "refus", "identité", "file"],
              },
            ],
          },
        ],
      },
      {
        label: "Surveillance",
        items: [
          {
            href: "/admin/devices",
            label: "Appareils & IP",
            icon: Smartphone,
            keywords: ["device", "connexion", "multi-compte"],
          },
          {
            href: "/admin/security",
            label: "Sécurité",
            icon: ShieldCheck,
            keywords: ["accès", "rls", "audit"],
          },
          {
            href: "/admin/integrity",
            label: "Intégrité des données",
            icon: Boxes,
            keywords: ["invariant", "cohérence", "trésorerie"],
          },
        ],
      },
    ],
  },

  {
    key: "plateforme",
    href: "/admin/controle",
    label: "Plateforme",
    icon: Settings2,
    match: [
      "/admin/settings",
      "/admin/config",
      "/admin/zones",
      "/admin/categories",
      "/admin/codes-barres",
      "/admin/admins",
    ],
    sections: [
      {
        label: "Services",
        items: [
          {
            href: "/admin/controle",
            label: "Contrôle des services",
            icon: SlidersHorizontal,
            exact: true,
            keywords: ["kill switch", "activer", "désactiver", "drapeau"],
          },
        ],
      },
      {
        label: "Réglages",
        items: [
          {
            href: "/admin/settings",
            label: "Taux de la plateforme",
            icon: Percent,
            keywords: ["commission", "frais", "tva"],
          },
          {
            href: "/admin/config",
            label: "Configuration",
            icon: Settings2,
            keywords: ["paramètre", "clé", "chargily", "mode test"],
          },
        ],
      },
      {
        label: "Référentiels",
        items: [
          {
            href: "/admin/zones",
            label: "Zones de service",
            icon: Map,
            keywords: ["wilaya", "couverture", "rayon"],
          },
          {
            href: "/admin/categories",
            label: "Catégories",
            icon: Tag,
            keywords: ["filtre", "commerçant", "vitrine"],
          },
          {
            href: "/admin/codes-barres",
            label: "Codes-barres",
            icon: ScanBarcode,
            keywords: ["ean", "scan", "produit", "catalogue"],
          },
        ],
      },
      {
        label: "Accès",
        items: [
          {
            href: "/admin/admins",
            label: "Équipe Coligo",
            icon: UserCog,
            ownerOnly: true,
            keywords: ["admin", "droits", "rôle", "domaine"],
          },
        ],
      },
    ],
  },
];

/* ─────────────────────────── Dérivés (une seule source) ───────────────────── */

/** Un préfixe matche s'il est égal, ou suivi d'un « / » — évite que /admin/drive
 *  (Drive) capture /admin/drivers (Livraison). */
export function prefixMatches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

export function isDomainActive(
  pathname: string,
  domain: AdminNavDomain
): boolean {
  if (domain.exact && pathname === domain.href) return true;
  if (!domain.exact && prefixMatches(pathname, domain.href)) return true;
  return (domain.match ?? []).some((p) => prefixMatches(pathname, p));
}

export function isItemActive(pathname: string, item: AdminNavItem): boolean {
  return item.exact
    ? pathname === item.href
    : prefixMatches(pathname, item.href);
}

export function domainOf(key: AlertDomain): AdminNavDomain | undefined {
  return ADMIN_NAV.find((d) => d.key === key);
}

/** Toutes les pages, à plat, SOUS-PAGES COMPRISES — recherche (⌘K) et fil
 *  d'Ariane. Une sous-page introuvable à la recherche serait une sous-page
 *  perdue. */
export function allAdminItems(): {
  item: AdminNavItem;
  domain: AdminNavDomain;
  section?: string;
  parent?: AdminNavItem;
}[] {
  return ADMIN_NAV.flatMap((domain) =>
    domain.sections.flatMap((section) =>
      section.items.flatMap((item) => [
        { item, domain, section: section.label },
        ...(item.children ?? []).map((child) => ({
          item: child,
          domain,
          section: section.label,
          parent: item,
        })),
      ])
    )
  );
}

/** Page courante dans l'arborescence (la plus SPÉCIFIQUE : /a/b bat /a). */
export function locate(pathname: string) {
  let best: {
    item: AdminNavItem;
    domain: AdminNavDomain;
    section?: string;
  } | null = null;
  for (const entry of allAdminItems()) {
    if (!isItemActive(pathname, entry.item)) continue;
    if (!best || entry.item.href.length > best.item.href.length) best = entry;
  }
  return best;
}
