"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2, Mail, Phone, User as UserIcon } from "lucide-react";
import { isValidContactPhone, normalizeContactPhone } from "@/lib/dz/phone";
import { PhoneField } from "@/components/ui/phone-field";
import { CustomerLogoutButton } from "@/components/customer/logout-button";
import {
  confirmEmailChange,
  requestEmailChange,
  updateProfile,
} from "@/app/(customer)/compte/actions";

// =============================================================================
// AccountInfoForm — sous-page « Informations personnelles » (form premium +
// barre « Enregistrer les modifications » fixe en bas).
// =============================================================================
// - Nom + téléphone : enregistrés par la barre fixe (updateProfile).
// - Email : changement par CODE (OTP) via un sous-flux dédié, car il exige une
//   vérification — la barre fixe ne le touche pas.
// =============================================================================

export function AccountInfoForm({
  initialName,
  initialPhone,
  initialEmail,
}: {
  initialName: string;
  initialPhone: string;
  initialEmail: string;
}) {
  const t = useTranslations("account");
  const [name, setName] = useState(initialName);
  // `phone` ne contient QUE la forme canonique (ou ""). `phoneRaw` garde la
  // frappe, sans quoi « en cours de saisie » et « champ vide » seraient
  // indiscernables et l'erreur s'afficherait dès le premier chiffre.
  const [phone, setPhone] = useState(
    () => normalizeContactPhone(initialPhone) ?? ""
  );
  const [phoneRaw, setPhoneRaw] = useState(initialPhone);
  const [pending, start] = useTransition();
  // Retour EN LIGNE (au-dessus du bouton) plutôt que toast (cf. CLAUDE.md).
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(
    null
  );

  // Validation EN DIRECT du numéro (mobile algérien ou international).
  const phoneValid = isValidContactPhone(phone);
  const phoneShowError = phoneRaw.trim().length > 0 && !phoneValid;

  // Comparaison sur la forme canonique : un numéro déjà stocké en `+213…` se
  // normalise en `0…` au montage, ce qui marquerait le formulaire « modifié »
  // sans que l'utilisateur ait rien touché.
  const dirty =
    name.trim() !== initialName.trim() ||
    phone !== (normalizeContactPhone(initialPhone) ?? "");

  return (
    <>
      <div className="px-4 pt-2 pb-28">
        <div className="divide-border divide-y rounded-[20px] bg-white px-4 shadow-[0_8px_22px_-16px_rgba(40,35,90,.2)]">
          {/* Nom et prénom */}
          <Field label={t("fullName")} icon={<UserIcon className="size-4" />}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("fullNamePlaceholder")}
              maxLength={80}
              className="text-foreground w-full bg-transparent text-sm font-bold outline-none placeholder:font-medium"
            />
          </Field>

          {/* Téléphone — validation en direct */}
          <Field
            label={t("phone")}
            icon={<Phone className="size-4" />}
            invalid={phoneShowError}
            footer={
              phoneShowError ? (
                <span className="text-danger-600">
                  Numéro invalide — mobile algérien (0X XX XX XX XX) ou
                  international (+…).
                </span>
              ) : phoneValid ? (
                <span className="text-success-600">Numéro valide ✓</span>
              ) : (
                <span className="text-muted">
                  Numéro obligatoire (ex. 06 12 34 56 78).
                </span>
              )
            }
          >
            <PhoneField
              variant="bare"
              label={null}
              defaultValue={initialPhone}
              onValueChange={(canonical, raw) => {
                setPhone(canonical ?? "");
                setPhoneRaw(raw);
              }}
            />
          </Field>

          {/* Email (changement par code) */}
          <EmailField initialEmail={initialEmail} />
        </div>

        {/* Déconnexion — juste sous la section « Adresse email ». */}
        <div className="mt-5">
          <CustomerLogoutButton />
        </div>
      </div>

      {/* Barre « Enregistrer les modifications » FIXE en bas. */}
      <div className="border-border fixed inset-x-0 bottom-0 z-30 border-t bg-white/95 px-4 pt-3.5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] backdrop-blur">
        <div className="mx-auto max-w-2xl">
          {/* Message EN LIGNE (au-dessus du bouton) — pas de toast. */}
          {saveMsg && (
            <p
              className={
                "mb-2 text-center text-[12.5px] font-semibold " +
                (saveMsg.ok ? "text-success-600" : "text-danger-600")
              }
            >
              {saveMsg.text}
            </p>
          )}
          <button
            type="button"
            disabled={!dirty || pending || !phoneValid}
            onClick={() =>
              start(async () => {
                setSaveMsg(null);
                const res = await updateProfile({ full_name: name, phone });
                if (res.error) setSaveMsg({ ok: false, text: res.error });
                else setSaveMsg({ ok: true, text: res.success ?? t("saved") });
              })
            }
            className="bg-primary-600 hover:bg-primary-700 inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-[15px] text-[15px] font-extrabold text-white shadow-[0_10px_24px_-6px_rgba(91,91,230,.45)] transition disabled:opacity-40"
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              t("saveChanges")
            )}
          </button>
        </div>
      </div>
    </>
  );
}

function Field({
  label,
  icon,
  children,
  trailing,
  footer,
  invalid,
}: {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  trailing?: React.ReactNode;
  footer?: React.ReactNode;
  invalid?: boolean;
}) {
  return (
    <div className="border-border py-4">
      <label className="text-muted mb-2.5 block text-[11.5px] font-extrabold tracking-wide uppercase">
        {label}
      </label>
      <div
        className={
          "bg-surface-2 flex items-center gap-2.5 rounded-[13px] border px-3.5 py-3.5 transition focus-within:ring-2 " +
          (invalid
            ? "border-danger-500 focus-within:border-danger-500 focus-within:ring-danger-500/15"
            : "border-border focus-within:border-primary-400 focus-within:ring-primary-100")
        }
      >
        <span className="text-muted shrink-0">{icon}</span>
        {children}
        {trailing}
      </div>
      {footer && (
        <p className="mt-1.5 px-0.5 text-[11.5px] font-medium">{footer}</p>
      )}
    </div>
  );
}

