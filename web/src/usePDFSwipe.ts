import { useEffect, useRef, type RefObject } from "react";

type Options = {
  enabled: boolean;
  writing: boolean;
  onTurn: (direction: number) => void;
};
type Swipe = {
  id: number;
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  started: number;
  scrollLeft: number;
  scrollTop: number;
  viewLeft: number;
  viewTop: number;
  axis: "pending" | "horizontal" | "vertical";
  verticalTravel: number;
};

// Observe touches separately from ink pointers. A quick horizontal flick turns
// a page; slow drags still pan, and multi-touch remains available to the browser.
export function usePDFSwipe(
  container: RefObject<HTMLDivElement | null>,
  options: Options,
) {
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    let swipe: Swipe | null = null;
    let lastPen = -Infinity;
    const pens = new Set<number>();
    const marker = document.createElement("div");
    marker.setAttribute("aria-hidden", "true");
    marker.style.cssText =
      "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none";
    const positionViewport = (left: number, top: number) => {
      const viewport = window.visualViewport;
      if (!viewport || viewport.scale <= 1.01) return;
      left = Math.max(0, Math.min(innerWidth - viewport.width, left));
      top = Math.max(0, Math.min(innerHeight - viewport.height, top));
      if (
        Math.abs(left - viewport.offsetLeft) < 0.5 &&
        Math.abs(top - viewport.offsetTop) < 0.5
      )
        return;
      // scrollBy only moves the layout viewport. A fixed marker also lets the
      // browser move its pinch-zoomed visual viewport without changing scale.
      marker.style.left = `${left}px`;
      marker.style.top = `${top}px`;
      const host = document.fullscreenElement || document.body;
      if (marker.parentElement !== host) host.append(marker);
      marker.scrollIntoView({
        block: "start",
        inline: "start",
        behavior: "instant",
      });
    };
    const hasSelection = () => window.getSelection()?.isCollapsed === false;
    const pen = (event: PointerEvent) => {
      if (event.pointerType !== "pen") return;
      if (
        event.type === "pointermove" &&
        !event.buttons &&
        !pens.has(event.pointerId)
      )
        return;
      lastPen = performance.now();
      swipe = null;
      if (event.type === "pointerdown") pens.add(event.pointerId);
      if (event.type === "pointerup" || event.type === "pointercancel")
        pens.delete(event.pointerId);
    };
    const available = () =>
      latest.current.enabled &&
      !pens.size &&
      performance.now() - lastPen >= 650 &&
      !hasSelection();
    const start = (event: TouchEvent) => {
      swipe = null;
      if (
        event.touches.length !== 1 ||
        !available() ||
        (event.target as Element).closest("button,input,textarea,select,a")
      )
        return;
      const touch = event.touches[0];
      swipe = {
        id: touch.identifier,
        x: touch.screenX,
        y: touch.screenY,
        lastX: touch.screenX,
        lastY: touch.screenY,
        started: event.timeStamp,
        scrollLeft: node.scrollLeft,
        scrollTop: node.scrollTop,
        viewLeft: window.visualViewport?.offsetLeft || 0,
        viewTop: window.visualViewport?.offsetTop || 0,
        axis: "pending",
        verticalTravel: 0,
      };
    };
    const move = (event: TouchEvent) => {
      if (!swipe) return;
      if (event.touches.length !== 1 || !available()) {
        swipe = null;
        return;
      }
      const touch = event.touches[0];
      if (touch.identifier !== swipe.id) return;
      const x = touch.screenX - swipe.x;
      const y = touch.screenY - swipe.y;
      swipe.verticalTravel = Math.max(swipe.verticalTravel, Math.abs(y));
      if (swipe.axis === "pending") {
        if (Math.abs(x) < 4 && Math.abs(y) < 4) return;
        swipe.axis =
          Math.abs(x) >= Math.abs(y) * 1.8 ? "horizontal" : "vertical";
        if (
          (!latest.current.writing && swipe.axis === "vertical") ||
          !event.cancelable
        ) {
          swipe = null;
          return;
        }
      }
      // Keep vertical reading scroll native. Handle horizontal drags and all
      // writing-mode drags here, so a flick can finish without scroll inertia.
      if (event.cancelable) event.preventDefault();
      const viewport = window.visualViewport;
      const scale = viewport?.scale || 1;
      const dx = (swipe.lastX - touch.screenX) / scale;
      const dy = (swipe.lastY - touch.screenY) / scale;
      const previousLeft = node.scrollLeft;
      const previousTop = node.scrollTop;
      node.scrollBy(dx, dy);
      if (viewport && scale > 1.01) {
        positionViewport(
          viewport.offsetLeft + dx - (node.scrollLeft - previousLeft),
          viewport.offsetTop + dy - (node.scrollTop - previousTop),
        );
      }
      swipe.lastX = touch.screenX;
      swipe.lastY = touch.screenY;
    };
    const end = (event: TouchEvent) => {
      const previous = swipe;
      swipe = null;
      if (!previous || event.touches.length || !available()) return;
      const touch = Array.from(event.changedTouches).find(
        (touch) => touch.identifier === previous.id,
      );
      if (!touch) return;
      const distance = touch.screenX - previous.x;
      const duration = event.timeStamp - previous.started;
      if (
        previous.axis === "horizontal" &&
        Math.abs(distance) >= 64 &&
        duration <= 600 &&
        Math.abs(distance) / Math.max(1, duration) >= 0.3 &&
        Math.max(
          previous.verticalTravel,
          Math.abs(touch.screenY - previous.y),
        ) *
          1.8 <
          Math.abs(distance)
      ) {
        if (event.cancelable) event.preventDefault();
        // A flick may have started panning. Keep the view from before the
        // gesture on the next page, just as when using the arrow buttons.
        node.scrollTo({
          left: previous.scrollLeft,
          top: previous.scrollTop,
          behavior: "instant",
        });
        positionViewport(previous.viewLeft, previous.viewTop);
        latest.current.onTurn(distance < 0 ? 1 : -1);
      }
    };
    const cancel = () => {
      swipe = null;
    };
    const blur = () => {
      cancel();
      pens.clear();
      lastPen = performance.now();
    };
    const penEvents = ["pointerdown", "pointermove"] as const;
    penEvents.forEach((type) => node.addEventListener(type, pen, true));
    window.addEventListener("pointerup", pen, true);
    window.addEventListener("pointercancel", pen, true);
    node.addEventListener("touchstart", start, { passive: true });
    node.addEventListener("touchmove", move, { passive: false });
    node.addEventListener("touchend", end, { passive: false });
    node.addEventListener("touchcancel", cancel);
    window.addEventListener("blur", blur);
    return () => {
      penEvents.forEach((type) => node.removeEventListener(type, pen, true));
      window.removeEventListener("pointerup", pen, true);
      window.removeEventListener("pointercancel", pen, true);
      node.removeEventListener("touchstart", start);
      node.removeEventListener("touchmove", move);
      node.removeEventListener("touchend", end);
      node.removeEventListener("touchcancel", cancel);
      window.removeEventListener("blur", blur);
      marker.remove();
    };
  }, [container]);
}
