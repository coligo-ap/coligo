import { redirect } from "next/navigation";

/**
 * L'ancienne page « Relevé » est FUSIONNÉE dans « Gains et Relevés »
 * (/driver/gains) — une seule page à sections, style Bolt. On garde l'URL
 * (liens/raccourcis existants) en redirigeant avec la même période.
 */
export default async function DriverRelevePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  if (params.month) qs.set("month", params.month);
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  redirect(`/driver/gains${qs.size > 0 ? `?${qs.toString()}` : ""}`);
}
