import { createContext, useContext } from "react";
import { gloss } from "@/lib/glossary";
import type { GlossaryEntry } from "@/lib/rulebook";
import { Tip } from "./ui";

/** The rulebook's glossary, for any text below it that wants hover tips. */
export const GlossaryContext = createContext<GlossaryEntry[]>([]);

/** A line of text with each glossary term underlined dotted and explained on hover. */
export function Glossed({ text }: { text: string }) {
  const entries = useContext(GlossaryContext);
  return (
    <>
      {gloss(text, entries).map((p, i) =>
        p.meaning ? (
          <Tip key={i} text={p.meaning} className="underline decoration-faint decoration-dotted underline-offset-[3px]">
            {p.text}
          </Tip>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}
