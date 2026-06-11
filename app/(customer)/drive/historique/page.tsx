import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDriveHistory } from "@/app/(customer)/drive/actions";
import { DriveHistoryView } from "@/components/customer/drive/drive-history";

export const dynamic = "force-dynamic";

export default async function DriveHistoriquePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/se-connecter?next=/drive/historique");
  const history = await getDriveHistory();
  return <DriveHistoryView history={history} />;
}
