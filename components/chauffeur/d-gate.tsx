"use client";

import { useLocale } from "next-intl";
import {
  Ban,
  Clock,
  CreditCard,
  Lock,
  Star,
  AlertTriangle,
  X,
} from "lucide-react";
import {
  VIOLET,
  GO,
  RED,
  PrimaryBtn,
  GhostBtn,
} from "@/components/customer/drive/drive-modals";
import { chauffeurLogout } from "@/app/(chauffeur)/actions";

/**
 * Dossier envoyé — en attente de validation (s-dwait).
 *
 * Règle produit : le rôle interne « super admin » n'est JAMAIS exposé aux
 * partenaires. Toute communication vers un chauffeur ou un livreur est signée
 * « l'équipe Coligo ».
 */
export function DWait() {
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  return (
    // Overlay plein écran : recouvre la nav persistante de la coque `(app)`.
    <div className="drive-jakarta drive-page fixed inset-0 z-[70] overflow-y-auto bg-[var(--d-surface)] px-5 pt-[calc(2.5rem+env(safe-area-inset-top))] pb-8">
      <div className="text-center">
        <span
          className="mx-auto mb-3 grid size-16 place-items-center rounded-full"
          style={{ background: "var(--d-accent)" }}
        >
          <Clock className="size-7" style={{ color: VIOLET }} />
        </span>
        <h1 className="drive-sora text-[21px] font-extrabold">
          {tr("Dossier envoyé ✓", "تم إرسال الملف ✓")}
        </h1>
        <p className="mx-auto mt-1 max-w-[290px] text-[13px] text-[var(--d-muted)]">
          {isAr ? (
            <>
              <b>فريق كوليغو</b> يتحقق من وثائقك. لن تتمكن من الوصول إلى حساب
              السائق إلا بعد المصادقة (24–48 ساعة). سيتم إشعارك.
            </>
          ) : (
            <>
              L&apos;<b>équipe Coligo</b> vérifie vos documents. Vous ne pourrez
              accéder à votre compte chauffeur qu&apos;après validation (24–48
              h). Vous serez notifié.
            </>
          )}
        </p>
      </div>

      <div className="mx-auto mt-5 max-w-[320px]">
        <Step
          state="ok"
          title={tr("Dossier envoyé", "تم إرسال الملف")}
          sub={tr("À l'instant", "الآن")}
        />
        <Step
          state="cur"
          title={tr("Vérification par l'équipe Coligo", "تحقّق من فريق كوليغو")}
          sub={tr("Documents · selfie · véhicule", "الوثائق · سيلفي · المركبة")}
        />
        <Step
          state="todo"
          n={3}
          title={tr("Compte activé", "تفعيل الحساب")}
          sub={tr(
            "Vous pourrez vous connecter et recevoir des courses",
            "ستتمكن من تسجيل الدخول واستقبال المشاوير"
          )}
          last
        />
      </div>

      <GhostBtn onClick={() => void chauffeurLogout()}>
        {tr("Se déconnecter", "تسجيل الخروج")}
      </GhostBtn>
    </div>
  );
}

function Step({
  state,
  n,
  title,
  sub,
  last,
}: {
  state: "ok" | "cur" | "todo";
  n?: number;
  title: string;
  sub: string;
  last?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <span
          className="grid size-[26px] shrink-0 place-items-center rounded-full text-xs font-bold"
          style={
            state === "ok"
              ? { background: GO, color: "#fff" }
              : state === "cur"
                ? {
                    background: "var(--d-accent)",
                    color: VIOLET,
                    border: `2px solid ${VIOLET}`,
                  }
                : { background: "var(--d-soft)", color: "var(--d-muted)" }
          }
        >
          {state === "ok" ? "✓" : state === "cur" ? "⏳" : n}
        </span>
        {!last && (
          <span className="min-h-[18px] w-[2px] flex-1 bg-[var(--d-line)]" />
        )}
      </div>
      <div className="pb-4 text-[13px] font-semibold">
        {title}
        <small className="mt-0.5 block text-[11px] font-medium text-[var(--d-muted)]">
          {sub}
        </small>
      </div>
    </div>
  );
}

