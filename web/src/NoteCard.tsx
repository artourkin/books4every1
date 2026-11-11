import { useState } from "react";
import {
  Bookmark,
  NotebookPen,
  Trash2,
  Check,
  BookOpen,
  ArrowUpRight,
} from "lucide-react";
import type { Annotation, Book } from "./api";
export function NoteCard({
  note,
  book,
  onRead,
  onDelete,
  onEdit,
}: {
  note: Annotation;
  book?: Book;
  onRead: () => void;
  onDelete: () => void;
  onEdit: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false),
    [text, setText] = useState(note.note);
  return (
    <article className={`note-card note-${note.color}`}>
      <div className="note-top">
        <span>
          {note.kind === "bookmark" ? (
            <Bookmark size={15} />
          ) : (
            <NotebookPen size={15} />
          )}{" "}
          {note.kind}
        </span>
        <button
          className="icon"
          aria-label="Delete annotation"
          onClick={onDelete}
        >
          <Trash2 size={14} />
        </button>
      </div>
      {note.quote && <blockquote>{note.quote}</blockquote>}
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onEdit(text);
            setEditing(false);
          }}
        >
          <textarea
            aria-label="Edit note"
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />
          <button className="text-button" type="submit">
            <Check size={14} />
            Save note
          </button>
        </form>
      ) : (
        <button
          className={`note-body ${!note.note ? "muted" : ""}`}
          onClick={() => setEditing(true)}
        >
          {note.note || "Add a thought…"}
        </button>
      )}
      <button className="note-book" onClick={onRead}>
        <span>
          <BookOpen size={13} />
          {book?.title || "Open passage"}
        </span>
        <ArrowUpRight size={14} />
      </button>
      <small className="note-date">
        {new Date(note.createdAt).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}
        {note.anchor.page ? ` · Page ${note.anchor.page}` : ""}
      </small>
    </article>
  );
}
