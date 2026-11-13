import type { Preferences } from "./preferences";
export type User = { id: string; username: string; admin: boolean };
export type Session = {
  authenticated: boolean;
  passwordRequired: boolean;
  accountsEnabled: boolean;
  user: User | null;
  profileId?: string;
  preferences?: Preferences;
};
export type Book = {
  id: string;
  title: string;
  author: string;
  format: "PDF" | "EPUB";
  size: number;
  cover: boolean;
  color: string;
  addedAt: string;
  lastRead: string | null;
  progress: number;
  location: string;
  favorite: boolean;
  status: "unread" | "reading" | "finished";
  collection: string;
  sample: boolean;
};
export type Anchor = {
  cfi?: string;
  page?: number;
  rects?: { x: number; y: number; w: number; h: number }[];
};
export type Annotation = {
  id: string;
  bookId: string;
  kind: "highlight" | "bookmark" | "note";
  quote: string;
  note: string;
  color: string;
  anchor: Anchor;
  createdAt: string;
};
export class APIError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "APIError";
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch("/api/v1" + path, {
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    let message = "Something went wrong. Please try again.";
    try {
      message = (await response.json()).error || message;
    } catch {}
    throw new APIError(message, response.status);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
export const updateBook = (id: string, patch: Partial<Book>) =>
  api<Book>(`/books/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
export function exportNotes(notes: Annotation[], books: Book[]) {
  const text =
    "# My Folio notebook\n\n" +
    notes
      .map(
        (n) =>
          `## ${books.find((b) => b.id === n.bookId)?.title || "Book"}\n\n${n.quote ? "> " + n.quote.replace(/\n/g, "\n> ") + "\n\n" : ""}${n.note}\n\n_${n.kind} · ${new Date(n.createdAt).toLocaleDateString()}_\n`,
      )
      .join("\n---\n\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "folio-notebook.md";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
