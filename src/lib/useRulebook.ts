/**
 * The rulebook for the whole app: the version in force, and every older one a trade
 * may have been graded under. Versions are few and never change once written, so
 * they are all loaded once and kept.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type { Rulebook, RulebookVersion, VersionRow } from "./rulebook";
import { defaultRulebook } from "./rulebookText";
import { deskDay } from "./tz";

export interface RulebookState {
  /** The version in force — the built-in v1.2 until the server answers. */
  doc: Rulebook;
  current: RulebookVersion | null;
  versions: VersionRow[];
  /** Any version's document; the current one for null or an unknown version. */
  rulebookOf: (version: string | null) => Rulebook;
  loaded: boolean;
  /** The New York day the first version was written — when the rulebook began. */
  since: string | undefined;
  reload: () => Promise<void>;
}

export function useRulebook(): RulebookState {
  const [current, setCurrent] = useState<RulebookVersion | null>(null);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [docs, setDocs] = useState<Map<string, Rulebook>>(new Map());

  const reload = useCallback(async () => {
    try {
      const [now, list] = await Promise.all([api.rulebook(), api.versions()]);
      const all = await Promise.all(list.map((v) => (v.version === now.version ? now : api.version(v.version))));
      setDocs(new Map(all.map((v) => [v.version, v.doc])));
      setVersions(list);
      setCurrent(now);
    } catch {
      /* the server is down — the built-in rulebook keeps the desk usable */
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const fallback = useMemo(() => defaultRulebook(), []);
  const doc = current?.doc ?? fallback;
  const rulebookOf = useCallback((v: string | null) => (v ? (docs.get(v) ?? doc) : doc), [docs, doc]);
  const first = versions[versions.length - 1];
  const since = first ? deskDay(new Date(first.createdAt)) : undefined;
  return { doc, current, versions, rulebookOf, loaded: current != null, since, reload };
}
