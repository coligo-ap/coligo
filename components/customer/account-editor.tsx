"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2, Mail, Phone, User as UserIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import {
  confirmEmailChange,
  requestEmailChange,
  updateProfile,
} from "@/app/(customer)/compte/actions";

export function AccountEditor({
  initialName,
  initialPhone,
  initialEmail,
}: {
  initialName: string;
  initialPhone: string;
  initialEmail: string;
}) {
  return (
    <div className="space-y-3">
      <IdentityCard initialName={initialName} initialPhone={initialPhone} />
      <EmailCard initialEmail={initialEmail} />
    </div>
  );
}

function IdentityCard({
  initialName,
  initialPhone,
}: {
  initialName: string;
  initialPhone: string;
}) {
  const t = useTranslations("account");
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [pending, start] = useTransition();

  const dirty =
    name.trim() !== initialName.trim() || phone.trim() !== initialPhone.trim();

  return (
    <section className="border-border bg-surface space-y-4 rounded-[16px] border p-5">
      <h2 className="text-muted flex items-center gap-2 text-[12px] font-bold tracking-wide uppercase">
        <UserIcon className="text-foreground size-[15px]" />
        {t("myInfo")}
      </h2>

      <div className="space-y-1.5">
        <Label htmlFor="acc_name">{t("fullName")}</Label>
        <Input
          id="acc_name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("fullNamePlaceholder")}
          maxLength={80}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="acc_phone">{t("phone")}</Label>
        <div className="relative">
          <Phone className="text-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            id="acc_phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+213 6XX XX XX XX"
            className="pl-9"
          />
        </div>
      </div>

      <button
        type="button"
        disabled={!dirty || pending}
        onClick={() =>
          start(async () => {
            const res = await updateProfile({ full_name: name, phone });
            if (res.error) toast.error(res.error);
            else toast.success(res.success ?? t("saved"));
          })
        }
        className="bg-primary-600 hover:bg-primary-700 inline-flex h-11 w-full items-center justify-center gap-2 rounded-[12px] text-sm font-extrabold text-white transition-colors disabled:opacity-40"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : t("save")}
      </button>
    </section>
  );
}

function EmailCard({ initialEmail }: { initialEmail: string }) {
  const t = useTranslations("account");
  // step: idle (affiche l'email) → editing (saisie nouvelle adresse) → code
  const [step, setStep] = useState<"idle" | "editing" | "code">("idle");
  const [email, setEmail] = useState(initialEmail);
  const [newEmail, setNewEmail] = useState("");
  const [code, setCode] = useState("");
  const [pending, start] = useTransition();

  return (
    <section className="border-border bg-surface space-y-4 rounded-[16px] border p-5">
      <h2 className="text-muted flex items-center gap-2 text-[12px] font-bold tracking-wide uppercase">
        <Mail className="text-foreground size-[15px]" />
        {t("emailAddress")}
      </h2>

      {step === "idle" && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-foreground min-w-0 flex-1 truncate text-sm font-medium">
            {email}
          </p>
          <button
            type="button"
            onClick={() => {
              setNewEmail("");
              setStep("editing");
            }}
            className="text-primary-700 shrink-0 text-sm font-bold"
          >
            {t("edit")}
          </button>
        </div>
      )}

      {step === "editing" && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="acc_new_email">{t("newEmailAddress")}</Label>
            <Input
              id="acc_new_email"
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="nouvelle@adresse.dz"
              autoComplete="email"
            />
            <p className="text-subtle text-xs">{t("confirmCodeWillBeSent")}</p>
          </div>
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
                  const res = await requestEmailChange({ email: newEmail });
                  if (res.error) toast.error(res.error);
                  else {
                    toast.success(res.success ?? t("codeSent"));
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
        <div className="space-y-3">
          <p className="text-muted text-sm">
            {t.rich("codeSentTo", {
              email: newEmail,
              strong: (chunks) => (
                <strong className="text-foreground">{chunks}</strong>
              ),
            })}
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="acc_code">{t("confirmationCode")}</Label>
            <Input
              id="acc_code"
              inputMode="numeric"
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              placeholder="123456"
              className="text-center text-lg tracking-[0.3em] tabular-nums"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStep("editing")}
              className="border-border text-muted h-11 flex-1 rounded-[12px] border text-sm font-semibold"
            >
              {t("back")}
            </button>
            <button
              type="button"
              disabled={pending || code.length < 6}
              onClick={() =>
                start(async () => {
                  const res = await confirmEmailChange({
                    email: newEmail,
                    token: code,
                  });
                  if (res.error) toast.error(res.error);
                  else {
                    toast.success(res.success ?? t("emailUpdated"));
                    setEmail(newEmail.trim().toLowerCase());
                    setCode("");
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
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await requestEmailChange({ email: newEmail });
                if (res.error) toast.error(res.error);
                else toast.success(t("newCodeSent"));
              })
            }
            className="text-primary-700 w-full text-center text-xs font-semibold"
          >
            {t("resendCode")}
          </button>
        </div>
      )}
    </section>
  );
}
