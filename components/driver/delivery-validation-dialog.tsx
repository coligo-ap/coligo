"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useLocale } from "next-intl";
import { toast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm";
import { QrScanner } from "@/components/scanner/qr-scanner";
import { enqueueValidation } from "@/lib/driver-offline/db";
import {
  validateDelivery,
  reportNoShow,
  leaveAtDoor,
} from "@/app/(driver)/actions";
import { createClient } from "@/lib/supabase/client";

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
  // Confirmations DESSINÉES (le `ConfirmProvider` est monté dans (driver)/layout).
  const confirm = useConfirm();
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const [code, setCode] = useState("");
  // Erreur affichée EN LIGNE dans la fenêtre (pas de toast) : la fenêtre reste
  // ouverte, le livreur voit « code incorrect », etc. au point d'action.
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  // Dépôt à l'adresse (leave-at-door) — ONLINE prépayé, après minuteur.
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [leaveNote, setLeaveNote] = useState("");
  const [leaving, setLeaving] = useState(false);
  const proofInputRef = useRef<HTMLInputElement>(null);

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
      setError(null);
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        await enqueueValidation({
          orderId,
          code: code || null,
          skipCode: skip,
        });
        // Synchro offline = événement asynchrone légitime (toast conservé).
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
          setError(reasonLabel(r.reason, isAr));
          return;
        }
        await enqueueValidation({
          orderId,
          code: code || null,
          skipCode: skip,
        });
        // Mise en file offline = événement asynchrone légitime (toast conservé).
        toast.success(
          tr(
            "Validation en attente — synchro auto",
            "التأكيد قيد الانتظار — مزامنة تلقائية"
          )
        );
        onSuccess();
        return;
      }
      // Succès : la fenêtre se ferme et PostDeliveryFeedback (« Livraison
      // validée ») s'affiche aussitôt → pas de toast redondant.
      onSuccess();
    });

  const handleScannedText = (text: string) => {
    const digits = text.match(/\d{4,6}/)?.[0];
    if (digits) {
      // Les cases du code se remplissent = retour visuel (pas de toast).
      setError(null);
      setCode(digits.slice(0, 4));
    }
  };

  const onValidateClick = () => {
    if (isOnline) return submit(false);
    if (code.length >= 4) return submit(false);
    void (async () => {
      const yes = await confirm({
        title: tr(
          "Confirmer la remise au client (paiement cash) ?",
          "تأكيد التسليم للزبون (الدفع نقداً)؟"
        ),
        message: tr(
          "Vous validez sans le code du client.",
          "أنت تؤكّد بدون رمز الزبون."
        ),
        confirmLabel: tr("Confirmer", "تأكيد"),
      });
      if (yes) submit(true);
    })();
  };

  // No-show ESPÈCES (mig 0327) : commande annulée. En EXPRESS l'avance au
  // commerçant est remboursable APRÈS validation support (course non payée) ;
  // en TOURNÉE tout reste à la charge du commerçant. (L'ONLINE n'utilise plus
  // ce bouton : il passe par le dépôt à l'adresse ci-dessous.)
  const onNoShow = () => {
    setError(null);
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setError(
        tr(
          "Connexion requise pour signaler un client absent.",
          "يلزم اتصال بالإنترنت للإبلاغ عن غياب الزبون."
        )
      );
      return;
    }
    if (!noShowReady) return; // bouton déjà désactivé, garde-fou
    void (async () => {
      const yes = await confirm({
        title: tr(
          "Client absent ou commande refusée ?",
          "الزبون غائب أو الطلب مرفوض؟"
        ),
        // Les sauts de ligne sont conservés (`whitespace-pre-line`) : cet
        // avertissement engage l'argent du livreur, il doit rester lisible.
        message: tr(
          "Vérifie que tu as bien APPELÉ et CONTACTÉ le client (message) et " +
            "attendu sur place. La commande sera ANNULÉE.\n\n" +
            "Ton avance au commerçant est remboursable APRÈS validation du support " +
            "— la course n'est pas payée (règle no-show espèces). GARDE la commande " +
            "avec toi : le support te dira quoi en faire. Suivi dans Relevé.",
          "تأكّد أنك اتصلت وتواصلت مع الزبون (رسالة) وانتظرت في المكان. سيتم إلغاء الطلب.\n\n" +
            "يُسترجع ما دفعته للتاجر بعد موافقة الدعم — التوصيلة غير مدفوعة (قاعدة الغياب النقدي). احتفظ بالطلب معك: الدعم سيخبرك بما تفعله. المتابعة في كشف الحساب."
        ),
        confirmLabel: tr("Signaler l'absence", "الإبلاغ عن الغياب"),
        danger: true,
      });
      if (!yes) return;
      doNoShow();
    })();
  };

  const doNoShow = () => {
    setError(null);
    start(async () => {
      const r = await reportNoShow({ orderId, reason: "no_show" });
      if (!r.ok) {
        setError(reasonLabel(r.reason, isAr));
        return;
      }
      // Confirmation SPÉCIFIQUE au no-show (remboursement de l'avance) qui doit
      // survivre à la fermeture de la fenêtre → toast conservé (légitime).
      toast.success(
        tr(
          "Signalé — le support examine le remboursement de ton avance (voir Relevé).",
          "تم الإبلاغ — يراجع الدعم استرجاع ما دفعته (انظر كشف الحساب)."
        )
      );
      onSuccess();
    });
  };

  // Photo de preuve du dépôt : upload direct dans le bucket public
  // `delivery-proofs` (policy : livreur authentifié). Path par commande.
  async function handleProofFile(file: File) {
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError(tr("Le fichier doit être une photo.", "يجب أن يكون صورة."));
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError(
        tr(
          "Photo trop lourde (max 8 Mo).",
          "الصورة كبيرة جداً (8 م.ب كحد أقصى)."
        )
      );
      return;
    }
    setUploadingProof(true);
    try {
      const supabase = createClient();
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${orderId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("delivery-proofs")
        .upload(path, file, { upsert: false, contentType: file.type });
      if (upErr) {
        setError(tr(`Échec de l'envoi : ${upErr.message}`, "فشل الإرسال."));
        return;
      }
      const {
        data: { publicUrl },
      } = supabase.storage.from("delivery-proofs").getPublicUrl(path);
      setProofUrl(publicUrl);
    } finally {
      setUploadingProof(false);
    }
  }

  const onLeaveAtDoor = () => {
    setError(null);
    if (!proofUrl) {
      setError(
        tr(
          "Prends d'abord une photo du colis déposé.",
          "التقط أولاً صورة للطرد بعد وضعه."
        )
      );
      return;
    }
    setLeaving(true);
    void (async () => {
      try {
        const r = await leaveAtDoor({
          orderId,
          photoUrl: proofUrl,
          note: leaveNote.trim() || undefined,
        });
        if (!r.ok) {
          setError(reasonLabel(r.reason, isAr));
          return;
        }
        // Succès : fenêtre fermée + PostDeliveryFeedback → pas de toast redondant.
        onSuccess();
      } finally {
        setLeaving(false);
      }
    })();
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
            className="size-full rounded-xl"
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
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, "").slice(0, 4));
              setError(null);
            }}
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

        {/* Erreur EN LIGNE (code incorrect, trop d'essais, photo, etc.) — la
            fenêtre reste ouverte, le livreur corrige sur place. */}
        {error && (
          <div
            style={{
              width: "100%",
              marginTop: 10,
              padding: "10px 12px",
              borderRadius: 12,
              border: "1.5px solid #fda29b",
              background: "#fffbfa",
              color: "#b42318",
              fontWeight: 600,
              fontSize: 13,
              textAlign: "center",
              lineHeight: 1.4,
            }}
          >
            {error}
          </div>
        )}

        {/* Client absent — minuteur 8 min depuis l'arrivée. ONLINE : dépôt à
            l'adresse avec photo (client déjà payé). ESPÈCES : commande annulée. */}
        {noShowReady && isOnline ? (
          <div
            style={{
              width: "100%",
              marginTop: 10,
              padding: 12,
              borderRadius: 14,
              border: "1.5px solid #fda29b",
              background: "#fffbfa",
            }}
          >
            <div
              style={{
                color: "#b42318",
                fontWeight: 700,
                fontSize: 14,
                marginBottom: 6,
              }}
            >
              {tr(
                "Client absent — déposer à l'adresse",
                "الزبون غائب — الإيداع في العنوان"
              )}
            </div>
            <p
              style={{
                color: "#667085",
                fontSize: 12.5,
                lineHeight: 1.45,
                margin: "0 0 10px",
              }}
            >
              {tr(
                "Commande déjà payée en ligne. Après avoir APPELÉ le client et envoyé un MESSAGE d'arrivée, dépose le colis en lieu sûr et prends une photo — elle sera partagée au client.",
                "الطلب مدفوع مسبقاً. بعد الاتصال بالزبون وإرسال رسالة وصول، ضع الطرد في مكان آمن والتقط صورة — ستُشارك مع الزبون."
              )}
            </p>

            <input
              ref={proofInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleProofFile(f);
                e.target.value = "";
              }}
            />

            {proofUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={proofUrl}
                alt={tr("Preuve de dépôt", "إثبات الإيداع")}
                style={{
                  width: "100%",
                  height: 160,
                  objectFit: "cover",
                  borderRadius: 12,
                  marginBottom: 10,
                }}
              />
            ) : null}

            <button
              type="button"
              onClick={() => proofInputRef.current?.click()}
              disabled={uploadingProof || leaving}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 12,
                border: "1.5px solid #d0d5dd",
                background: "#fff",
                color: "#344054",
                fontWeight: 600,
                fontSize: 13.5,
                marginBottom: 10,
                opacity: uploadingProof ? 0.6 : 1,
              }}
            >
              {uploadingProof
                ? tr("Envoi de la photo…", "جارٍ إرسال الصورة…")
                : proofUrl
                  ? tr("Reprendre la photo", "إعادة التقاط الصورة")
                  : tr("Prendre la photo du dépôt", "التقاط صورة الإيداع")}
            </button>

            <textarea
              value={leaveNote}
              onChange={(e) => setLeaveNote(e.target.value.slice(0, 200))}
              placeholder={tr(
                "Commentaire (ex. « Déposé devant la porte, à droite »)",
                "تعليق (مثال: «تُرك أمام الباب، على اليمين»)"
              )}
              rows={2}
              style={{
                width: "100%",
                padding: "9px 11px",
                borderRadius: 12,
                border: "1.5px solid #d0d5dd",
                fontSize: 13,
                resize: "none",
                marginBottom: 10,
                fontFamily: "inherit",
              }}
            />

            <button
              type="button"
              onClick={onLeaveAtDoor}
              disabled={!proofUrl || leaving || uploadingProof}
              style={{
                width: "100%",
                padding: "12px",
                borderRadius: 14,
                border: "none",
                background: "#b42318",
                color: "#fff",
                fontWeight: 700,
                fontSize: 14,
                opacity: !proofUrl || leaving || uploadingProof ? 0.5 : 1,
              }}
            >
              {leaving
                ? tr("Validation…", "جارٍ التأكيد…")
                : tr(
                    "Terminer la course — colis déposé",
                    "إنهاء التوصيلة — تم الإيداع"
                  )}
            </button>
          </div>
        ) : noShowReady ? (
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
    // Leave-at-door / no-show en ligne (mig 0328/0329).
    use_leave_at_door: [
      "Commande payée en ligne : dépose-la à l'adresse avec une photo (bouton « Déposer à l'adresse »).",
      "الطلب مدفوع عبر الإنترنت: أودعه في العنوان مع صورة (زر «الإيداع في العنوان»).",
    ],
    call_required: [
      "Appelle d'abord le client (bouton Appeler) avant de déposer.",
      "اتصل أولاً بالزبون (زر الاتصال) قبل الإيداع.",
    ],
    message_required: [
      "Envoie d'abord un message d'arrivée au client (messagerie).",
      "أرسل أولاً رسالة وصول إلى الزبون (الرسائل).",
    ],
    photo_required: [
      "Prends une photo du colis déposé pour valider.",
      "التقط صورة للطرد بعد إيداعه للتأكيد.",
    ],
    too_far: [
      "Rapproche-toi de l'adresse exacte du client (tu es trop loin).",
      "اقترب من عنوان الزبون الدقيق (أنت بعيد جداً).",
    ],
    no_location: [
      "Adresse client sans position GPS — contacte le support.",
      "عنوان الزبون بدون موقع GPS — تواصل مع الدعم.",
    ],
    cash_not_allowed: [
      "Dépôt réservé aux commandes payées en ligne.",
      "الإيداع مخصص للطلبات المدفوعة عبر الإنترنت.",
    ],
    not_in_transit: [
      "La commande n'est pas en cours de livraison.",
      "الطلب ليس قيد التوصيل.",
    ],
  };
  const pair = reason ? M[reason] : undefined;
  if (!pair) return reason ?? (isAr ? "خطأ" : "Erreur");
  return isAr ? pair[1] : pair[0];
}
