"use client";

import { usePathname, useRouter } from "next/navigation";
import { Bike, ChevronUp } from "lucide-react";
import { useActiveCourse } from "@/lib/driver/active-course-store";

/**
 * Bandeau « Course en cours » épinglé au-dessus de la tabbar (cf.
 * MAQUETTE-livreur-navigation, écrans 2-3). Monté GLOBALEMENT dans le layout
 * livreur : il s'affiche sur N'IMPORTE QUEL onglet (Accueil/Gains/Historique/
 * Compte) dès qu'une course est active ET réduite (= on n'est pas sur l'écran
 * plein de la course). Un tap ré-agrandit la navigation (retour à la course).
 *
 * État lu dans le store global `active-course-store` (posé par ExpressCard
 * quand la course tourne, retiré à la livraison / au refus).
 */
export function ActiveCourseBanner() {
  const course = useActiveCourse();
  const pathname = usePathname();
  const router = useRouter();

  if (!course) return null;
  // Caché sur la course elle-même (navigation déjà plein écran) et hors app.
  if (
    pathname.startsWith("/driver/course") ||
    pathname.startsWith("/driver/login") ||
    pathname.startsWith("/driver/signup")
  ) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={() => router.push(`/driver/course/${course.orderId}`)}
      aria-label="Revenir à la course en cours"
      className="fixed inset-x-2.5 bottom-[80px] z-[60] mx-auto flex max-w-md items-center gap-3 rounded-[18px] px-3.5 py-3 text-left text-white shadow-[0_16px_34px_-12px_rgba(108,43,217,.5)]"
      style={{ background: "linear-gradient(135deg,#6c2bd9,#4b1fa6)" }}
    >
      <span className="grid size-[38px] shrink-0 place-items-center rounded-[12px] bg-white/[.16]">
        <Bike className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <b className="block truncate text-[14px] font-bold">
          Course en cours · {course.merchantName}
        </b>
        <span className="text-[11.5px] opacity-85">
          {course.step === "pickup" ? "Retrait" : "Livraison"} · touchez pour
          revenir à la navigation
        </span>
      </span>
      <ChevronUp className="size-[22px] shrink-0 opacity-90" />
    </button>
  );
}
