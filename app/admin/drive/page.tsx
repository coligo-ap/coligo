import { redirect } from "next/navigation";
import { Car } from "lucide-react";
import { isSuperAdmin } from "@/lib/auth/admin";
import { getDriveConfig } from "./actions";
import { DriveConfigForm } from "@/components/admin/drive-config-form";

export const dynamic = "force-dynamic";

export default async function AdminDrivePage() {
  if (!(await isSuperAdmin())) redirect("/admin");
  const cfg = await getDriveConfig();
  if (!cfg) redirect("/admin");

  return (
    <div className="mx-auto max-w-[1100px] p-4 lg:p-6">
      <header className="mb-5 flex items-center gap-2">
        <Car className="size-6" />
        <h1 className="text-2xl font-bold tracking-tight">Config Drive</h1>
      </header>
      <DriveConfigForm initial={cfg} />
    </div>
  );
}
