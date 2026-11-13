import { expect, type APIRequestContext } from "@playwright/test";
export async function resetPreferences(request: APIRequestContext) {
  const response = await request.patch("/api/v1/me/preferences", {
    data: {
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
    },
  });
  expect(response.ok()).toBe(true);
}
