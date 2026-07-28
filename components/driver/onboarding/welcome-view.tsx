"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  ChevronRight,
  Loader2,
  MapPin,
  Power,
  Store,
  Wallet,
  Zap,
} from "lucide-react";
import {
  BRAND_GO,
  BRAND_VIOLET,
  PartnerInlineError,
  SORA,
} from "@/components/shared/partner-ui";
import { ColigoCelebration } from "@/components/driver/onboarding/coligo-celebration";
import {
  ackDriverVerified,
  finishDriverOnboarding,
} from "@/app/(driver)/actions";

type Phase = "congrats" | "mode" | "tour";

/**
 * Retour du livreur après validation : félicitations → choix du mode d'activité
 * → parcours d'intégration (passable). Le compte ne devient ACTIF qu'au moment
 * où le mode est choisi (`finishDriverOnboarding` pose `onboarding_done_at`) :
 * avant cela, la garde de `/driver` renvoie ici, même par URL directe.
 */
export function DriverWelcomeView({
  firstName,
  needsModeChoice,
}: {
  firstName: string;
  needsModeChoice: boolean;
}) {
  const router = useRouter();
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  // Le livreur qui a déjà vu les félicitations reprend directement au choix.
  const [phase, setPhase] = useState<Phase>(
    needsModeChoice ? "mode" : "congrats"
  );
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Accusé de lecture posé dès l'affichage : s'il quitte l'app ici, il revient
  // au choix du mode, pas sur une deuxième salve de confettis.
  useEffect(() => {
    if (phase !== "congrats") return;
    void ackDriverVerified();
  }, [phase]);

  const choose = (mode: "merchant" | "express") =>
    start(async () => {
      const r = await finishDriverOnboarding(mode);
      if (!r.ok || !r.route) {
        setError(
          r.error ??
            tr("Impossible de terminer l'inscription.", "تعذّر إتمام التسجيل.")
        );
        return;
      }
      router.replace(r.route);
    });

  if (phase === "congrats") {
    return (
      <div
        className="text-center"
        style={{ animation: "driver-rise .5s ease-out both" }}
      >
        <ColigoCelebration variant="verified" />

        <span
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold"
          style={{ background: "var(--go-soft)", color: BRAND_GO }}
        >
          <BadgeCheck className="size-3.5" />
          {tr("Compte vérifié", "حساب موثَّق")}
        </span>

        <h2
          className="mt-3 text-[24px] leading-tight font-extrabold text-[var(--ink)]"
          style={{ fontFamily: SORA }}
        >
          {isAr
            ? `تهانينا${firstName ? ` يا ${firstName}` : ""}!`
            : `Félicitations${firstName ? `, ${firstName}` : ""} !`}
        </h2>
        <p className="mx-auto mt-2.5 max-w-[320px] text-[13.5px] leading-relaxed text-[var(--muted)]">
          {tr(
            "L'équipe Coligo a vérifié votre compte. Vous pouvez désormais commencer à générer des revenus immédiatement.",
            "تحقق فريق كوليغو من حسابك. يمكنك الآن البدء في تحقيق مداخيل فورًا."
          )}
        </p>

        <button
          type="button"
          onClick={() => setPhase("mode")}
          className="mt-6 flex h-[52px] w-full items-center justify-center gap-2 rounded-[16px] text-[15px] font-extrabold text-white"
          style={{ background: BRAND_VIOLET, fontFamily: SORA }}
        >
          {tr("Commencer", "ابدأ")}
          <ArrowRight className="size-4 rtl:rotate-180" />
        </button>
      </div>
    );
  }

  if (phase === "tour") {
    return <OnboardingTour onDone={() => setPhase("mode")} />;
  }

  return (
    <div
      className="space-y-3"
      style={{ animation: "driver-rise .35s ease-out both" }}
    >
      <header className="mb-1 text-center">
        <h2
          className="text-[21px] leading-tight font-extrabold text-[var(--ink)]"
          style={{ fontFamily: SORA }}
        >
          {tr("Comment souhaitez-vous travailler ?", "كيف تودّ العمل؟")}
        </h2>
        <p className="mx-auto mt-1.5 max-w-[320px] text-[13px] leading-relaxed text-[var(--muted)]">
          {tr(
            "Choisissez votre mode d'activité pour commencer.",
            "اختر نمط نشاطك للبدء."
          )}
        </p>
      </header>

      <ModeCard
        icon={<Zap className="size-5" />}
        title={tr("Accéder au mode Express maintenant", "ادخل وضع إكسبرس الآن")}
        text={tr(
          "Recevez directement les livraisons des commerçants autour de vous. Aucune inscription préalable : mettez-vous en ligne et les courses arrivent.",
          "استقبل مباشرة توصيلات التجار من حولك. دون أي تسجيل مسبق: اتصل بالشبكة وستصلك الطلبات."
        )}
        cta={tr("Démarrer en Express", "البدء في إكسبرس")}
        highlight
        pending={pending}
        onClick={() => choose("express")}
      />
      <ModeCard
        icon={<Store className="size-5" />}
        title={tr("Rejoindre un commerçant", "الانضمام إلى تاجر")}
        text={tr(
          "Saisissez le code d'un commerçant partenaire pour intégrer son équipe et accéder à ses tournées planifiées.",
          "أدخل رمز تاجر شريك للانضمام إلى فريقه والوصول إلى جولاته المخططة."
        )}
        cta={tr("Saisir un code commerçant", "إدخال رمز تاجر")}
        pending={pending}
        onClick={() => choose("merchant")}
      />

      <PartnerInlineError>{error}</PartnerInlineError>

      <button
        type="button"
        onClick={() => setPhase("tour")}
        disabled={pending}
        className="w-full pt-1 text-[12.5px] font-bold text-[var(--muted)] underline disabled:opacity-50"
      >
        {tr("Découvrir l'application en 4 écrans", "اكتشف التطبيق في 4 شاشات")}
      </button>
      <p className="text-center text-[11.5px] text-[var(--muted)]">
        {tr(
          "Vous pourrez changer de mode à tout moment depuis votre compte.",
          "يمكنك تغيير النمط في أي وقت من حسابك."
        )}
      </p>
    </div>
  );
}

