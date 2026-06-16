"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WILAYAS } from "@/lib/dz/wilayas";
import { driverSignup, type DriverAuthState } from "@/app/(driver)/actions";

const initial: DriverAuthState = {};

export function DriverSignupForm() {
  const sp = useSearchParams();
  const next = sp.get("next") ?? "";
  const [state, action, pending] = useActionState(driverSignup, initial);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="next" value={next} />

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="first_name">Prénom</Label>
          <Input
            id="first_name"
            name="first_name"
            type="text"
            autoComplete="given-name"
            required
            disabled={pending}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="last_name">Nom</Label>
          <Input
            id="last_name"
            name="last_name"
            type="text"
            autoComplete="family-name"
            required
            disabled={pending}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="phone">Téléphone</Label>
        <Input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="+213 6XX XX XX XX"
          required
          disabled={pending}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="exemple@email.com"
          required
          disabled={pending}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="wilaya">Wilaya</Label>
        <select
          id="wilaya"
          name="wilaya"
          required
          disabled={pending}
          defaultValue=""
          className="h-12 w-full rounded-[12px] border border-[var(--line)] bg-white px-3 text-sm font-medium text-[var(--ink)] outline-none focus:border-[#6c2bd9] disabled:opacity-50"
        >
          <option value="" disabled>
            Choisis ta wilaya
          </option>
          {WILAYAS.map((w, i) => (
            <option key={w} value={w}>
              {String(i + 1).padStart(2, "0")} · {w}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">Mot de passe</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={6}
          required
          disabled={pending}
        />
      </div>

      {state.error && <p className="text-danger-600 text-sm">{state.error}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        Créer mon compte
      </Button>
    </form>
  );
}
