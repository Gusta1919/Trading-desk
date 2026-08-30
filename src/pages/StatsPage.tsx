import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { StatCard } from "@/components/stats/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAppData } from "@/context/AppDataProvider";
import {
  calculateDailyPnl,
  calculateSetupPerformance,
  calculateStats,
  calculateStrategyPerformance,
} from "@/lib/stats";
import { formatCurrency } from "@/lib/utils";

export function StatsPage() {
  const { trades, loading } = useAppData();
  const stats = calculateStats(trades);
  const dailyPnl = calculateDailyPnl(trades);
  const strategies = calculateStrategyPerformance(trades);
  const setups = calculateSetupPerformance(trades);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground animate-pulse">Ładowanie...</p>
      </div>
    );
  }

  const cumulativePnl = dailyPnl.reduce<{ date: string; cumulative: number }[]>(
    (acc, day) => {
      const prev = acc.length ? acc[acc.length - 1].cumulative : 0;
      acc.push({ date: day.date, cumulative: prev + day.pnl });
      return acc;
    },
    [],
  );

  return (
    <div className="space-y-8 p-8">
      <header>
        <h1 className="font-serif text-3xl tracking-tight">Statystyki</h1>
        <p className="mt-1 text-muted-foreground">
          Zaawansowana analityka Twoich tradów
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Expectancy"
          value={formatCurrency(stats.expectancy)}
          subtext="Na trade"
        />
        <StatCard
          label="Śr. wygrana"
          value={formatCurrency(stats.avgWin)}
          trend="positive"
        />
        <StatCard
          label="Śr. przegrana"
          value={formatCurrency(stats.avgLoss)}
          trend="negative"
        />
        <StatCard
          label="Śr. czas trzymania"
          value={`${Math.round(stats.avgHoldTimeMinutes)} min`}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Najlepszy trade"
          value={formatCurrency(stats.bestTrade)}
          trend="positive"
        />
        <StatCard
          label="Najgorszy trade"
          value={formatCurrency(stats.worstTrade)}
          trend="negative"
        />
        <StatCard
          label="Max seria wygranych"
          value={String(stats.maxWinStreak)}
          trend="positive"
        />
        <StatCard
          label="Max seria przegranych"
          value={String(stats.maxLossStreak)}
          trend="negative"
        />
      </div>

      {cumulativePnl.length > 0 && (
        <Card className="glass">
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">
              Skumulowany P&L
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={cumulativePnl}>
                  <XAxis
                    dataKey="date"
                    tick={{ fill: "#71717a", fontSize: 11 }}
                    tickFormatter={(d) => d.slice(5)}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: "#71717a", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `$${v}`}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#111113",
                      border: "1px solid #27272a",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                    formatter={(value) => [
                      formatCurrency(Number(value ?? 0)),
                      "Skumulowany P&L",
                    ]}
                  />
                  <Bar dataKey="cumulative" radius={[4, 4, 0, 0]}>
                    {cumulativePnl.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={entry.cumulative >= 0 ? "#34d399" : "#fb7185"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Wyniki per strategia</CardTitle>
          </CardHeader>
          <CardContent>
            {strategies.length === 0 ? (
              <p className="text-sm text-muted-foreground">Brak danych</p>
            ) : (
              <div className="space-y-3">
                {strategies.map((s) => (
                  <div
                    key={s.strategy}
                    className="flex items-center justify-between rounded-lg border border-border/50 px-4 py-3"
                  >
                    <div>
                      <p className="font-medium text-sm">{s.strategy}</p>
                      <p className="text-xs text-muted-foreground">
                        {s.trades} tradów · WR {s.winRate.toFixed(0)}%
                      </p>
                    </div>
                    <div className="text-right">
                      <p
                        className={`font-mono text-sm ${s.totalPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}
                      >
                        {formatCurrency(s.totalPnl)}
                      </p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {s.avgR >= 0 ? "+" : ""}
                        {s.avgR.toFixed(2)}R śr.
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Wyniki per setup</CardTitle>
          </CardHeader>
          <CardContent>
            {setups.length === 0 ? (
              <p className="text-sm text-muted-foreground">Brak danych</p>
            ) : (
              <div className="space-y-3">
                {setups.map((s) => (
                  <div
                    key={s.setup}
                    className="flex items-center justify-between rounded-lg border border-border/50 px-4 py-3"
                  >
                    <div>
                      <p className="font-medium text-sm">{s.setup}</p>
                      <p className="text-xs text-muted-foreground">
                        {s.trades} tradów · WR {s.winRate.toFixed(0)}%
                      </p>
                    </div>
                    <p
                      className={`font-mono text-sm ${s.totalPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}
                    >
                      {formatCurrency(s.totalPnl)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
