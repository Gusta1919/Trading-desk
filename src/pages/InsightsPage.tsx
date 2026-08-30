import { AlertTriangle, CheckCircle2, Lightbulb, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAppData } from "@/context/AppDataProvider";
import {
  calculateSetupPerformance,
  calculateStats,
  calculateStrategyPerformance,
} from "@/lib/stats";
import { formatCurrency } from "@/lib/utils";

interface Insight {
  type: "positive" | "warning" | "tip";
  title: string;
  description: string;
}

function generateInsights(
  stats: ReturnType<typeof calculateStats>,
  strategies: ReturnType<typeof calculateStrategyPerformance>,
  setups: ReturnType<typeof calculateSetupPerformance>,
  trades: { followedPlan: boolean | null; emotionalState: number | null; pnl: number | null; tags: string[] }[],
): Insight[] {
  const insights: Insight[] = [];

  if (stats.closedTrades === 0) {
    return [
      {
        type: "tip",
        title: "Zacznij od pierwszego tradu",
        description:
          "Dodaj swoje trady z pełnymi notatkami — im więcej danych, tym lepsze wnioski wygenerujemy automatycznie.",
      },
    ];
  }

  if (stats.planAdherenceRate < 70 && stats.closedTrades >= 3) {
    insights.push({
      type: "warning",
      title: "Niska zgodność z planem",
      description: `Tylko ${stats.planAdherenceRate.toFixed(0)}% tradów było zgodnych z planem. Rozważ checklistę przed każdym wejściem — dyscyplina często poprawia wyniki bardziej niż nowe setupy.`,
    });
  }

  if (stats.profitFactor >= 1.5) {
    insights.push({
      type: "positive",
      title: "Solidny profit factor",
      description: `Twój profit factor wynosi ${stats.profitFactor === Infinity ? "∞" : stats.profitFactor.toFixed(2)} — to dobry znak. Skup się na skalowaniu tego, co już działa.`,
    });
  } else if (stats.profitFactor < 1 && stats.closedTrades >= 5) {
    insights.push({
      type: "warning",
      title: "Profit factor poniżej 1",
      description:
        "Straty przewyższają zyski. Przeanalizuj swoje przegrane trady — szukaj wspólnych wzorców w timing'u, wielkości pozycji lub ignorowaniu stop lossów.",
    });
  }

  const bestStrategy = strategies[0];
  if (bestStrategy && bestStrategy.totalPnl > 0 && strategies.length > 1) {
    insights.push({
      type: "positive",
      title: `Najlepsza strategia: ${bestStrategy.strategy}`,
      description: `Generuje ${formatCurrency(bestStrategy.totalPnl)} przy WR ${bestStrategy.winRate.toFixed(0)}%. Rozważ ograniczenie tradów tylko do tej strategii przez tydzień testowy.`,
    });
  }

  const fomoTrades = trades.filter((t) =>
    t.tags.some((tag) => tag.includes("fomo") || tag.includes("mistake")),
  );
  if (fomoTrades.length >= 2) {
    const fomoPnl = fomoTrades.reduce((s, t) => s + (t.pnl ?? 0), 0);
    insights.push({
      type: "warning",
      title: "Wzorzec FOMO / błędy",
      description: `Masz ${fomoTrades.length} tradów oznaczonych jako FOMO/błąd z łącznym P&L ${formatCurrency(fomoPnl)}. Ustal regułę: po 2 stratach z rzędu — koniec sesji.`,
    });
  }

  const highEmotionLosses = trades.filter(
    (t) => (t.emotionalState ?? 5) <= 2 && (t.pnl ?? 0) < 0,
  );
  if (highEmotionLosses.length >= 2) {
    insights.push({
      type: "warning",
      title: "Emocje a straty",
      description: `${highEmotionLosses.length} strat miało niski stan emocjonalny (≤2). Rozważ przerwę po pierwszej takiej stracie — handluj tylko w stanie 3+.`,
    });
  }

  const bestSetup = setups.find((s) => s.winRate >= 60 && s.trades >= 2);
  if (bestSetup) {
    insights.push({
      type: "tip",
      title: `Setup z potencjałem: ${bestSetup.setup}`,
      description: `Win rate ${bestSetup.winRate.toFixed(0)}% na ${bestSetup.trades} tradach. Zgłęb ten setup — może być Twoim edge'm.`,
    });
  }

  if (stats.currentStreak.type === "loss" && stats.currentStreak.count >= 3) {
    insights.push({
      type: "warning",
      title: `Seria ${stats.currentStreak.count} strat`,
      description:
        "Jesteś w serii przegranych. Wróć do dziennika — przejrzyj ostatnie trady i sprawdź, czy problem leży w setupie, sizing'u czy psychologii.",
    });
  }

  if (insights.length === 0) {
    insights.push({
      type: "tip",
      title: "Kontynuuj dokumentację",
      description:
        "Dodawaj tagi, oceny wykonania i notatki do każdego tradu — to paliwo dla głębszych analiz w przyszłości.",
    });
  }

  return insights;
}

const iconMap = {
  positive: CheckCircle2,
  warning: AlertTriangle,
  tip: Lightbulb,
};

const colorMap = {
  positive: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  warning: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  tip: "text-accent bg-accent/10 border-accent/20",
};

export function InsightsPage() {
  const { trades, loading } = useAppData();
  const stats = calculateStats(trades);
  const strategies = calculateStrategyPerformance(trades);
  const setups = calculateSetupPerformance(trades);
  const insights = generateInsights(stats, strategies, setups, trades);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground animate-pulse">Ładowanie...</p>
      </div>
    );
  }

  return (
    <div className="p-8">
      <header className="mb-8">
        <div className="flex items-center gap-3">
          <TrendingUp className="h-7 w-7 text-accent" />
          <div>
            <h1 className="font-serif text-3xl tracking-tight">Wnioski</h1>
            <p className="mt-1 text-muted-foreground">
              Automatyczna analiza wzorców w Twoim tradingu
            </p>
          </div>
        </div>
      </header>

      <div className="grid gap-4">
        {insights.map((insight, i) => {
          const Icon = iconMap[insight.type];
          return (
            <Card
              key={i}
              className={`border ${colorMap[insight.type].split(" ").slice(2).join(" ")}`}
            >
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-3 text-base">
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-lg ${colorMap[insight.type].split(" ").slice(1, 2).join(" ")}`}
                  >
                    <Icon
                      className={`h-4 w-4 ${colorMap[insight.type].split(" ")[0]}`}
                    />
                  </div>
                  {insight.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {insight.description}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
