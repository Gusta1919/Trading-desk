import { useState } from "react";
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
import { createJournalEntry } from "@/lib/db";
import type { JournalEntryType } from "@/types";

interface JournalFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tradeId?: string | null;
  onSaved: () => void;
}

export function JournalFormDialog({
  open,
  onOpenChange,
  tradeId,
  onSaved,
}: JournalFormDialogProps) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [entryType, setEntryType] = useState<JournalEntryType>("general");
  const [mood, setMood] = useState(3);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await createJournalEntry({
        title,
        content,
        entryType,
        mood,
        tradeId: tradeId ?? null,
      });
      setTitle("");
      setContent("");
      setEntryType("general");
      setMood(3);
      onSaved();
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card shadow-2xl">
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <Dialog.Title className="font-serif text-xl">
              Nowy wpis
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon">
                <X className="h-4 w-4" />
              </Button>
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 p-6">
            <div>
              <label className="mb-1.5 block text-xs text-muted-foreground">
                Tytuł
              </label>
              <Input
                required
                placeholder="Refleksja po sesji..."
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-xs text-muted-foreground">
                  Typ wpisu
                </label>
                <Select
                  value={entryType}
                  onValueChange={(v) => setEntryType(v as JournalEntryType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pre_trade">Przed tradem</SelectItem>
                    <SelectItem value="during">W trakcie</SelectItem>
                    <SelectItem value="post_trade">Po tradzie</SelectItem>
                    <SelectItem value="reflection">Refleksja</SelectItem>
                    <SelectItem value="general">Ogólne</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs text-muted-foreground">
                  Nastrój (1–5)
                </label>
                <Input
                  type="number"
                  min={1}
                  max={5}
                  value={mood}
                  onChange={(e) => setMood(parseInt(e.target.value) || 3)}
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs text-muted-foreground">
                Treść
              </label>
              <Textarea
                required
                rows={6}
                placeholder="Twoje przemyślenia, wnioski, obserwacje..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Dialog.Close asChild>
                <Button type="button" variant="ghost">
                  Anuluj
                </Button>
              </Dialog.Close>
              <Button type="submit" disabled={saving}>
                {saving ? "Zapisuję..." : "Zapisz wpis"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
