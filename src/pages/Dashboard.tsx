import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TradeRow } from "@/components/trades/TradeRow";
import { StatCard } from "@/components/stats/StatCard";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAppData } from "@/context/AppDataProvider";
import { calculateDailyPnl, calculateStats } from "@/lib/stats";
import { entryTypeLabel, formatCurrency, formatDateTime } from "@/lib/utils";
import type { Trade, ViewId } from "@/types";

interface DashboardProps {
  onNavigate: (view: ViewId) => void;
  onSelectTrade: (trade: Trade) => void;
}

export function Dashboard({ onNavigate, onSelectTrade }: DashboardProps) {
  const { trades, journal, loading } = useAppData();
  const stats = calculateStats(trades);
  const dailyPnl = calculateDailyPnl(trades);
  const recentTrades = trades.slice(0, 5);
  const recentJournal = journal.slice(0, 3);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground animate-pulse">Ładowanie...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 p-8">
      <header>
        <h1 className="font-serif text-3xl tracking-tight">
          Witaj z powrotem
        </h1>
        <p className="mt-1 text-muted-foreground">
          Twój dziennik tradingowy — wszystko w jednym miejscu
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Całkowity P&L"
          value={formatCurrency(stats.totalPnl)}
          trend={
            stats.totalPnl > 0
              ? "positive"
              : stats.totalPnl < 0
                ? "negative"
                : "neutral"
          }
          subtext={`${stats.closedTrades} zamkniętych tradów`}
        />
        <StatCard
          label="Win rate"
          value={`${stats.winRate.toFixed(1)}%`}
          subtext={`${stats.wins}W / ${stats.losses}L`}
          trend={
            stats.winRate >= 50
              ? "positive"
              : stats.winRate > 0
                ? "negative"
                : "neutral"
          }
        />
        <StatCard
          label="Profit factor"
          value={
            stats.profitFactor === Infinity
              ? "∞"
              : stats.profitFactor.toFixed(2)
          }
          subtext={`Expectancy: ${formatCurrency(stats.expectancy)}`}
        />
        <StatCard
          label="Średnie R"
          value={`${stats.avgRMultiple >= 0 ? "+" : ""}${stats.avgRMultiple.toFixed(2)}R`}
          subtext={`Plan: ${stats.planAdherenceRate.toFixed(0)}% zgodności`}
        />
      </div>

      {dailyPnl.length > 0 && (
        <Card className="glass">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Krzywa equity (dzienna)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[200px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dailyPnl}>
                  <defs>
                    <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#d4a853" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#d4a853" stopOpacity={0} />
                    </linearGradient>
                  </defs>
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
                      "P&L",
                    ]}
                  />
                  <Area
                    type="monotone"
                    dataKey="pnl"
                    stroke="#d4a853"
                    fill="url(#pnlGradient)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Ostatnie trady</CardTitle>
            <button
              onClick={() => onNavigate("trades")}
              className="text-xs text-accent hover:underline cursor-pointer"
            >
              Zobacz wszystkie →
            </button>
          </CardHeader>
          <CardContent className="p-0">
            {recentTrades.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                Brak tradów. Dodaj pierwszy!
              </p>
            ) : (
              recentTrades.map((trade) => (
                <TradeRow
                  key={trade.id}
                  trade={trade}
                  onClick={() => onSelectTrade(trade)}
                />
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Dziennik</CardTitle>
            <button
              onClick={() => onNavigate("journal")}
              className="text-xs text-accent hover:underline cursor-pointer"
            >
              Wszystkie wpisy →
            </button>
          </CardHeader>
          <CardContent className="space-y-4">
            {recentJournal.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Brak wpisów w dzienniku
              </p>
            ) : (
              recentJournal.map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-lg border border-border/50 p-4 transition-colors hover:border-border"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{entry.title}</span>
                    <Badge variant="accent">
                      {entryTypeLabel(entry.entryType)}
                    </Badge>
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                    {entry.content}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground/60">
                    {formatDateTime(entry.createdAt)}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
