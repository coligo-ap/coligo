import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as
    | "signup"
    | "magiclink"
    | "recovery"
    | "email_change"
    | null;
  const next = searchParams.get("next");

  if (token_hash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });

    if (!error) {
      if (type === "signup") {
        return NextResponse.redirect(new URL("/auth/confirmed", origin));
      }
      return NextResponse.redirect(new URL(next ?? "/dashboard", origin));
    }
  }

  return NextResponse.redirect(new URL("/login?error=confirm_failed", origin));
}
