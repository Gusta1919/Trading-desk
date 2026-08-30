import { Pencil, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PnlDisplay } from "@/components/stats/StatCard";
import { deleteTrade } from "@/lib/db";
import {
  formatDateTime,
  pnlColor,
  sessionLabel,
} from "@/lib/utils";
import type { Trade } from "@/types";

interface TradeDetailPanelProps {
  trade: Trade;
  onClose: () => void;
  onEdit: (trade: Trade) => void;
  onDeleted: () => void;
}

export function TradeDetailPanel({
  trade,
  onClose,
  onEdit,
  onDeleted,
}: TradeDetailPanelProps) {
  const handleDelete = async () => {
    if (confirm("Usunąć ten trade? Tej operacji nie można cofnąć.")) {
      await deleteTrade(trade.id);
      onDeleted();
      onClose();
    }
  };

  return (
    <aside className="flex h-full w-[360px] shrink-0 flex-col border-l border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <h2 className="font-mono text-lg font-medium">{trade.symbol}</h2>
          <p className="text-xs text-muted-foreground">
            {formatDateTime(trade.entryDate)}
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-6">
        <div className="text-center py-4">
          <PnlDisplay value={trade.pnl} className="text-3xl font-medium" />
          {trade.rMultiple != null && (
            <p className={`mt-1 font-mono text-sm ${pnlColor(trade.rMultiple)}`}>
              {trade.rMultiple >= 0 ? "+" : ""}
              {trade.rMultiple.toFixed(2)}R
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge variant={trade.direction === "long" ? "success" : "danger"}>
            {trade.direction.toUpperCase()}
          </Badge>
          <Badge variant="outline">{sessionLabel(trade.session)}</Badge>
          {trade.timeframe && (
            <Badge variant="outline">{trade.timeframe}</Badge>
          )}
          {trade.executionGrade && (
            <Badge variant="accent">Ocena: {trade.executionGrade}</Badge>
          )}
        </div>

        <section className="space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Szczegóły
          </h3>
          <DetailRow label="Wejście" value={`$${trade.entryPrice.toFixed(2)}`} />
          <DetailRow
            label="Wyjście"
            value={
              trade.exitPrice != null
                ? `$${trade.exitPrice.toFixed(2)}`
                : "—"
            }
          />
          <DetailRow label="Ilość" value={String(trade.quantity)} />
          <DetailRow
            label="Stop loss"
            value={
              trade.stopLoss != null ? `$${trade.stopLoss.toFixed(2)}` : "—"
            }
          />
          {trade.strategy && (
            <DetailRow label="Strategia" value={trade.strategy} />
          )}
          {trade.setupType && (
            <DetailRow label="Setup" value={trade.setupType} />
          )}
          <DetailRow
            label="Zgodnie z planem"
            value={
              trade.followedPlan == null
                ? "—"
                : trade.followedPlan
                  ? "Tak ✓"
                  : "Nie ✗"
            }
          />
          {trade.emotionalState != null && (
            <DetailRow
              label="Stan emocjonalny"
              value={`${trade.emotionalState}/5`}
            />
          )}
        </section>

        {trade.notes && (
          <section>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Notatki
            </h3>
            <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap">
              {trade.notes}
            </p>
          </section>
        )}

        {trade.tags.length > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Tagi
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {trade.tags.map((tag) => (
                <Badge key={tag} variant="outline">
                  {tag}
                </Badge>
              ))}
            </div>
          </section>
        )}
      </div>

      <div className="flex gap-2 border-t border-border p-4">
        <Button
          variant="secondary"
          className="flex-1 gap-2"
          onClick={() => onEdit(trade)}
        >
          <Pencil className="h-4 w-4" />
          Edytuj
        </Button>
        <Button variant="destructive" size="icon" onClick={handleDelete}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </aside>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}
