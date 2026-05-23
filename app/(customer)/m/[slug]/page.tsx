import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Clock, MapPin, Phone } from "lucide-react";
import { CustomerShell } from "@/components/customer/customer-shell";
import { getPublicMerchantBySlug } from "@/lib/data/merchants-public";
import { WILAYAS } from "@/lib/config/wilayas";
import { DAY_KEYS, DAY_LABELS } from "@/lib/types";
import { OpenStatusBadge } from "@/components/merchant/settings/open-status-badge";
import { formatDA } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function MerchantPublicPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const m = await getPublicMerchantBySlug(slug);
  if (!m) notFound();

  const wilaya = m.wilaya_code
    ? WILAYAS.find((w) => w.code === m.wilaya_code)?.name
    : null;

  return (
    <CustomerShell>
      <div className="mx-auto max-w-[1100px] px-4 py-4 lg:px-6 lg:py-8">
        <Link
          href="/"
          className="text-muted hover:text-foreground mb-3 inline-flex items-center gap-1.5 text-sm"
        >
          <ArrowLeft className="size-4" />
          Retour
        </Link>

        {/* Cover */}
        <div className="bg-surface-2 relative aspect-[3/1] w-full overflow-hidden rounded-[20px]">
          {m.cover_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={m.cover_url}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="from-primary-500/10 to-surface-2 absolute inset-0 bg-gradient-to-br" />
          )}
        </div>

        <div className="bg-surface border-border relative mx-3 -mt-10 rounded-[20px] border p-5 shadow-sm lg:mx-10 lg:p-6">
          <div className="flex flex-wrap items-start gap-4">
            {/* Logo : décalé vers le haut pour CHEVAUCHER la cover (par-dessus,
                pas dessous). Bordure blanche pour le détacher de la cover. */}
            {m.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={m.logo_url}
                alt=""
                className="-mt-16 size-24 shrink-0 rounded-full border-4 border-white bg-white object-cover shadow-md lg:-mt-20 lg:size-28"
              />
            ) : (
              <div className="bg-primary-100 text-primary-700 -mt-16 flex size-24 shrink-0 items-center justify-center rounded-full border-4 border-white text-2xl font-bold shadow-md lg:-mt-20 lg:size-28">
                {m.name.charAt(0)}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h1 className="text-foreground text-2xl font-bold lg:text-3xl">
                {m.name}
              </h1>
              {m.category && <p className="text-muted text-sm">{m.category}</p>}
              <div className="mt-2">
                <OpenStatusBadge hours={m.opening_hours} />
              </div>
            </div>
          </div>

          {m.description_fr && (
            <p className="text-foreground mt-4 text-sm">{m.description_fr}</p>
          )}
          {m.description_ar && (
            <p className="text-foreground mt-2 text-sm" dir="rtl">
              {m.description_ar}
            </p>
          )}
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <InfoCard icon={MapPin} title="Adresse">
            {[m.address, m.commune, wilaya].filter(Boolean).join(" · ") ||
              "Non renseignée"}
          </InfoCard>
          <InfoCard icon={Phone} title="Téléphone">
            {m.phone_public ?? "Non renseigné"}
          </InfoCard>
          <InfoCard icon={Clock} title="Commande">
            {m.min_order_da > 0
              ? `Minimum ${formatDA(m.min_order_da)}`
              : "Pas de minimum"}
            <span className="text-muted block text-[11px]">
              Préparation env. {m.prep_time_min} min
            </span>
          </InfoCard>
        </div>

        <section className="bg-surface border-border mt-6 rounded-[16px] border p-5">
          <h2 className="text-foreground mb-3 text-base font-semibold">
            Horaires
          </h2>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {DAY_KEYS.map((d) => {
              const slots = m.opening_hours[d];
              return (
                <li
                  key={d}
                  className="text-foreground flex items-center justify-between text-sm"
                >
                  <span className="font-medium">{DAY_LABELS[d].long}</span>
                  <span className="text-muted tabular-nums">
                    {slots.length === 0
                      ? "Fermé"
                      : slots.map((s) => `${s.open}–${s.close}`).join(" · ")}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <div className="border-border bg-warning-50 text-warning-700 border-warning-100 mt-6 rounded-[14px] border p-4 text-sm">
          Le catalogue et le panier arrivent dans une prochaine version. Reviens
          bientôt pour commander chez <strong>{m.name}</strong> !
        </div>
      </div>
    </CustomerShell>
  );
}

function InfoCard({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-border bg-surface rounded-[16px] border p-4">
      <div className="text-muted mb-1 flex items-center gap-1.5 text-xs font-medium">
        <Icon className="size-3.5" />
        {title}
      </div>
      <div className="text-foreground text-sm">{children}</div>
    </div>
  );
}
