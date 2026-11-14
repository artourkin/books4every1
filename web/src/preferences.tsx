import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type SetStateAction,
} from "react";
import { api } from "./api";
import type { InkTool } from "./ink";
export type Preferences = {
  penWidth: number;
  markerWidth: number;
  inkColor: string;
  inkTool: InkTool;
  inkBrush: "pen" | "highlighter";
  drawWithTouch: boolean;
  fontSize: number;
  theme: "paper" | "night";
  highlightColor: "yellow" | "green" | "pink" | "blue";
  libraryLayout: "grid" | "list";
  librarySort: "recent" | "title" | "author" | "progress";
};
export const defaultPreferences: Preferences = {
  penWidth: 3,
  markerWidth: 12,
  inkColor: "#394137",
  inkTool: "pen",
  inkBrush: "pen",
  drawWithTouch: false,
  fontSize: 100,
  theme: "paper",
  highlightColor: "yellow",
  libraryLayout: "grid",
  librarySort: "recent",
};
type Store = {
  values: Preferences;
  error: string;
  pending: boolean;
  activate: (id: string | null, values?: Preferences) => void;
  set: <K extends keyof Preferences>(
    key: K,
    value: SetStateAction<Preferences[K]>,
  ) => void;
  flush: () => Promise<boolean>;
};
const Context = createContext<Store | null>(null);
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [values, setValues] = useState(defaultPreferences),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  const current = useRef<Preferences>(defaultPreferences),
    profile = useRef<{ id: string } | null>(null),
    queued = useRef<Partial<Preferences>>({}),
    flight = useRef<Promise<boolean> | null>(null),
    timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const activate = useCallback(
    (id: string | null, prefs = defaultPreferences) => {
      clearTimeout(timer.current);
      profile.current = id ? { id } : null;
      queued.current = {};
      flight.current = null;
      current.current = { ...prefs };
      setValues(current.current);
      setError("");
      setPending(false);
    },
    [],
  );
  const flush = useCallback((): Promise<boolean> => {
    clearTimeout(timer.current);
    if (flight.current) return flight.current;
    const active = profile.current;
    if (!active || !Object.keys(queued.current).length)
      return Promise.resolve(true);
    const work = (async () => {
      while (profile.current === active && Object.keys(queued.current).length) {
        const patch = queued.current;
        queued.current = {};
        try {
          const saved = await api<Preferences>("/me/preferences", {
            method: "PATCH",
            keepalive: true,
            headers: { "X-Folio-Profile": active.id },
            body: JSON.stringify(patch),
          });
          if (profile.current !== active) return true;
          current.current = { ...saved, ...queued.current };
          setValues(current.current);
          setError("");
        } catch (e) {
          if (profile.current !== active) return true;
          queued.current = { ...patch, ...queued.current };
          setError((e as Error).message);
          setPending(true);
          return false;
        }
      }
      if (profile.current === active) setPending(false);
      return true;
    })();
    flight.current = work;
    void work.finally(() => {
      if (flight.current === work) flight.current = null;
    });
    return work;
  }, []);
  const set = useCallback(
    <K extends keyof Preferences>(
      key: K,
      value: SetStateAction<Preferences[K]>,
    ) => {
      if (!profile.current) return;
      const next =
        typeof value === "function"
          ? (value as (old: Preferences[K]) => Preferences[K])(
              current.current[key],
            )
          : value;
      if (next === current.current[key]) return;
      current.current = { ...current.current, [key]: next };
      queued.current = { ...queued.current, [key]: next };
      setValues(current.current);
      setPending(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 250);
    },
    [flush],
  );
  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    const warn = (e: BeforeUnloadEvent) => {
      if (Object.keys(queued.current).length || flight.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("beforeunload", warn);
    return () => {
      clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("beforeunload", warn);
    };
  }, [flush]);
  return (
    <Context.Provider value={{ values, error, pending, activate, set, flush }}>
      {children}
    </Context.Provider>
  );
}
export function usePreferences() {
  const store = useContext(Context);
  if (!store) throw new Error("Preferences provider is missing");
  return store;
}
export function usePreference<K extends keyof Preferences>(
  key: K,
): [Preferences[K], (value: SetStateAction<Preferences[K]>) => void] {
  const store = usePreferences();
  return [store.values[key], (value) => store.set(key, value)];
}
export function PreferencesError() {
  const store = usePreferences();
  return store.error ? (
    <div className="preferences-error" role="alert">
      <span>Your preferences have not saved: {store.error}</span>
      <button onClick={() => void store.flush()}>
        Retry saving preferences
      </button>
    </div>
  ) : null;
}
