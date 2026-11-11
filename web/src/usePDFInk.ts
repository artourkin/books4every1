import { useCallback, useEffect, useRef, useState } from "react";
import { api, APIError } from "./api";
import type { InkPage, InkStroke } from "./ink";
type Change = { before: InkStroke[]; after: InkStroke[] };
type PageState = {
  strokes: InkStroke[];
  revision: number;
  loaded: boolean;
  loading: boolean;
  dirty: boolean;
  saving: boolean;
  error: string;
  conflict: boolean;
  undo: Change[];
  redo: Change[];
  generation: number;
  timer?: ReturnType<typeof setTimeout>;
  inFlight?: Promise<boolean>;
};

export function usePDFInk(bookId: string, page: number, enabled: boolean) {
  const pages = useRef(new Map<number, PageState>()),
    mounted = useRef(true);
  const [, render] = useState(0);
  const notify = useCallback(() => {
    if (mounted.current) render((t) => t + 1);
  }, []);
  const state = useCallback((p: number) => {
    let entry = pages.current.get(p);
    if (!entry) {
      entry = {
        strokes: [],
        revision: 0,
        loaded: false,
        loading: false,
        dirty: false,
        saving: false,
        error: "",
        conflict: false,
        undo: [],
        redo: [],
        generation: 0,
      };
      pages.current.set(p, entry);
    }
    return entry;
  }, []);
  const load = useCallback(
    async (p: number, reload = false) => {
      const entry = state(p);
      if (entry.loading || (entry.loaded && !reload)) return;
      entry.loading = true;
      entry.error = "";
      notify();
      try {
        const saved = await api<InkPage>(`/books/${bookId}/ink/${p}`);
        Object.assign(entry, {
          strokes: saved.strokes,
          revision: saved.revision,
          loaded: true,
          dirty: false,
          conflict: false,
          undo: [],
          redo: [],
        });
      } catch (e) {
        entry.error = (e as Error).message;
      } finally {
        entry.loading = false;
        notify();
      }
    },
    [bookId, state, notify],
  );
  const save = useCallback(
    (p: number): Promise<boolean> => {
      const entry = state(p);
      clearTimeout(entry.timer);
      if (entry.inFlight) return entry.inFlight;
      if (entry.conflict) return Promise.resolve(false);
      if (!entry.dirty) return Promise.resolve(true);
      entry.error = "";
      entry.saving = true;
      notify();
      entry.inFlight = (async () => {
        try {
          while (entry.dirty) {
            const generation = entry.generation,
              strokes = entry.strokes;
            const saved = await api<InkPage>(`/books/${bookId}/ink/${p}`, {
              method: "PUT",
              body: JSON.stringify({ revision: entry.revision, strokes }),
            });
            entry.revision = saved.revision;
            entry.dirty = entry.generation !== generation;
          }
          return true;
        } catch (e) {
          entry.error = (e as Error).message;
          entry.conflict = e instanceof APIError && e.status === 409;
          return false;
        } finally {
          entry.saving = false;
          entry.inFlight = undefined;
          notify();
        }
      })();
      return entry.inFlight;
    },
    [bookId, state, notify],
  );
  const persist = useCallback(
    (p: number) => {
      const entry = state(p);
      entry.generation++;
      entry.dirty = true;
      entry.error = "";
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => void save(p), 350);
      notify();
    },
    [state, save, notify],
  );
  const change = useCallback(
    (p: number, strokes: InkStroke[]) => {
      const entry = state(p);
      if (!entry.loaded || entry.loading || entry.conflict) return;
      entry.undo = [
        ...entry.undo.slice(-49),
        { before: entry.strokes, after: strokes },
      ];
      entry.redo = [];
      entry.strokes = strokes;
      persist(p);
    },
    [state, persist],
  );
  const undo = useCallback(() => {
    const entry = state(page);
    if (entry.conflict) return;
    const edit = entry.undo.pop();
    if (!edit) return;
    entry.redo.push(edit);
    entry.strokes = edit.before;
    persist(page);
  }, [state, page, persist]);
  const redo = useCallback(() => {
    const entry = state(page);
    if (entry.conflict) return;
    const edit = entry.redo.pop();
    if (!edit) return;
    entry.undo.push(edit);
    entry.strokes = edit.after;
    persist(page);
  }, [state, page, persist]);
  const flush = useCallback(async () => {
    let ok = true;
    for (const p of pages.current.keys()) {
      if (!(await save(p))) ok = false;
    }
    return ok;
  }, [save]);
  useEffect(() => {
    if (enabled) void load(page);
  }, [enabled, page, load]);
  useEffect(() => {
    mounted.current = true;
    const warn = (e: BeforeUnloadEvent) => {
      if ([...pages.current.values()].some((p) => p.dirty || p.saving)) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      mounted.current = false;
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("visibilitychange", hidden);
      void flush();
    };
  }, [flush]);
  const current = state(page);
  return {
    ...current,
    change: (strokes: InkStroke[]) => change(page, strokes),
    undo,
    redo,
    canUndo: current.undo.length > 0 && !current.conflict,
    canRedo: current.redo.length > 0 && !current.conflict,
    retry: () => (current.loaded ? save(page) : load(page, true)),
    reload: () => load(page, true),
    flush,
    getErrorPage: () =>
      [...pages.current.entries()].find(([, p]) => p.error)?.[0],
    pending: [...pages.current.values()].some((p) => p.dirty || p.saving),
  };
}
