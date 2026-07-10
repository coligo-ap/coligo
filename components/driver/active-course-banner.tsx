"use client";

import { usePathname, useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { useActiveCourse } from "@/lib/driver/active-course-store";

/**
 * Bandeau « Course en cours » épinglé au-dessus de la tabbar (cf.
 * MAQUETTE-livreur-navigation, écrans 2-3, classe .coursebar). Monté
 * GLOBALEMENT dans le layout : visible sur n'importe quel onglet dès qu'une
 * course est active ET réduite (on n'est pas sur l'écran plein). Tap →
 * ré-agrandit la navigation (retour à la course).
 */
export function ActiveCourseBanner() {
  const course = useActiveCourse();
  const pathname = usePathname();
  const router = useRouter();
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);

  if (!course) return null;
  if (
    pathname.startsWith("/driver/course") ||
    pathname.startsWith("/driver/login") ||
    pathname.startsWith("/driver/signup")
  ) {
    return null;
  }

  return (
    <div className="above-nav fixed inset-x-2.5 z-[46] mx-auto max-w-md">
      <button
        type="button"
        onClick={() => router.push(`/driver/course/${course.orderId}`)}
        aria-label={tr(
          "Revenir à la course en cours",
          "العودة إلى التوصيلة الجارية"
        )}
        className="coursebar"
        style={{ width: "100%" }}
      >
        <span className="ic">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 9l1-5h16l1 5M5 9v11h14V9M9 13h6" />
          </svg>
        </span>
        <span className="t">
          <b>
            {tr("Course en cours", "توصيلة جارية")} · {course.merchantName}
          </b>
          <span>
            {course.step === "pickup"
              ? tr("Retrait", "الاستلام")
              : tr("Livraison", "التسليم")}{" "}
            ·{" "}
            {tr(
              "touchez pour revenir à la navigation",
              "اضغط للعودة إلى التنقّل"
            )}
          </span>
        </span>
        <svg
          className="up"
          viewBox="0 0 24 24"
          fill="none"
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 15l-6-6-6 6" />
        </svg>
      </button>
    </div>
  );
}
