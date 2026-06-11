import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DriveView } from "@/components/customer/drive/drive-view";

export const dynamic = "force-dynamic";

export default async function DrivePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/se-connecter?next=/drive");
  return <DriveView />;
}
