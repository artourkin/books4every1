import { useCallback, useEffect, useRef, useState } from "react";

export function useReaderFullscreen(root: HTMLDivElement | null) {
  const [focused, setFocused] = useState(false),
    [native, setNative] = useState(false);
  const ownedFullscreen = useRef(false);
  const exit = useCallback(async () => {
    setFocused(false);
    if (root && document.fullscreenElement === root) {
      try {
        await document.exitFullscreen();
      } catch {
        /* Focus mode can still exit if the browser declines. */
      }
    }
  }, [root]);
  const enter = useCallback(async () => {
    if (!root) return;
    setFocused(true);
    root.focus({ preventScroll: true });
    if (document.fullscreenEnabled && root.requestFullscreen) {
      try {
        await root.requestFullscreen({ navigationUI: "hide" });
      } catch {
        /* Embedded browsers and unsupported origins retain the CSS focus mode. */
      }
    }
  }, [root]);
  useEffect(() => {
    if (!root) return;
    const changed = () => {
      const active = document.fullscreenElement === root;
      setNative(active);
      if (active) {
        ownedFullscreen.current = true;
        setFocused(true);
      } else if (ownedFullscreen.current) {
        ownedFullscreen.current = false;
        setFocused(false);
      }
    };
    document.addEventListener("fullscreenchange", changed);
    changed();
    return () => {
      document.removeEventListener("fullscreenchange", changed);
      if (document.fullscreenElement === root)
        void document.exitFullscreen().catch(() => {});
    };
  }, [root]);
  return { focused, native, enter, exit };
}
