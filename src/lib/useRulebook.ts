/**
 * The rulebook for the whole app: the version in force, and every older one a trade
 * may have been graded under — all loaded in one read and reloaded after any save, so
 * every tab reads the same rules at the same moment.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { defaultRulebook } from "./goldModel";
import type { Rulebook, RulebookVersion } from "./rulebook";

export interface RulebookState {
  /** The version in force — the built-in GOLD Model until the server answers. */
  doc: Rulebook;
  current: RulebookVersion | null;
  /** Every version, newest first: the changelog. */
  versions: RulebookVersion[];
  /** Any version's document; the current one for null or an unknown version. */
  rulebookOf: (version: string | null) => Rulebook;
  loaded: boolean;
  reload: () => Promise<void>;
}

export function useRulebook(): RulebookState {
  const [current, setCurrent] = useState<RulebookVersion | null>(null);
  const [versions, setVersions] = useState<RulebookVersion[]>([]);

  const reload = useCallback(async () => {
    try {
      const all = await api.rulebook();
      setVersions(all.versions);
      setCurrent(all.current);
    } catch {
      /* the server is down — the built-in rulebook keeps the desk readable */
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const fallback = useMemo(() => defaultRulebook(), []);
  const doc = current?.doc ?? fallback;
  const docs = useMemo(() => new Map(versions.map((v) => [v.version, v.doc])), [versions]);
  const rulebookOf = useCallback((v: string | null) => (v ? (docs.get(v) ?? doc) : doc), [docs, doc]);
  return { doc, current, versions, rulebookOf, loaded: current != null, reload };
}
