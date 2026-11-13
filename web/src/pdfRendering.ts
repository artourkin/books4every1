import { useEffect, useState } from "react";

// A readable baseline on narrow layouts, with a bounded bitmap on large pages.
export const PDF_MIN_RENDER_WIDTH = 2048;
export const PDF_MAX_CANVAS_PIXELS = 16 * 1024 * 1024;
export const PDF_MAX_CANVAS_DIMENSION = 8192;
export function pdfOutputScale(
  width: number,
  height: number,
  displayScale: number,
) {
  const requested = Math.max(displayScale, PDF_MIN_RENDER_WIDTH / width);
  return Math.min(
    requested,
    PDF_MAX_CANVAS_DIMENSION / width,
    PDF_MAX_CANVAS_DIMENSION / height,
    Math.sqrt(PDF_MAX_CANVAS_PIXELS / (width * height)),
  );
}
const currentScale = () =>
  Math.max(1, window.devicePixelRatio || 1) *
  Math.max(1, window.visualViewport?.scale || 1);
export function usePDFDisplayScale() {
  const [scale, setScale] = useState(currentScale);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>, media: MediaQueryList;
    // Re-render after a pinch settles instead of continually interrupting the rasterizer.
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setScale(currentScale()), 140);
    };
    const watchResolution = () => {
      media?.removeEventListener("change", resolutionChanged);
      media = window.matchMedia(
        `(resolution: ${window.devicePixelRatio || 1}dppx)`,
      );
      media.addEventListener("change", resolutionChanged);
    };
    const resolutionChanged = () => {
      watchResolution();
      schedule();
    };
    watchResolution();
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    return () => {
      clearTimeout(timer);
      media?.removeEventListener("change", resolutionChanged);
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
    };
  }, []);
  return scale;
}
