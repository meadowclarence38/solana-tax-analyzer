"use client";

import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { UnifiedTrade } from "@/types/analyze";

const CHART_COLORS = {
  gain: "#22c55e",
  loss: "#ef4444",
  neutral: "#71717a",
  grid: "rgba(255,255,255,0.06)",
  text: "#a1a1aa",
};

// Build PNL over time (cumulative) from unified trades
function buildPnlOverTime(trades: UnifiedTrade[]): { date: string; pnl: number; cumulative: number }[] {
  const points: { date: string; pnl: number; cumulative: number }[] = [];
  const byDate: Record<string, number> = {};
  for (const t of trades) {
    for (const tx of t.transactions) {
      const d = tx.date.slice(0, 10);
      if (!byDate[d]) byDate[d] = 0;
      byDate[d] += tx.type === "sell" ? tx.solAmount : -tx.solAmount;
    }
  }
  const sorted = Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b));
  let cum = 0;
  for (const [date, pnl] of sorted) {
    cum += pnl;
    points.push({ date, pnl, cumulative: cum });
  }
  return points;
}

// Volume by token (SOL spent + received per token)
function buildVolumeByToken(
  trades: UnifiedTrade[],
  getSymbol: (mint: string) => string
): { token: string; volume: number; pnl: number }[] {
  return trades.map((t) => ({
    token: getSymbol(t.tokenMint),
    volume: t.totalSolSpent + t.totalSolReceived,
    pnl: t.pnl,
  }));
}

// Gains vs losses for pie
function buildGainsLosses(trades: UnifiedTrade[]): { name: string; value: number; color: string }[] {
  let gains = 0;
  let losses = 0;
  for (const t of trades) {
    if (t.pnl > 0) gains += t.pnl;
    else if (t.pnl < 0) losses += Math.abs(t.pnl);
  }
  return [
    { name: "Gains", value: gains, color: CHART_COLORS.gain },
    { name: "Losses", value: losses, color: CHART_COLORS.loss },
  ].filter((d) => d.value > 0);
}

interface ChartsProps {
  unifiedTrades: UnifiedTrade[];
  getTokenSymbol: (mint: string) => string;
  isDark?: boolean;
}

export function Charts({ unifiedTrades, getTokenSymbol, isDark = true }: ChartsProps) {
  const pnlOverTime = buildPnlOverTime(unifiedTrades);
  const volumeByToken = buildVolumeByToken(unifiedTrades, getTokenSymbol);
  const gainsLosses = buildGainsLosses(unifiedTrades);

  if (unifiedTrades.length === 0) return null;

  return (
    <div className="space-y-8 mb-10">
      <h3 className="text-lg font-semibold text-white">Charts</h3>

      {pnlOverTime.length > 0 && (
        <div className="rounded-lg bg-zinc-900/80 border border-zinc-800 p-4">
          <h4 className="text-sm font-medium text-zinc-400 mb-3">Cumulative PNL over time (SOL)</h4>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={pnlOverTime} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
                <XAxis dataKey="date" tick={{ fill: CHART_COLORS.text, fontSize: 11 }} />
                <YAxis tick={{ fill: CHART_COLORS.text, fontSize: 11 }} tickFormatter={(v) => v.toFixed(2)} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#27272a", border: "1px solid #3f3f46", borderRadius: 8 }}
                  labelStyle={{ color: "#a1a1aa" }}
                  formatter={(value: number) => [value.toFixed(4), "SOL"]}
                  labelFormatter={(label) => `Date: ${label}`}
                />
                <Line type="monotone" dataKey="cumulative" stroke={CHART_COLORS.gain} strokeWidth={2} dot={false} name="Cumulative PNL" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {volumeByToken.length > 0 && (
        <div className="rounded-lg bg-zinc-900/80 border border-zinc-800 p-4">
          <h4 className="text-sm font-medium text-zinc-400 mb-3">Trade volume by token (SOL)</h4>
          <div className="h-64 w-full overflow-x-auto">
            <ResponsiveContainer width="100%" height="100%" minWidth={300}>
              <BarChart data={volumeByToken.slice(0, 15)} margin={{ top: 5, right: 10, left: 0, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
                <XAxis dataKey="token" tick={{ fill: CHART_COLORS.text, fontSize: 10 }} angle={-45} textAnchor="end" height={50} />
                <YAxis tick={{ fill: CHART_COLORS.text, fontSize: 11 }} tickFormatter={(v) => v.toFixed(1)} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#27272a", border: "1px solid #3f3f46", borderRadius: 8 }}
                  formatter={(value: number) => [value.toFixed(4), "SOL"]}
                />
                <Bar dataKey="volume" fill={CHART_COLORS.neutral} name="Volume" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {gainsLosses.length > 0 && (
        <div className="rounded-lg bg-zinc-900/80 border border-zinc-800 p-4">
          <h4 className="text-sm font-medium text-zinc-400 mb-3">Gains vs losses (SOL)</h4>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={gainsLosses}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={({ name, value }) => `${name}: ${value.toFixed(2)} SOL`}
                >
                  {gainsLosses.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: "#27272a", border: "1px solid #3f3f46", borderRadius: 8 }}
                  formatter={(value: number) => [value.toFixed(4), "SOL"]}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
