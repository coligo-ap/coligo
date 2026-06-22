"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useLocale } from "next-intl";
import { toast } from "@/components/ui/toast";
import { QrScanner } from "@/components/scanner/qr-scanner";
import { enqueueValidation } from "@/lib/driver-offline/db";
import { validateDelivery, reportNoShow } from "@/app/(driver)/actions";

/**
 * Écran VALIDATION DE REMISE reproduit À L'IDENTIQUE de MAQUETTE-livreur-pages
 * (.valid) : titre + sous-titre, zone .qr (scanner caméra), « — ou — », code en
 * cases (.pinrow), encart vert .cash « Espèces à encaisser », bouton .mq-btn.
 *
 * Logique métier anti-fraude inchangée (mig 0041/0090) :
 *  - online/prépayé : code OBLIGATOIRE.
 *  - cash : code encouragé, validation possible sans code (tracée).
 * Le QR encode le pickup_code (4 chiffres ; tolérance legacy 6). Mode hors-ligne
 * (enqueue + synchro) conservé. Chemins scan et saisie unifiés côté serveur.
 */
export function DeliveryValidationDialog({
  orderId,
  paymentMethod,
  totalDa,
  arrivedAt,
  noShowWaitMin = 8,
  onClose,
  onSuccess,
}: {
  orderId: string;
  orderNumber?: string | null;
  paymentMethod: "cash" | "online";
  customerName?: string | null;
  totalDa?: number | null;
  /** delivery_arrived_at de la commande — démarre le minuteur no-show. */
  arrivedAt?: string | null;
  /** Fenêtre d'attente avant no-show (min). Doublée côté serveur si le client
   *  n'a pas répondu en messagerie. */
  noShowWaitMin?: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const [code, setCode] = useState("");
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const isOnline = paymentMethod === "online";
  const collect = isOnline ? 0 : (totalDa ?? 0);

  // Minuteur no-show : le livreur ne peut signaler un client absent qu'après
  // `noShowWaitMin` minutes depuis son ARRIVÉE (le serveur étend à ×2 si le
  // client n'a pas répondu en messagerie). Tick chaque seconde.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const arrivedMs = arrivedAt ? new Date(arrivedAt).getTime() : null;
  const noShowReadyAt = arrivedMs ? arrivedMs + noShowWaitMin * 60_000 : null;
  const noShowRemainingMs = noShowReadyAt
    ? Math.max(0, noShowReadyAt - now)
    : null;
  const noShowReady = arrivedMs != null && noShowRemainingMs === 0;
  const mmss = (ms: number) => {
    const s = Math.ceil(ms / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };

  const submit = (skip: boolean) =>
    start(async () => {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        await enqueueValidation({
          orderId,
          code: code || null,
          skipCode: skip,
        });
        toast.success(
          tr(
            "Validation enregistrée — sera synchronisée",
            "تم حفظ التأكيد — ستتم المزامنة"
          )
        );
        onSuccess();
        return;
      }
      const r = await validateDelivery({
        orderId,
        code: code || undefined,
        skipCode: skip,
      });
      if (!r.ok) {
        if (
          r.reason &&
          [
            "bad_code",
            "too_many_attempts",
            "not_picked_up",
            "not_ready",
            "online_requires_code",
            "code_required",
            "not_attributed_to_you",
            "order_not_found",
            "already_delivered",
          ].includes(r.reason)
        ) {
          toast.error(reasonLabel(r.reason, isAr));
          return;
        }
        await enqueueValidation({
          orderId,
          code: code || null,
          skipCode: skip,
        });
        toast.success(
          tr(
            "Validation en attente — synchro auto",
            "التأكيد قيد الانتظار — مزامنة تلقائية"
          )
        );
        onSuccess();
        return;
      }
      toast.success(tr("Livraison validée ✓", "تم تأكيد التسليم ✓"));
      onSuccess();
    });

  const handleScannedText = (text: string) => {
    const digits = text.match(/\d{4,6}/)?.[0];
    if (digits) {
      setCode(digits.slice(0, 4));
      toast.success(tr("Code détecté", "تم اكتشاف الرمز"));
    }
  };

  const onValidateClick = () => {
    if (isOnline) return submit(false);
    if (code.length >= 4) return submit(false);
    if (
      confirm(
        tr(
          "Confirmer la remise au client (paiement cash) ?",
          "تأكيد التسليم للزبون (الدفع نقداً)؟"
        )
      )
    )
      submit(true);
  };

  // No-show / refus (règle Yassir, mig 0162) : commande annulée. Espèces →
  // seule l'avance est remboursable (validation support), course non payée.
  // Online payé → course payée normalement (le client a déjà tout réglé).
  const onNoShow = () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      toast.error(
        tr(
          "Connexion requise pour signaler un client absent.",
          "يلزم اتصال بالإنترنت للإبلاغ عن غياب الزبون."
        )
      );
      return;
    }
    if (!noShowReady) return; // bouton déjà désactivé, garde-fou
    const confirmMsg = isAr
      ? "الزبون غائب أو الطلب مرفوض؟\n\n" +
        "تأكّد أنك تواصلت مع الزبون (رسالة) وانتظرت في المكان. سيتم إلغاء الطلب." +
        (isOnline
          ? " توصيلتك مدفوعة عادياً (الطلب مدفوع مسبقاً عبر الإنترنت)."
          : "\n\nسيُعاد لك ما دفعته للتاجر بعد موافقة الدعم — التوصيلة غير مدفوعة (قاعدة الغياب). احتفظ بالطلب معك: الدعم سيخبرك بما تفعله (إرجاع، احتفاظ أو منح). المتابعة في كشف الحساب.")
      : "Client absent ou commande refusée ?\n\n" +
        "Vérifie que tu as bien CONTACTÉ le client (message) et attendu sur place. " +
        "La commande sera ANNULÉE." +
        (isOnline
          ? " Ta course est payée normalement (commande déjà payée en ligne)."
          : "\n\nTon avance au commerçant sera remboursée APRÈS validation du " +
            "support — la course n'est pas payée (règle no-show). GARDE la " +
            "commande avec toi : le support te dira quoi en faire (retour, " +
            "garder ou donner). Suivi dans Relevé.");
    if (!confirm(confirmMsg)) return;
    start(async () => {
      const r = await reportNoShow({ orderId, reason: "no_show" });
      if (!r.ok) {
        toast.error(reasonLabel(r.reason, isAr));
        return;
      }
      toast.success(
        isOnline
          ? tr(
              "Signalé — commande annulée, ta course est payée.",
              "تم الإبلاغ — أُلغي الطلب، وتوصيلتك مدفوعة."
            )
          : tr(
              "Signalé — le support examine le remboursement de ton avance (voir Relevé).",
              "تم الإبلاغ — يراجع الدعم استرجاع ما دفعته (انظر كشف الحساب)."
            )
      );
      onSuccess();
    });
  };

  const ctaDisabled = pending || (isOnline && code.length < 4);
  const boxes = Array.from({ length: 4 }, (_, i) => code[i] ?? "");
  const curIdx = Math.min(code.length, 3);

  return (
    <div className="mq-screen fixed inset-0 z-[95] overflow-auto">
      <div className="valid">
        <div className="backh" style={{ margin: "2px 0 6px" }}>
          <button
            type="button"
            className="b"
            onClick={onClose}
            aria-label={tr("Retour", "رجوع")}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        </div>

        <h2>{tr("Confirmer la remise", "تأكيد التسليم")}</h2>
        <p>
          {tr(
            "Scannez le QR du client ou saisissez son code.",
            "امسح رمز QR الخاص بالزبون أو أدخل رمزه."
          )}
        </p>

        <div className="qr" style={{ overflow: "hidden" }}>
          <QrScanner
            onScan={handleScannedText}
            oneShot={false}
            className="size-full rounded-[20px]"
          />
        </div>

        <div className="or">{tr("— ou —", "— أو —")}</div>

        <button
          type="button"
          onClick={() => inputRef.current?.focus()}
          className="pinrow"
          style={{ position: "relative", width: "100%" }}
          aria-label={tr("Saisir le code", "إدخال الرمز")}
        >
          {boxes.map((d, i) => {
            const filled = d !== "";
            const cur = !filled && i === curIdx;
            return (
              <span key={i} className={"c" + (filled || cur ? " f" : "")}>
                {d}
              </span>
            );
          })}
          <input
            ref={inputRef}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={4}
            value={code}
            onChange={(e) =>
              setCode(e.target.value.replace(/\D/g, "").slice(0, 4))
            }
            disabled={pending}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </button>

        <div className="cash">
          <div className="l">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="2" y="6" width="20" height="12" rx="2" />
              <circle cx="12" cy="12" r="2.5" />
            </svg>
            {isOnline
              ? tr("Déjà payé en ligne", "مدفوع مسبقاً عبر الإنترنت")
              : tr("Espèces à encaisser", "نقد للتحصيل")}
          </div>
          <div className="am">{isOnline ? "0" : collect} DA</div>
        </div>

        <button
          type="button"
          className="mq-btn"
          onClick={onValidateClick}
          disabled={ctaDisabled}
          style={ctaDisabled ? { opacity: 0.5 } : undefined}
        >
          {pending
            ? tr("Validation…", "جارٍ التأكيد…")
            : tr("Valider la livraison", "تأكيد التسليم")}
        </button>

        {/* Client absent / refus — minuteur 8 min depuis l'arrivée avant
            activation (le serveur étend à ×2 si le client n'a pas répondu). */}
        {noShowReady ? (
          <button
            type="button"
            onClick={onNoShow}
            disabled={pending}
            style={{
              width: "100%",
              marginTop: 10,
              padding: "11px 12px",
              borderRadius: 14,
              border: "1.5px solid #fda29b",
              background: "#fffbfa",
              color: "#b42318",
              fontWeight: 700,
              fontSize: 14,
              opacity: pending ? 0.5 : 1,
            }}
          >
            {tr(
              "Client absent / commande refusée",
              "الزبون غائب / الطلب مرفوض"
            )}
          </button>
        ) : (
          <div
            style={{
              width: "100%",
              marginTop: 10,
              padding: "11px 12px",
              borderRadius: 14,
              border: "1.5px dashed #d0d5dd",
              background: "#f9fafb",
              color: "#667085",
              fontWeight: 600,
              fontSize: 12.5,
              textAlign: "center",
              lineHeight: 1.45,
            }}
          >
            {arrivedMs == null ? (
              <>
                {tr(
                  "Signale ton arrivée pour démarrer le minuteur d'attente.",
                  "أبلغ عن وصولك لبدء عدّاد الانتظار."
                )}
              </>
            ) : (
              <>
                {tr(
                  "« Client absent » disponible dans",
                  "«الزبون غائب» متاح بعد"
                )}{" "}
                <strong style={{ color: "#b42318" }}>
                  {mmss(noShowRemainingMs ?? 0)}
                </strong>
                .{" "}
                {tr(
                  "Contacte le client via la messagerie en attendant.",
                  "تواصل مع الزبون عبر الرسائل في انتظار ذلك."
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function reasonLabel(reason: string | undefined, isAr: boolean): string {
  const M: Record<string, [string, string]> = {
    online_requires_code: [
      "Code requis pour les commandes payées en ligne.",
      "الرمز مطلوب للطلبات المدفوعة عبر الإنترنت.",
    ],
    code_required: [
      "Code obligatoire : commande prépayée. Le client doit te communiquer son code.",
      "الرمز إلزامي: طلب مدفوع مسبقاً. على الزبون أن يعطيك رمزه.",
    ],
    bad_code: ["Code incorrect.", "الرمز غير صحيح."],
    too_many_attempts: [
      "Trop d'essais. Code bloqué 10 min — demande le bon code au client.",
      "محاولات كثيرة. تم حظر الرمز 10 دقائق — اطلب الرمز الصحيح من الزبون.",
    ],
    not_ready: [
      "La commande n'est pas encore prête chez le commerçant.",
      "الطلب ليس جاهزاً بعد عند التاجر.",
    ],
    not_attributed_to_you: [
      "Cette commande ne t'est pas attribuée.",
      "هذا الطلب غير مُسند إليك.",
    ],
    not_a_delivery: [
      "Ce n'est pas une commande livraison.",
      "هذا ليس طلب توصيل.",
    ],
    order_not_found: ["Commande introuvable.", "الطلب غير موجود."],
    already_delivered: ["Déjà validée.", "تم التأكيد مسبقاً."],
    already_closed: ["Commande déjà clôturée.", "الطلب مُغلق مسبقاً."],
    not_picked_up: [
      "Récupère d'abord la commande chez le commerçant.",
      "استلم الطلب أولاً من التاجر.",
    ],
    not_arrived: [
      "Signale ton arrivée avant de déclarer un client absent.",
      "أبلغ عن وصولك قبل الإبلاغ عن غياب الزبون.",
    ],
    too_early: [
      "Patiente encore : contacte le client, le délai d'attente n'est pas écoulé.",
      "انتظر قليلاً: تواصل مع الزبون، لم تنتهِ مدة الانتظار بعد.",
    ],
  };
  const pair = reason ? M[reason] : undefined;
  if (!pair) return reason ?? (isAr ? "خطأ" : "Erreur");
  return isAr ? pair[1] : pair[0];
}