function EmailField({ initialEmail }: { initialEmail: string }) {
  const t = useTranslations("account");
  const [step, setStep] = useState<"idle" | "editing" | "code">("idle");
  const [email, setEmail] = useState(initialEmail);
  const [newEmail, setNewEmail] = useState("");
  const [code, setCode] = useState("");
  const [pending, start] = useTransition();
  // Messages AFFICHÉS EN LIGNE (sous l'input) — pas de toast (cf. CLAUDE.md).
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  return (
    <div className="border-border py-4">
      <label className="text-muted mb-2.5 block text-[11.5px] font-extrabold tracking-wide uppercase">
        {t("emailAddress")}
      </label>

      {step === "idle" && (
        <>
          <div className="border-border bg-surface-2 flex items-center gap-2.5 rounded-[13px] border px-3.5 py-3.5">
            <Mail className="text-muted size-4 shrink-0" />
            <span className="text-foreground min-w-0 flex-1 truncate text-sm font-bold">
              {email}
            </span>
            <button
              type="button"
              onClick={() => {
                setNewEmail("");
                setErr(null);
                setOkMsg(null);
                setStep("editing");
              }}
              className="text-primary-700 shrink-0 text-[13px] font-extrabold"
            >
              {t("edit")}
            </button>
          </div>
          {okMsg ? (
            <p className="text-success-600 mt-2 px-0.5 text-[11.5px] font-semibold">
              {okMsg}
            </p>
          ) : (
            <p className="text-muted mt-2 px-0.5 text-[11.5px] font-medium">
              {t("emailReceiptsHint")}
            </p>
          )}
        </>
      )}

      {step === "editing" && (
        <div className="space-y-2.5">
          <div className="border-border bg-surface-2 focus-within:border-primary-400 focus-within:ring-primary-100 flex items-center gap-2.5 rounded-[13px] border px-3.5 py-3.5 transition focus-within:ring-2">
            <Mail className="text-muted size-4 shrink-0" />
            <input
              type="email"
              value={newEmail}
              onChange={(e) => {
                setNewEmail(e.target.value);
                setErr(null);
              }}
              placeholder="nouvelle@adresse.dz"
              autoComplete="email"
              className="text-foreground w-full bg-transparent text-sm font-bold outline-none placeholder:font-medium"
            />
          </div>
          {/* Erreur EN LIGNE (email déjà utilisé, etc.) */}
          {err ? (
            <p className="text-danger-600 px-0.5 text-[11.5px] font-semibold">
              {err}
            </p>
          ) : (
            <p className="text-muted px-0.5 text-[11.5px] font-medium">
              {t("confirmCodeWillBeSent")}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStep("idle")}
              className="border-border text-muted h-11 flex-1 rounded-[12px] border text-sm font-semibold"
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              disabled={pending || newEmail.trim() === ""}
              onClick={() =>
                start(async () => {
                  setErr(null);
                  const res = await requestEmailChange({ email: newEmail });
                  if (res.error) setErr(res.error);
                  else {
                    setCode("");
                    setStep("code");
                  }
                })
              }
              className="bg-foreground text-background h-11 flex-1 rounded-[12px] text-sm font-extrabold disabled:opacity-40"
            >
              {pending ? (
                <Loader2 className="mx-auto size-4 animate-spin" />
              ) : (
                t("sendCode")
              )}
            </button>
          </div>
        </div>
      )}

      {step === "code" && (
        <div className="space-y-2.5">
          <p className="text-muted text-sm">
            {t.rich("codeSentTo", {
              email: newEmail,
              strong: (chunks) => (
                <strong className="text-foreground">{chunks}</strong>
              ),
            })}
          </p>
          <input
            inputMode="numeric"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
              setErr(null);
            }}
            placeholder="Code à 6 chiffres"
            aria-invalid={!!err}
            className={
              "bg-surface-2 w-full rounded-[13px] border px-3.5 py-3.5 text-center text-lg font-bold tracking-[0.3em] tabular-nums outline-none " +
              (err
                ? "border-danger-500"
                : "border-border focus:border-primary-400")
            }
          />
          {/* Erreur EN LIGNE sous le champ code (essais restants, blocage…) */}
          {err && (
            <p className="text-danger-600 px-0.5 text-[11.5px] font-semibold">
              {err}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setErr(null);
                setStep("editing");
              }}
              className="border-border text-muted h-11 flex-1 rounded-[12px] border text-sm font-semibold"
            >
              {t("back")}
            </button>
            <button
              type="button"
              disabled={pending || code.length < 6}
              onClick={() =>
                start(async () => {
                  setErr(null);
                  const res = await confirmEmailChange({
                    email: newEmail,
                    token: code,
                  });
                  if (res.error) setErr(res.error);
                  else {
                    setEmail(newEmail.trim().toLowerCase());
                    setCode("");
                    setOkMsg(res.success ?? t("emailUpdated"));
                    setStep("idle");
                  }
                })
              }
              className="bg-primary-600 hover:bg-primary-700 inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-[12px] text-sm font-extrabold text-white disabled:opacity-40"
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <>
                  <Check className="size-4" />
                  {t("confirm")}
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
