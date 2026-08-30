import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PnlDisplay } from "@/components/stats/StatCard";
import { cn, formatDateTime } from "@/lib/utils";
import type { Trade } from "@/types";

interface TradeRowProps {
  trade: Trade;
  onClick?: () => void;
  selected?: boolean;
}

export function TradeRow({ trade, onClick, selected }: TradeRowProps) {
  const isLong = trade.direction === "long";

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left transition-all duration-200 cursor-pointer",
        onClick && "hover:bg-muted/50",
        selected && "bg-accent/5 border-l-2 border-l-accent",
      )}
    >
      <div className="flex items-center gap-4 px-5 py-4 border-b border-border/50">
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
            isLong ? "bg-emerald-500/10" : "bg-rose-500/10",
          )}
        >
          {isLong ? (
            <ArrowUpRight className="h-4 w-4 text-emerald-400" />
          ) : (
            <ArrowDownRight className="h-4 w-4 text-rose-400" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono font-medium">{trade.symbol}</span>
            <Badge variant={isLong ? "success" : "danger"}>
              {isLong ? "LONG" : "SHORT"}
            </Badge>
            {trade.setupType && (
              <Badge variant="outline">{trade.setupType}</Badge>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {formatDateTime(trade.entryDate)}
            {trade.strategy && ` · ${trade.strategy}`}
          </p>
        </div>

        <div className="text-right shrink-0">
          <PnlDisplay value={trade.pnl} className="text-sm font-medium" />
          {trade.rMultiple != null && (
            <p className="mt-0.5 font-mono text-xs text-muted-foreground">
              {trade.rMultiple >= 0 ? "+" : ""}
              {trade.rMultiple.toFixed(2)}R
            </p>
          )}
        </div>
      </div>
    </button>
  );
}

export function TradeCard({ trade, onClick }: TradeRowProps) {
  return (
    <Card
      className="cursor-pointer transition-all duration-200 hover:border-accent/30 hover:shadow-lg hover:shadow-accent/5"
      onClick={onClick}
    >
      <CardContent className="p-4">
        <TradeRow trade={trade} />
      </CardContent>
    </Card>
  );
}
