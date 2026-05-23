import { CustomerShell } from "@/components/customer/customer-shell";
import { SearchView } from "@/components/customer/search-view";
import {
  listMerchantCategories,
  listPublicMerchants,
} from "@/lib/data/merchants-public";

export const dynamic = "force-dynamic";

type SP = {
  q?: string;
  category?: string;
  wilaya?: string;
  commune?: string;
  sort?: string;
  open_now?: string;
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = (await searchParams) ?? {};

  const [results, categories] = await Promise.all([
    listPublicMerchants({
      q: sp.q,
      category: sp.category,
      wilaya_code: sp.wilaya,
      commune: sp.commune,
      sort: sp.sort === "min_order" ? "min_order" : "name",
      limit: 100,
    }),
    listMerchantCategories(),
  ]);

  return (
    <CustomerShell>
      <div className="mx-auto max-w-[1400px] px-4 py-4 lg:px-6 lg:py-8">
        <SearchView
          initialResults={results}
          categories={categories}
          initial={{
            q: sp.q ?? "",
            category: sp.category ?? "",
            wilaya: sp.wilaya ?? "",
            commune: sp.commune ?? "",
            sort: (sp.sort === "min_order" ? "min_order" : "name") as
              | "name"
              | "min_order",
            openNow: sp.open_now === "1",
          }}
        />
      </div>
    </CustomerShell>
  );
}
