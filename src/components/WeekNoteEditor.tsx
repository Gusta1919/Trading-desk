import { Check } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import type { WeekNote } from "@/lib/types";
import { Button, Segmented } from "./ui";

/** The weekly note: your bias for the week, the reasoning, and the levels — written once, referenced all week. */
export function WeekNoteEditor({
  week,
  note,
  onSaved,
  onCancel,
  compact = false,
  saveLabel = "Save the week",
}: {
  week: string;
  note: WeekNote | null;
  onSaved: (w: WeekNote) => void;
  onCancel?: () => void;
  /** Smaller fields, for a side panel or a calendar row. */
  compact?: boolean;
  saveLabel?: string;
}) {
  const [bias, setBias] = useState(note?.bias ?? "");
  const [reasoning, setReasoning] = useState(note?.reasoning ?? "");
  const [levels, setLevels] = useState(note?.levels ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      onSaved(await api.saveWeek({ week, bias, reasoning, levels }));
    } finally {
      setSaving(false);
    }
  }

  const text = compact ? "text-[12px]" : "text-[13px]";
  return (
    <div className="space-y-3">
      <Segmented
        size="sm"
        allowNone
        value={bias || null}
        onChange={(v) => setBias(v ?? "")}
        options={[
          { value: "long", label: "Long" },
          { value: "short", label: "Short" },
          { value: "neutral", label: "Neutral" },
        ]}
      />
      <textarea
        className={`field min-h-[64px] resize-none ${text}`}
        placeholder="Why — the weekly chart, the draw on liquidity, the week's events"
        value={reasoning}
        onChange={(e) => setReasoning(e.target.value)}
      />
      <textarea
        className={`field min-h-[44px] resize-none ${text}`}
        placeholder="Levels for the week"
        value={levels}
        onChange={(e) => setLevels(e.target.value)}
      />
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button variant={compact ? "primary" : "accent"} onClick={save} disabled={saving}>
          <Check size={14} /> {saveLabel}
        </Button>
      </div>
    </div>
  );
}
