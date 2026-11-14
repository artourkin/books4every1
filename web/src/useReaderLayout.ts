import { useEffect, useState } from "react";
const compactQuery =
  "(max-width: 760px), (max-width: 1100px) and (max-height: 500px)";
export function useCompactReader() {
  const [compact, setCompact] = useState(
    () => window.matchMedia(compactQuery).matches,
  );
  useEffect(() => {
    const media = window.matchMedia(compactQuery);
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return compact;
}
