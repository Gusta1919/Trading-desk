import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { TradeRow } from "@/components/trades/TradeRow";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAppData } from "@/context/AppDataProvider";
import type { Trade } from "@/types";

interface TradesPageProps {
  onSelectTrade: (trade: Trade) => void;
  selectedTradeId?: string | null;
}

export function TradesPage({ onSelectTrade, selectedTradeId }: TradesPageProps) {
  const { trades, loading } = useAppData();
  const [search, setSearch] = useState("");
  const [direction, setDirection] = useState<string>("all");
  const [outcome, setOutcome] = useState<string>("all");

  const filtered = useMemo(() => {
    return trades.filter((t) => {
      const matchSearch =
        !search ||
        t.symbol.toLowerCase().includes(search.toLowerCase()) ||
        t.strategy.toLowerCase().includes(search.toLowerCase()) ||
        t.setupType.toLowerCase().includes(search.toLowerCase()) ||
        t.tags.some((tag) => tag.includes(search.toLowerCase()));

      const matchDirection =
        direction === "all" || t.direction === direction;

      const matchOutcome =
        outcome === "all" ||
        (outcome === "win" && (t.pnl ?? 0) > 0) ||
        (outcome === "loss" && (t.pnl ?? 0) < 0) ||
        (outcome === "be" && (t.pnl ?? 0) === 0);

      return matchSearch && matchDirection && matchOutcome;
    });
  }, [trades, search, direction, outcome]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground animate-pulse">Ładowanie...</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-8 py-6">
        <h1 className="font-serif text-3xl tracking-tight">Trady</h1>
        <p className="mt-1 text-muted-foreground">
          {trades.length} {trades.length === 1 ? "trade" : "tradów"} w dzienniku
        </p>

        <div className="mt-4 flex flex-wrap gap-3">
          <div className="relative min-w-[200px] flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Szukaj symbolu, strategii, tagu..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={direction} onValueChange={setDirection}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Kierunek" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Wszystkie</SelectItem>
              <SelectItem value="long">Long</SelectItem>
              <SelectItem value="short">Short</SelectItem>
            </SelectContent>
          </Select>
          <Select value={outcome} onValueChange={setOutcome}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Wynik" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Wszystkie</SelectItem>
              <SelectItem value="win">Wygrane</SelectItem>
              <SelectItem value="loss">Przegrane</SelectItem>
              <SelectItem value="be">Break-even</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex h-64 items-center justify-center">
            <p className="text-muted-foreground">
              {trades.length === 0
                ? "Dodaj pierwszy trade, aby zacząć"
                : "Brak wyników dla filtrów"}
            </p>
          </div>
        ) : (
          filtered.map((trade) => (
            <TradeRow
              key={trade.id}
              trade={trade}
              onClick={() => onSelectTrade(trade)}
              selected={selectedTradeId === trade.id}
            />
          ))
        )}
      </div>
    </div>
  );
}
