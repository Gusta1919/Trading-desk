import { useState } from "react";
import { Plus } from "lucide-react";
import { JournalFormDialog } from "@/components/journal/JournalFormDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAppData } from "@/context/AppDataProvider";
import { entryTypeLabel, formatDateTime } from "@/lib/utils";

export function JournalPage() {
  const { journal, loading, refresh } = useAppData();
  const [formOpen, setFormOpen] = useState(false);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground animate-pulse">Ładowanie...</p>
      </div>
    );
  }

  return (
    <div className="p-8">
      <header className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="font-serif text-3xl tracking-tight">Dziennik</h1>
          <p className="mt-1 text-muted-foreground">
            Przemyślenia, refleksje i notatki — serce Twojego procesu
          </p>
        </div>
        <Button onClick={() => setFormOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Nowy wpis
        </Button>
      </header>

      {journal.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <p className="font-serif text-xl text-muted-foreground">
              Twój dziennik czeka na pierwszy wpis
            </p>
            <p className="mt-2 max-w-md text-center text-sm text-muted-foreground">
              Zapisuj myśli przed, w trakcie i po tradzie. To tutaj odkryjesz
              wzorce w swoim zachowaniu.
            </p>
            <Button onClick={() => setFormOpen(true)} className="mt-6">
              Napisz pierwszy wpis
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {journal.map((entry) => (
            <Card
              key={entry.id}
              className="transition-all duration-200 hover:border-accent/20"
            >
              <CardContent className="p-6">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-medium">{entry.title}</h2>
                  <Badge variant="accent">
                    {entryTypeLabel(entry.entryType)}
                  </Badge>
                  {entry.mood != null && (
                    <Badge variant="outline">Nastrój: {entry.mood}/5</Badge>
                  )}
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                  {entry.content}
                </p>
                <p className="mt-4 text-xs text-muted-foreground/60">
                  {formatDateTime(entry.createdAt)}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <JournalFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        onSaved={refresh}
      />
    </div>
  );
}
