import { formatDA } from "@/lib/utils";

/**
 * Jauge « Encours à reverser / plafond » (cf. MAQUETTE-livreur-pages, Compte).
 * Au-delà du plafond (`driver_float_cap_da`), l'acceptation de nouvelles
 * courses est suspendue (garde-fou `driver_can_accept`, cf. docs §8).
 */
export function FloatGauge({
  outstandingDa,
  capDa,
}: {
  outstandingDa: number;
  capDa: number;
}) {
  const pct = Math.min(
    100,
    Math.round((outstandingDa / Math.max(1, capDa)) * 100)
  );
  const over = outstandingDa >= capDa;

  return (
    <div className="rounded-[18px] bg-[#f4f5f9] p-[15px]">
      <div className="mb-2.5 flex items-center justify-between text-[12.5px]">
        <span className="text-[#555]">Encours à reverser</span>
        <b className="font-bold text-[#0a0a0a]">
          {formatDA(outstandingDa)} / {formatDA(capDa)}
        </b>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[#e5e5e5]">
        <div
          className={
            "h-full rounded-full " + (over ? "bg-[#e53935]" : "bg-[#6c2bd9]")
          }
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </div>
      <p className="mt-2.5 text-[11px] leading-relaxed text-[#9e9e9e]">
        {over
          ? "Plafond atteint : l'acceptation de nouvelles courses est suspendue jusqu'au versement."
          : "Au-delà du plafond, l'acceptation de nouvelles courses est suspendue jusqu'au versement."}
      </p>
    </div>
  );
}