/** Compte gelé (s-dfrozen) — motifs possibles + contact support. */
export function DFrozen({ reason }: { reason: string | null }) {
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const motifs = [
    {
      icon: <CreditCard className="size-4.5" style={{ color: RED }} />,
      title: tr("Impayé envers la plateforme", "مستحقات غير مدفوعة للمنصة"),
      sub: tr(
        "Commissions ou abonnement non reversés à l'échéance",
        "عمولات أو اشتراك لم يُدفع في الأجل"
      ),
    },
    {
      icon: <X className="size-4.5" style={{ color: RED }} />,
      title: tr("Annulations répétées", "إلغاءات متكرّرة"),
      sub: tr(
        "Taux d'annulation au-dessus du seuil autorisé",
        "نسبة إلغاء فوق الحد المسموح"
      ),
    },
    {
      icon: <AlertTriangle className="size-4.5" style={{ color: RED }} />,
      title: tr("Comportement signalé", "سلوك مُبلَّغ عنه"),
      sub: tr(
        "Non-respect des clients ou des conditions de la plateforme",
        "عدم احترام الزبائن أو شروط المنصة"
      ),
    },
    {
      icon: <Star className="size-4.5" style={{ color: RED }} />,
      title: tr("Note trop basse", "تقييم منخفض جدًا"),
      sub: tr(
        "Note moyenne durablement sous le seuil minimal",
        "متوسط تقييم دون الحد الأدنى لمدة طويلة"
      ),
    },
  ];
  return (
    // Overlay plein écran : recouvre la nav persistante de la coque `(app)`.
    <div className="drive-jakarta drive-page fixed inset-0 z-[70] overflow-y-auto bg-[var(--d-surface)] px-5 pt-[calc(2.5rem+env(safe-area-inset-top))] pb-8">
      <div className="text-center">
        <span
          className="mx-auto mb-3 grid size-16 place-items-center rounded-full"
          style={{ background: "rgba(229,72,77,.12)" }}
        >
          <Lock className="size-7" style={{ color: RED }} />
        </span>
        <h1
          className="drive-sora text-[21px] font-extrabold"
          style={{ color: RED }}
        >
          {tr("Compte gelé", "حساب مجمَّد")}
        </h1>
        <p className="mx-auto mt-1 mb-3 max-w-[300px] text-[13px] text-[var(--d-muted)]">
          {tr(
            "Votre compte chauffeur a été suspendu par Coligo.",
            "تم تعليق حساب السائق الخاص بك من طرف كوليغو."
          )}{" "}
          {reason ? (
            <>
              {tr("Motif :", "السبب:")}{" "}
              <b className="text-[var(--d-ink)]">{reason}</b>
            </>
          ) : (
            tr("Motifs possibles :", "الأسباب المحتملة:")
          )}
        </p>
      </div>
      {motifs.map((m) => (
        <div
          key={m.title}
          className="mb-2 flex items-center gap-3 rounded-[15px] border border-[var(--d-line)] p-3"
        >
          <span className="grid size-[34px] shrink-0 place-items-center rounded-[11px] bg-[var(--d-soft)]">
            {m.icon}
          </span>
          <span>
            <b className="block text-[13.5px]">{m.title}</b>
            <small className="text-[11px] text-[var(--d-muted)]">{m.sub}</small>
          </span>
        </div>
      ))}
      <PrimaryBtn
        onClick={() => window.open("mailto:support@coligo.app", "_self")}
      >
        {tr("Contacter le support Coligo", "التواصل مع دعم كوليغو")}
      </PrimaryBtn>
      <GhostBtn onClick={() => void chauffeurLogout()}>
        {tr("Se déconnecter", "تسجيل الخروج")}
      </GhostBtn>
    </div>
  );
}

/** Compte bloqué (suspension dure). */
export function DBlocked() {
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  return (
    // Overlay plein écran : recouvre la nav persistante de la coque `(app)`.
    <div className="drive-jakarta drive-page fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-[var(--d-surface)] px-5">
      <div className="text-center">
        <span
          className="mx-auto mb-3 grid size-16 place-items-center rounded-full"
          style={{ background: "rgba(229,72,77,.12)" }}
        >
          <Ban className="size-7" style={{ color: RED }} />
        </span>
        <h1
          className="drive-sora text-[21px] font-extrabold"
          style={{ color: RED }}
        >
          {tr("Compte suspendu", "حساب موقوف")}
        </h1>
        <p className="mx-auto mt-1 max-w-[290px] text-[13px] text-[var(--d-muted)]">
          {tr(
            "Votre compte a été suspendu définitivement. Contactez le support Coligo pour plus d'informations.",
            "تم إيقاف حسابك نهائيًا. تواصل مع دعم كوليغو لمزيد من المعلومات."
          )}
        </p>
        <GhostBtn onClick={() => void chauffeurLogout()}>
          {tr("Se déconnecter", "تسجيل الخروج")}
        </GhostBtn>
      </div>
    </div>
  );
}
