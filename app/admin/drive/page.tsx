import { redirect } from "next/navigation";
import { Car } from "lucide-react";
import { isSuperAdmin } from "@/lib/auth/admin";
import { getDriveConfig, getDriveLearning } from "./actions";
import { DriveConfigForm } from "@/components/admin/drive-config-form";
import { DriveLearningMonitor } from "@/components/admin/drive-learning-monitor";

export const dynamic = "force-dynamic";

export default async function AdminDrivePage() {
  if (!(await isSuperAdmin())) redirect("/admin");
  const [cfg, learning] = await Promise.all([
    getDriveConfig(),
    getDriveLearning(),
  ]);
  if (!cfg) redirect("/admin");

  return (
    <div className="mx-auto max-w-[1100px] space-y-6 p-4 lg:p-6">
      <header className="flex items-center gap-2">
        <Car className="size-6" />
        <h1 className="text-2xl font-bold tracking-tight">Config Drive</h1>
      </header>
      <DriveLearningMonitor initial={learning} />
      <DriveConfigForm initial={cfg} />
    </div>
  );
}
