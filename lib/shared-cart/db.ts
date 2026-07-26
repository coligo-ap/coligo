// =============================================================================
// Accès table `shared_carts` (HORS types générés) — builder minimal typé UNE
// seule fois, au lieu d'un cast structurel inline par module (il y en avait
// quatre : on-paid, room-order ×2, selfheal, + les actions /payer). Couvre les
// chaînes réellement utilisées : select→eq[→eq|→is]→maybeSingle et
// update→eq[→eq|→is][→select→maybeSingle | await direct].
// =============================================================================

type Row = Record<string, unknown>;
type QueryError = { message: string } | null;

export interface SharedCartsBuilder extends PromiseLike<{
  data: Row[] | null;
  error: QueryError;
}> {
  eq(col: string, v: string): SharedCartsBuilder;
  is(col: string, v: null): SharedCartsBuilder;
  select(cols: string): SharedCartsBuilder;
  maybeSingle<T = Row>(): PromiseLike<{ data: T | null; error: QueryError }>;
}

export interface SharedCartsTable {
  select(cols: string): SharedCartsBuilder;
  update(values: Row): SharedCartsBuilder;
}

/** `sharedCarts(admin).select(…)` — accepte n'importe quel client Supabase. */
export function sharedCarts(client: unknown): SharedCartsTable {
  const from = (client as { from: (t: string) => unknown }).from.bind(
    client
  ) as (t: string) => SharedCartsTable;
  return from("shared_carts");
}
