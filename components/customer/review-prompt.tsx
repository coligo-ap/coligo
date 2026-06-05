"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Star } from "lucide-react";
import { cldUrl } from "@/lib/images/cloudinary";
import { ReviewModal } from "@/components/customer/review-modal";
import type { ReviewableOrder } from "@/lib/data/reviews";

// =============================================================================
// ReviewPrompt — invitation à noter une commande récente.
// =============================================================================
//  - DESKTOP : encart compact cliquable (inchangé).
//  - MOBILE  : la pop-up (bottom sheet) s'ouvre DIRECTEMENT à l'arrivée sur la
//    home. Si le client la ferme sans noter, on considère qu'il ne veut PAS
//    noter cette commande → on ne la rouvre plus (mémorisé en localStorage).
//    Il pourra toujours laisser un avis plus tard depuis /commandes (même un
//    mois après réception : la création d'avis n'a pas de date limite).
//
// On n'invite que pour UNE commande à la fois pour ne pas spammer le client.
// =============================================================================

type Props = {
  orders: ReviewableOrder[];
};

// Refus mémorisé par COMMERÇANT (pas par commande) : si le client ferme la
// pop-up sans noter, on ne le redérange plus pour CE commerce, même s'il
// repasse commande plus tard.
const DISMISS_PREFIX = "coligo-review-dismiss-merchant-";
const dismissKey = (merchantId: string) => `${DISMISS_PREFIX}${merchantId}`;

// Avant, le refus était indexé par COMMANDE (`coligo-review-dismiss-<orderId>`).
// Depuis qu'on mémorise par commerçant, ces clés sont orphelines : on les purge
// UNE SEULE FOIS par appareil (sentinelle non préfixée pour ne pas s'auto-effacer).
const LEGACY_CLEANUP_FLAG = "coligo-review-keys-migrated-v1";
const LEGACY_PREFIX = "coligo-review-dismiss-";

function purgeLegacyDismissKeys() {
  try {
    if (localStorage.getItem(LEGACY_CLEANUP_FLAG)) return;
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      // Anciennes clés par-commande uniquement (pas les nouvelles par-commerçant).
      if (k && k.startsWith(LEGACY_PREFIX) && !k.startsWith(DISMISS_PREFIX)) {
        stale.push(k);
      }
    }
    stale.forEach((k) => localStorage.removeItem(k));
    localStorage.setItem(LEGACY_CLEANUP_FLAG, "1");
  } catch {
    /* localStorage indispo (Safari privé) : rien à purger */
  }
}

export function ReviewPrompt({ orders }: Props) {
  const [active, setActive] = useState<ReviewableOrder | null>(null);
  const [dismissed, setDismissed] = useState(false);
  // True quand la modale a été ouverte AUTOMATIQUEMENT (mobile) : sa fermeture
  // sans envoi vaut « je ne veux pas noter » → on mémorise le refus.
  const autoOpenedRef = useRef(false);

  const o = orders[0] ?? null;

  // Purge unique des anciennes clés de refus par-commande (montage seulement).
  useEffect(() => {
    purgeLegacyDismissKeys();
  }, []);

  useEffect(() => {
    if (!o) return;
    let isDismissed = false;
    try {
      isDismissed = localStorage.getItem(dismissKey(o.merchant_id)) === "1";
    } catch {
      /* localStorage indispo (Safari privé) : on ne bloque pas */
    }
    if (isDismissed) {
      setDismissed(true);
      return;
    }
    // Mobile (< sm) → ouverture directe en bottom sheet.
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 639px)").matches
    ) {
      autoOpenedRef.current = true;
      setActive(o);
    }
  }, [o]);

  if (!o || dismissed) return null;

  function handleClose() {
    // Fermeture d'une pop-up ouverte automatiquement = refus de noter → on ne
    // la rouvrira plus (le client garde la main via /commandes plus tard).
    if (autoOpenedRef.current) {
      autoOpenedRef.current = false;
      try {
        localStorage.setItem(dismissKey(o.merchant_id), "1");
      } catch {
        /* ignoré */
      }
      setDismissed(true);
    }
    setActive(null);
  }

  const logo = cldUrl(o.merchant_logo_url, {
    width: 56,
    height: 56,
    crop: "fill",
    gravity: "auto",
  });

  return (
    <>
      {/* Encart DESKTOP uniquement — sur mobile, la pop-up s'ouvre directement. */}
      <button
        type="button"
        onClick={() => setActive(o)}
        className="group hidden w-full items-center gap-3 rounded-[14px] border border-amber-200 bg-amber-50 p-3 text-left transition-all hover:border-amber-300 hover:shadow-md hover:shadow-amber-100 active:scale-[0.99] sm:flex"
      >
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logo}
            alt=""
            loading="lazy"
            decoding="async"
            className="size-11 shrink-0 rounded-full border border-amber-200 bg-white object-cover"
          />
        ) : (
          <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-amber-100 text-base font-bold text-amber-700">
            {o.merchant_name.charAt(0)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-foreground text-sm font-semibold">
            Comment c&apos;était chez {o.merchant_name} ?
          </p>
          <div className="mt-0.5 flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <Star
                key={n}
                className="size-3.5 fill-amber-300 text-amber-400"
              />
            ))}
            <span className="text-muted ml-1 text-[11px]">Note en 1 clic</span>
          </div>
        </div>
        <Link
          href="/commandes"
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 text-[11px] font-semibold text-amber-700 hover:underline"
        >
          Autres ?
        </Link>
      </button>

      {active && (
        <ReviewModal
          orderId={active.order_id}
          merchantName={active.merchant_name}
          onClose={handleClose}
        />
      )}
    </>
  );
}