function ModeCard({
  icon,
  title,
  text,
  cta,
  highlight,
  pending,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  cta: string;
  highlight?: boolean;
  pending: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="flex w-full items-start gap-3 rounded-[18px] border bg-[var(--surface)] p-4 text-start disabled:opacity-60"
      style={{
        borderColor: highlight ? BRAND_VIOLET : "var(--line)",
        boxShadow: highlight ? "var(--pill-shadow)" : undefined,
      }}
    >
      <span
        className="grid size-11 shrink-0 place-items-center rounded-[14px]"
        style={{
          background: highlight ? BRAND_VIOLET : "var(--soft)",
          color: highlight ? "#fff" : BRAND_VIOLET,
        }}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <b
          className="block text-[14.5px] font-extrabold text-[var(--ink)]"
          style={{ fontFamily: SORA }}
        >
          {title}
        </b>
        <small className="mt-1 block text-[12px] leading-relaxed text-[var(--muted)]">
          {text}
        </small>
        <span
          className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-bold"
          style={{ color: BRAND_VIOLET }}
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {cta}
          <ChevronRight className="size-3.5 rtl:rotate-180" />
        </span>
      </span>
    </button>
  );
}

const TOUR_SLIDES = [
  {
    icon: <Power className="size-7" />,
    title: "Mettez-vous en ligne",
    titleAr: "اتصل بالشبكة",
    text: "L'interrupteur « En ligne » de l'accueil vous rend visible pour le dispatch. Hors ligne, vous ne recevez aucune course.",
    textAr:
      "مفتاح «متصل» في الشاشة الرئيسية يجعلك مرئيًا للتوزيع. وأنت غير متصل، لن تصلك أي طلبات.",
  },
  {
    icon: <MapPin className="size-7" />,
    title: "Choisissez votre zone",
    titleAr: "اختر منطقتك",
    text: "Définissez la zone où vous voulez travailler : vous ne recevrez que les courses de ce secteur, où que vous soyez.",
    textAr:
      "حدّد المنطقة التي تريد العمل فيها: لن تصلك إلا طلبات هذا القطاع، أينما كنت.",
  },
  {
    icon: <Wallet className="size-7" />,
    title: "Encaissez, reversez",
    titleAr: "حصّل وسدّد",
    text: "Les courses en espèces sont encaissées par vous. Votre relevé indique à tout moment ce que vous devez reverser à Coligo, ou ce que Coligo vous doit.",
    textAr:
      "الطلبات النقدية تحصّلها أنت. كشفك يبيّن في كل وقت ما يجب أن تسدده لكوليغو، أو ما تدين به كوليغو لك.",
  },
  {
    icon: <BarChart3 className="size-7" />,
    title: "Suivez vos gains",
    titleAr: "تابع أرباحك",
    text: "Chaque course crédite votre gain net, visible en temps réel dans l'onglet Gains.",
    textAr: "كل طلب يضيف ربحك الصافي، مرئيًا في الوقت الفعلي في تبويب الأرباح.",
  },
];

/** Parcours d'intégration facultatif — passable à tout moment. */
function OnboardingTour({ onDone }: { onDone: () => void }) {
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const [i, setI] = useState(0);
  const slide = TOUR_SLIDES[i];
  const last = i === TOUR_SLIDES.length - 1;

  return (
    <div
      className="text-center"
      style={{ animation: "driver-rise .3s ease-out both" }}
    >
      <span
        className="mx-auto grid size-16 place-items-center rounded-full"
        style={{ background: "var(--violet-soft)", color: BRAND_VIOLET }}
      >
        {slide.icon}
      </span>
      <h2
        className="mt-3 text-[19px] font-extrabold text-[var(--ink)]"
        style={{ fontFamily: SORA }}
      >
        {isAr ? slide.titleAr : slide.title}
      </h2>
      <p className="mx-auto mt-2 max-w-[320px] text-[13px] leading-relaxed text-[var(--muted)]">
        {isAr ? slide.textAr : slide.text}
      </p>

      <div className="mt-5 flex justify-center gap-1.5">
        {TOUR_SLIDES.map((s, idx) => (
          <span
            key={s.title}
            className="h-1.5 rounded-full transition-all"
            style={{
              width: idx === i ? 20 : 6,
              background: idx === i ? BRAND_VIOLET : "var(--line)",
            }}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={() => (last ? onDone() : setI(i + 1))}
        className="mt-5 flex h-[50px] w-full items-center justify-center gap-2 rounded-[16px] text-[15px] font-extrabold text-white"
        style={{ background: BRAND_VIOLET, fontFamily: SORA }}
      >
        {last ? tr("J'ai compris", "فهمت") : tr("Suivant", "التالي")}
        <ArrowRight className="size-4 rtl:rotate-180" />
      </button>
      <button
        type="button"
        onClick={onDone}
        className="mt-2.5 text-[12.5px] font-bold text-[var(--muted)] underline"
      >
        {tr(
          "Passer — je connais déjà l'application",
          "تخطٍّ — أعرف التطبيق بالفعل"
        )}
      </button>
    </div>
  );
}
