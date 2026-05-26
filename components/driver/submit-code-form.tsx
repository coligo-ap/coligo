"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { driverSubmitCode, type DriverAuthState } from "@/app/(driver)/actions";

const initial: DriverAuthState = {};

export function DriverSubmitCodeForm() {
  const router = useRouter();
  const [state, action, pending] = useActionState(driverSubmitCode, initial);

  useEffect(() => {
    if (state.ok) {
      toast.success("Demande envoyée — en attente de validation");
      router.push("/driver");
    }
  }, [state, router]);

  return (
    <form action={action} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="code">Code de référence</Label>
        <Input
          id="code"
          name="code"
          type="text"
          autoCapitalize="characters"
          placeholder="EX: BOULANGERIE-K4Q7X9"
          className="font-mono tracking-wider uppercase"
          required
          disabled={pending}
        />
      </div>
      {state.error && <p className="text-danger-600 text-sm">{state.error}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        Envoyer
      </Button>
    </form>
  );
}
