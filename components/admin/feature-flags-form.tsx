"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { updateFeatureFlag, type AdminFormState } from "@/app/admin/actions";
import type { FeatureFlag, FeatureStatus } from "@/lib/data/feature-flags";

const initialState: AdminFormState = {};

const STATUS_OPTIONS: { value: FeatureStatus; label: string; tone: string }[] =
  [
    { value: "active", label: "Actif", tone: "text-success-700" },
    { value: "hidden", label: "Masqué", tone: "text-muted" },
    {
      value: "coming_soon",
      label: "Bientôt (grisé)",
      tone: "text-primary-700",
    },
    { value: "maintenance", label: "Maintenance", tone: "text-warning-700" },
  ];

export function FeatureFlagCard({
  flag,
  label,
  hint,
}: {
  flag: FeatureFlag;
  label: string;
  hint: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    updateFeatureFlag,
    initialState
  );
  const [status, setStatus] = useState<FeatureStatus>(flag.status);

  useEffect(() => {
    if (state.ok) {
      toast.success(`« ${label} » mis à jour`);
      router.refresh();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state, router, label]);

  // Le message n'a de sens que pour « maintenance » (et accessoirement bientôt).
  const showMessage = status === "maintenance" || status === "coming_soon";

  return (
    <form
      action={formAction}
      className="border-border bg-surface space-y-3 rounded-[16px] border p-4"
    >
      <input type="hidden" name="key" value={flag.key} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-foreground font-semibold">{label}</p>
          <p className="text-muted mt-0.5 text-xs">{hint}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_OPTIONS.map((opt) => (
          <label
            key={opt.value}
            className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
              status === opt.value
                ? "border-primary-300 bg-primary-50 text-primary-800"
                : "border-border text-muted hover:bg-surface-2"
            }`}
          >
            <input
              type="radio"
              name="status"
              value={opt.value}
              checked={status === opt.value}
              onChange={() => setStatus(opt.value)}
              className="sr-only"
            />
            {opt.label}
          </label>
        ))}
      </div>

      {showMessage && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor={`msg-fr-${flag.key}`}>Message (FR)</Label>
            <Input
              id={`msg-fr-${flag.key}`}
              name="message_fr"
              defaultValue={flag.message_fr ?? ""}
              placeholder="Notre système Drive est en maintenance…"
              maxLength={400}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`msg-ar-${flag.key}`}>Message (AR)</Label>
            <Input
              id={`msg-ar-${flag.key}`}
              name="message_ar"
              defaultValue={flag.message_ar ?? ""}
              placeholder="نظام Drive قيد الصيانة…"
              dir="rtl"
              maxLength={400}
            />
          </div>
        </div>
      )}
      {/* Titres optionnels (conservés même si masqués pour ne pas les perdre). */}
      <input type="hidden" name="title_fr" value={flag.title_fr ?? ""} />
      <input type="hidden" name="title_ar" value={flag.title_ar ?? ""} />

      <div className="flex justify-end">
        <Button type="submit" disabled={pending} size="sm">
          {pending && <Loader2 className="size-4 animate-spin" />}
          Enregistrer
        </Button>
      </div>
    </form>
  );
}
