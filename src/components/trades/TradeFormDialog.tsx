import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createTrade, updateTrade } from "@/lib/db";
import type { Trade, TradeInput } from "@/types";
import { cn } from "@/lib/utils";

interface TradeFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trade?: Trade | null;
  onSaved: () => void;
}

const defaultForm = (): TradeInput => ({
  symbol: "",
  direction: "long",
  entryDate: new Date().toISOString().slice(0, 16),
  entryPrice: 0,
  exitPrice: null,
  quantity: 0,
  stopLoss: null,
  takeProfit: null,
  strategy: "",
  setupType: "",
  session: "regular",
  timeframe: "5m",
  fees: 0,
  emotionalState: 3,
  executionGrade: "B",
  followedPlan: true,
  notes: "",
  tags: [],
  status: "closed",
});

export function TradeFormDialog({
  open,
  onOpenChange,
  trade,
  onSaved,
}: TradeFormDialogProps) {
  const [form, setForm] = useState<TradeInput>(defaultForm);

  useEffect(() => {
    if (!open) return;
    setForm(
      trade
        ? {
            symbol: trade.symbol,
            direction: trade.direction,
            entryDate: trade.entryDate.slice(0, 16),
            exitDate: trade.exitDate?.slice(0, 16) ?? null,
            entryPrice: trade.entryPrice,
            exitPrice: trade.exitPrice,
            quantity: trade.quantity,
            stopLoss: trade.stopLoss,
            takeProfit: trade.takeProfit,
            strategy: trade.strategy,
            setupType: trade.setupType,
            session: trade.session,
            timeframe: trade.timeframe,
            fees: trade.fees,
            emotionalState: trade.emotionalState ?? 3,
            executionGrade: trade.executionGrade ?? "B",
            followedPlan: trade.followedPlan ?? true,
            notes: trade.notes,
            tags: trade.tags,
            status: trade.status,
          }
        : defaultForm(),
    );
  }, [open, trade]);
  const [saving, setSaving] = useState(false);
  const [tagInput, setTagInput] = useState("");

  const update = <K extends keyof TradeInput>(key: K, value: TradeInput[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: TradeInput = {
        ...form,
        entryDate: new Date(form.entryDate).toISOString(),
        exitDate: form.exitDate
          ? new Date(form.exitDate).toISOString()
          : null,
      };
      if (trade) {
        await updateTrade(trade.id, payload);
      } else {
        await createTrade(payload);
      }
      onSaved();
      onOpenChange(false);
      if (!trade) setForm(defaultForm());
    } finally {
      setSaving(false);
    }
  };

  const addTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (tag && !form.tags?.includes(tag)) {
      update("tags", [...(form.tags ?? []), tag]);
    }
    setTagInput("");
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm animate-in fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-2xl max-h-[90vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-border bg-card shadow-2xl animate-in fade-in-0 zoom-in-95">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card/95 backdrop-blur px-6 py-4">
            <Dialog.Title className="font-serif text-xl">
              {trade ? "Edytuj trade" : "Nowy trade"}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon">
                <X className="h-4 w-4" />
              </Button>
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6 p-6">
            <section className="space-y-4">
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Pozycja
              </h3>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <div className="col-span-2 sm:col-span-1">
                  <label className="mb-1.5 block text-xs text-muted-foreground">
                    Symbol
                  </label>
                  <Input
                    required
                    placeholder="NVDA"
                    value={form.symbol}
                    onChange={(e) =>
                      update("symbol", e.target.value.toUpperCase())
                    }
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs text-muted-foreground">
                    Kierunek
                  </label>
                  <Select
                    value={form.direction}
                    onValueChange={(v) =>
                      update("direction", v as "long" | "short")
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="long">Long</SelectItem>
                      <SelectItem value="short">Short</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs text-muted-foreground">
                    Sesja
                  </label>
                  <Select
                    value={form.session}
                    onValueChange={(v) =>
                      update("session", v as TradeInput["session"])
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="premarket">Premarket</SelectItem>
                      <SelectItem value="regular">Regular</SelectItem>
                      <SelectItem value="afterhours">After hours</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <label className="mb-1.5 block text-xs text-muted-foreground">
                    Wejście
                  </label>
                  <Input
                    type="datetime-local"
                    required
                    value={form.entryDate}
                    onChange={(e) => update("entryDate", e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs text-muted-foreground">
                    Wyjście
                  </label>
                  <Input
                    type="datetime-local"
                    value={form.exitDate ?? ""}
                    onChange={(e) =>
                      update("exitDate", e.target.value || null)
                    }
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs text-muted-foreground">
                    Cena wejścia
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    required
                    value={form.entryPrice || ""}
                    onChange={(e) =>
                      update("entryPrice", parseFloat(e.target.value) || 0)
                    }
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs text-muted-foreground">
                    Cena wyjścia
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.exitPrice ?? ""}
                    onChange={(e) =>
                      update(
                        "exitPrice",
                        e.target.value ? parseFloat(e.target.value) : null,
                      )
                    }
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <label className="mb-1.5 block text-xs text-muted-foreground">
                    Ilość
                  </label>
                  <Input
                    type="number"
                    required
                    value={form.quantity || ""}
                    onChange={(e) =>
                      update("quantity", parseFloat(e.target.value) || 0)
                    }
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs text-muted-foreground">
                    Stop loss
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.stopLoss ?? ""}
                    onChange={(e) =>
                      update(
                        "stopLoss",
                        e.target.value ? parseFloat(e.target.value) : null,
                      )
                    }
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs text-muted-foreground">
                    Take profit
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.takeProfit ?? ""}
                    onChange={(e) =>
                      update(
                        "takeProfit",
                        e.target.value ? parseFloat(e.target.value) : null,
                      )
                    }
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs text-muted-foreground">
                    Prowizje
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.fees ?? 0}
                    onChange={(e) =>
                      update("fees", parseFloat(e.target.value) || 0)
                    }
                  />
                </div>
              </div>
            </section>

            <section className="space-y-4">
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Strategia & setup
              </h3>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <div>
                  <label className="mb-1.5 block text-xs text-muted-foreground">
                    Strategia
                  </label>
                  <Input
                    placeholder="Breakout, Mean reversion..."
                    value={form.strategy}
                    onChange={(e) => update("strategy", e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs text-muted-foreground">
                    Setup
                  </label>
                  <Input
                    placeholder="VWAP reclaim, ORB..."
                    value={form.setupType}
                    onChange={(e) => update("setupType", e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs text-muted-foreground">
                    Timeframe
                  </label>
                  <Input
                    placeholder="5m"
                    value={form.timeframe}
                    onChange={(e) => update("timeframe", e.target.value)}
                  />
                </div>
              </div>
            </section>

            <section className="space-y-4">
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Psychologia & wykonanie
              </h3>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <div>
                  <label className="mb-1.5 block text-xs text-muted-foreground">
                    Stan emocjonalny (1–5)
                  </label>
                  <Input
                    type="number"
                    min={1}
                    max={5}
                    value={form.emotionalState ?? 3}
                    onChange={(e) =>
                      update("emotionalState", parseInt(e.target.value) || 3)
                    }
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs text-muted-foreground">
                    Ocena wykonania
                  </label>
                  <Select
                    value={form.executionGrade ?? "B"}
                    onValueChange={(v) => update("executionGrade", v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["A+", "A", "B", "C", "D", "F"].map((g) => (
                        <SelectItem key={g} value={g}>
                          {g}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs text-muted-foreground">
                    Zgodnie z planem?
                  </label>
                  <Select
                    value={form.followedPlan ? "yes" : "no"}
                    onValueChange={(v) => update("followedPlan", v === "yes")}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="yes">Tak</SelectItem>
                      <SelectItem value="no">Nie</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs text-muted-foreground">
                  Notatki
                </label>
                <Textarea
                  placeholder="Co poszło dobrze? Co poprawić?"
                  rows={3}
                  value={form.notes}
                  onChange={(e) => update("notes", e.target.value)}
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs text-muted-foreground">
                  Tagi
                </label>
                <div className="flex gap-2">
                  <Input
                    placeholder="momentum, mistake..."
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addTag();
                      }
                    }}
                  />
                  <Button type="button" variant="secondary" onClick={addTag}>
                    Dodaj
                  </Button>
                </div>
                {form.tags && form.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {form.tags.map((tag) => (
                      <span
                        key={tag}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs",
                        )}
                      >
                        {tag}
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground cursor-pointer"
                          onClick={() =>
                            update(
                              "tags",
                              form.tags!.filter((t) => t !== tag),
                            )
                          }
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <div className="flex justify-end gap-3 border-t border-border pt-4">
              <Dialog.Close asChild>
                <Button type="button" variant="ghost">
                  Anuluj
                </Button>
              </Dialog.Close>
              <Button type="submit" disabled={saving}>
                {saving ? "Zapisuję..." : trade ? "Zapisz zmiany" : "Dodaj trade"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
