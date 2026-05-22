"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatDA } from "@/lib/utils";
import type { Bucket } from "@/lib/stats";

const PRIMARY = "#5C5CE0"; // primary-600

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="border-border rounded-[10px] border bg-white px-3 py-2 text-xs shadow-md">
      <p className="text-muted mb-0.5">{label}</p>
      <p className="text-foreground font-semibold tabular-nums">
        {formatDA(payload[0].value)}
      </p>
    </div>
  );
}

export function RevenueChart({ data }: { data: Bucket[] }) {
  // Sur beaucoup de points (30j / 12 mois), on autorise le scroll horizontal.
  const minWidth = data.length > 14 ? data.length * 44 : undefined;

  return (
    <div className="w-full overflow-x-auto">
      <div style={{ minWidth, height: 260 }} className="min-w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 8, right: 12, left: 4, bottom: 0 }}
          >
            <defs>
              <linearGradient id="caFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={PRIMARY} stopOpacity={0.25} />
                <stop offset="100%" stopColor={PRIMARY} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#ECECF3"
              vertical={false}
            />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "#71717a" }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={16}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#71717a" }}
              tickLine={false}
              axisLine={false}
              width={48}
              tickFormatter={(v: number) =>
                v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)
              }
            />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{ stroke: PRIMARY, strokeOpacity: 0.2 }}
            />
            <Area
              type="monotone"
              dataKey="ca"
              stroke={PRIMARY}
              strokeWidth={2}
              fill="url(#caFill)"
              dot={false}
              activeDot={{ r: 4, fill: PRIMARY }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
