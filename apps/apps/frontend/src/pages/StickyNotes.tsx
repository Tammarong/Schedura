// src/pages/StickyNotes.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useMotionValue } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  StickyNote as StickyIcon,
  PlusCircle,
  Trash2,
  Palette,
  Layers,
  LayoutGrid,
  Loader2,
  Pencil,
} from "lucide-react";
import { api } from "@/lib/api";

/* ---------- types ---------- */
type BoardLite = {
  id: number;
  title: string;
  is_shared: boolean;
  group_id: number | null;
  created_at: string;
  updated_at: string;
};
type BoardsResponse = {
  owned: BoardLite[];
  shared: BoardLite[];
};

type Note = {
  id: number;
  board_id: number;
  user_id: number;
  content: string;
  color: string | null;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  rotation: number | null;
  z_index: number;       // server shape
  is_archived: boolean;  // server shape
  created_at: string;
  updated_at: string;
};

type BoardWithNotes = {
  id: number;
  title: string;
  is_shared: boolean;
  group_id: number | null;
  created_at: string;
  updated_at: string;
  notes: Note[];
};

/* ---------- helpers ---------- */
function clsx(...arr: Array<string | false | undefined>) {
  return arr.filter(Boolean).join(" ");
}
function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
const NOTE_COLORS = [
  { key: "yellow", className: "bg-yellow-200 text-yellow-950", ring: "ring-yellow-400" },
  { key: "pink", className: "bg-pink-200 text-pink-950", ring: "ring-pink-400" },
  { key: "sky", className: "bg-sky-200 text-sky-950", ring: "ring-sky-400" },
  { key: "lime", className: "bg-lime-200 text-lime-950", ring: "ring-lime-400" },
  { key: "violet", className: "bg-violet-200 text-violet-950", ring: "ring-violet-400" },
] as const;

// map client patch (server-shaped Note) -> API payload (camelCase fields the controller reads)
function toServerPatch(patch: Partial<Note>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if ("content" in patch) out.content = patch.content;
  if ("color" in patch) out.color = patch.color;
  if ("x" in patch) out.x = patch.x;
  if ("y" in patch) out.y = patch.y;
  if ("width" in patch) out.width = patch.width;
  if ("height" in patch) out.height = patch.height;
  if ("rotation" in patch) out.rotation = patch.rotation;
  if ("z_index" in patch) out.zIndex = patch.z_index;
  if ("is_archived" in patch) out.isArchived = patch.is_archived;
  return out;
}

/* =========================================================
   Sticky Notes Page
========================================================= */
export default function StickyNotes() {
  const [loadingBoards, setLoadingBoards] = useState<boolean>(false);
  const [boardsOwned, setBoardsOwned] = useState<BoardLite[]>([]);
  const [boardsShared, setBoardsShared] = useState<BoardLite[]>([]);
  const [activeBoardId, setActiveBoardId] = useState<number | null>(null);

  const [boardLoading, setBoardLoading] = useState<boolean>(false);
  const [board, setBoard] = useState<BoardWithNotes | null>(null);

  // create board dialog
  const [createOpen, setCreateOpen] = useState<boolean>(false);
  const [newBoardTitle, setNewBoardTitle] = useState<string>("");

  // ui
  const canvasRef = useRef<HTMLDivElement | null>(null);

  /* ---------- load boards ---------- */
  useEffect(() => {
    const run = async () => {
      setLoadingBoards(true);
      try {
        const data = await api<BoardsResponse>("/notes/boards");
        setBoardsOwned(data.owned);
        setBoardsShared(data.shared);
        const first = data.owned[0] ?? data.shared[0] ?? null;
        setActiveBoardId(first ? first.id : null);
      } catch (e) {
        console.error(e);
        setBoardsOwned([]);
        setBoardsShared([]);
        setActiveBoardId(null);
      } finally {
        setLoadingBoards(false);
      }
    };
    void run();
  }, []);

  /* ---------- load active board ---------- */
  useEffect(() => {
    const load = async () => {
      if (!activeBoardId) {
        setBoard(null);
        return;
      }
      setBoardLoading(true);
      try {
        const data = await api<BoardWithNotes>(`/notes/boards/${activeBoardId}`);
        setBoard(data);
      } catch (e) {
        console.error(e);
        setBoard(null);
      } finally {
        setBoardLoading(false);
      }
    };
    void load();
  }, [activeBoardId]);

  const allBoards = useMemo<BoardLite[]>(
    () => [...boardsOwned, ...boardsShared],
    [boardsOwned, boardsShared]
  );

  const activeBoardTitle = useMemo(() => {
    if (!activeBoardId) return "";
    const found = allBoards.find((b) => b.id === activeBoardId);
    return found ? found.title : "";
  }, [activeBoardId, allBoards]);

  /* ---------- create board ---------- */
  const handleCreateBoard = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newBoardTitle.trim();
    if (!title) return;
    try {
      const created = await api<BoardLite>("/notes/boards", {
        method: "POST",
        body: { title },
      });
      setBoardsOwned((prev) => [created, ...prev]);
      setActiveBoardId(created.id);
      setNewBoardTitle("");
      setCreateOpen(false);
    } catch (e) {
      console.error(e);
      alert("Failed to create board.");
    }
  };

  /* ---------- notes helpers ---------- */
  const maxZ = useMemo<number>(() => {
    if (!board?.notes?.length) return 0;
    return board.notes.reduce((m, n) => (n.z_index > m ? n.z_index : m), 0);
  }, [board]);

  const onCreateNote = async () => {
    if (!board || !activeBoardId) return;
    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    const cx = rect ? rect.width / 2 : 400;
    const cy = rect ? rect.height / 2 : 250;

    try {
      const created = await api<Note>(`/notes/boards/${activeBoardId}/notes`, {
        method: "POST",
        body: {
          content: "",
          color: "yellow",
          x: Math.max(16, Math.floor(cx - 100)),
          y: Math.max(16, Math.floor(cy - 80)),
          zIndex: maxZ + 1, // IMPORTANT: camelCase for controller
        },
      });
      setBoard((prev) => (prev ? { ...prev, notes: [...prev.notes, created] } : prev));
    } catch (e) {
      console.error(e);
      alert("Could not create note.");
    }
  };

  const onDeleteNote = async (noteId: number) => {
    if (!board) return;
    try {
      await api(`/notes/notes/${noteId}`, { method: "DELETE" });
      setBoard((prev) =>
        prev ? { ...prev, notes: prev.notes.filter((n) => n.id !== noteId) } : prev
      );
    } catch (e) {
      console.error(e);
      alert("Could not delete note.");
    }
  };

  const saveNote = async (noteId: number, patch: Partial<Note>) => {
    try {
      const updated = await api<Note>(`/notes/notes/${noteId}`, {
        method: "PATCH",
        body: toServerPatch(patch),
      });
      setBoard((prev) =>
        prev
          ? {
              ...prev,
              notes: prev.notes.map((n) => (n.id === noteId ? updated : n)),
            }
          : prev
      );
    } catch (e) {
      console.error(e);
    }
  };

  /* ---------- UI ---------- */
  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto px-4 pt-8 pb-10">
        {/* Header / toolbar */}
        <Card className="border bg-card shadow-sm mb-6">
          <CardContent className="p-5 md:p-6">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
              <div>
                <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight flex items-center gap-2">
                  <StickyIcon className="h-7 w-7 text-primary" />
                  Sticky Notes
                </h1>
                <p className="text-muted-foreground mt-1">
                  Drag, edit, and organize notes on your whiteboard.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                {/* Board picker */}
                <div className="flex items-center gap-2">
                  <Label className="text-sm">Board</Label>
                  <Select
                    value={activeBoardId ? String(activeBoardId) : ""}
                    onValueChange={(v) => setActiveBoardId(Number(v))}
                  >
                    <SelectTrigger className="w-56">
                      <SelectValue placeholder={loadingBoards ? "Loading..." : "Select a board"} />
                    </SelectTrigger>
                    <SelectContent>
                      {boardsOwned.length > 0 && (
                        <>
                          <div className="px-2 py-1 text-xs text-muted-foreground">My Boards</div>
                          {boardsOwned.map((b) => (
                            <SelectItem key={b.id} value={String(b.id)}>
                              {b.title}
                            </SelectItem>
                          ))}
                        </>
                      )}
                      {boardsShared.length > 0 && (
                        <>
                          <div className="px-2 py-1 text-xs text-muted-foreground">Shared</div>
                          {boardsShared.map((b) => (
                            <SelectItem key={b.id} value={String(b.id)}>
                              {b.title}
                            </SelectItem>
                          ))}
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </div>

                {/* Create board dialog */}
                <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                  <DialogTrigger asChild>
                    <Button className="gap-2">
                      <PlusCircle className="h-4 w-4" />
                      New Board
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[520px]">
                    <DialogHeader>
                      <DialogTitle>Create a Whiteboard</DialogTitle>
                    </DialogHeader>
                    <form className="space-y-4" onSubmit={handleCreateBoard}>
                      <div className="space-y-2">
                        <Label htmlFor="board-title">Title</Label>
                        <Input
                          id="board-title"
                          value={newBoardTitle}
                          onChange={(e) => setNewBoardTitle(e.target.value)}
                          placeholder="e.g., Physics midterm plan"
                          required
                        />
                      </div>
                      <Button type="submit" className="w-full">
                        Create
                      </Button>
                    </form>
                  </DialogContent>
                </Dialog>

                {/* Create note */}
                <Button onClick={onCreateNote} variant="secondary" className="gap-2">
                  <StickyIcon className="h-4 w-4" />
                  Add Note
                </Button>
              </div>
            </div>

            {/* Board meta */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="gap-1">
                <LayoutGrid className="h-3.5 w-3.5" />
                {activeBoardTitle || "No board selected"}
              </Badge>
              {board && (
                <>
                  <Badge variant="secondary" className="gap-1">
                    <Layers className="h-3.5 w-3.5" />
                    {board.notes.length} notes
                  </Badge>
                  <Badge variant="outline">Updated {fmtDate(board.updated_at)}</Badge>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Canvas */}
        <div
          ref={canvasRef}
          className="relative border rounded-xl bg-background shadow-inner"
          style={{ minHeight: 560 }}
        >
          {boardLoading && (
            <div className="absolute inset-0 grid place-items-center">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                Loading board...
              </div>
            </div>
          )}

          {!boardLoading && !board && (
            <div className="py-20 text-center text-muted-foreground">
              Select or create a board to get started.
            </div>
          )}

          {!boardLoading &&
            board &&
            board.notes.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                canvasRef={canvasRef}
                onChange={(patch) => {
                  setBoard((prev) =>
                    prev
                      ? {
                          ...prev,
                          notes: prev.notes.map((n) =>
                            n.id === note.id ? { ...n, ...patch } : n
                          ),
                        }
                      : prev
                  );
                }}
                onCommit={(patch) => saveNote(note.id, patch as Partial<Note>)}
                onDelete={() => onDeleteNote(note.id)}
              />
            ))}
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   Note Card — motion values + mobile-friendly editing
========================================================= */
function NoteCard({
  note,
  canvasRef,
  onChange,
  onCommit,
  onDelete,
}: {
  note: Note;
  canvasRef: React.RefObject<HTMLDivElement>;
  onChange: (patch: Partial<Note>) => void;
  onCommit: (patch: Partial<Note>) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState<boolean>(false);
  const [localContent, setLocalContent] = useState<string>(note.content);
  const [saving, setSaving] = useState<boolean>(false);
  const elRef = useRef<HTMLDivElement | null>(null);

  // Touch detection: single tap to edit on touch devices
  const isTouch =
    typeof window !== "undefined" &&
    (("ontouchstart" in window) || (navigator.maxTouchPoints || 0) > 0);

  // Drive position with transforms, not left/top
  const x = useMotionValue(note.x);
  const y = useMotionValue(note.y);

  // keep motion values in sync with server/props (e.g., after reload)
  useEffect(() => { x.set(note.x); }, [note.x, x]);
  useEffect(() => { y.set(note.y); }, [note.y, y]);

  useEffect(() => setLocalContent(note.content), [note.content]);
  const colorOpt = NOTE_COLORS.find((c) => c.key === note.color) ?? NOTE_COLORS[0];
  const w = note.width ?? 220;

  const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

  return (
    <motion.div
      ref={elRef}
      className={clsx(
        "absolute rounded-lg shadow-md border p-2",
        colorOpt.className,
        "cursor-grab active:cursor-grabbing"
      )}
      style={{
        x,
        y,
        width: w,
        height: note.height ?? undefined,
        rotate: note.rotation ?? 0,
        zIndex: note.z_index,
      }}
      drag
      dragConstraints={canvasRef}
      dragElastic={0}
      dragMomentum={false}
      whileDrag={{ zIndex: 999 }}
      onDragEnd={() => {
        const canvas = canvasRef.current;
        const el = elRef.current;
        if (!canvas || !el) return;

        const cRect = canvas.getBoundingClientRect();
        const pad = 8;

        const elW = el.offsetWidth;
        const elH = el.offsetHeight;
        const maxX = Math.max(pad, cRect.width - elW - pad);
        const maxY = Math.max(pad, cRect.height - elH - pad);

        const finalX = Math.round(clamp(x.get(), pad, maxX));
        const finalY = Math.round(clamp(y.get(), pad, maxY));

        x.set(finalX);
        y.set(finalY);

        onChange({ x: finalX, y: finalY });
        onCommit({ x: finalX, y: finalY, z_index: note.z_index }); // will be mapped to zIndex
      }}
    >
      {/* header */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1">
          <Palette className="h-4 w-4 opacity-70" />
          <ColorDots
            selected={note.color ?? "yellow"}
            onPick={(key) => {
              onChange({ color: key });
              onCommit({ color: key });
            }}
          />
        </div>
        <div className="flex items-center gap-1.5">
          {/* Mobile-friendly explicit Edit button (works on desktop too) */}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 hover:bg-black/10"
            onClick={() => setEditing(true)}
            title="Edit note"
            aria-label="Edit note"
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 hover:bg-black/10"
            onClick={onDelete}
            title="Delete note"
            aria-label="Delete note"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* content */}
      {!editing ? (
        <div
          className="whitespace-pre-wrap min-h-[48px]"
          onDoubleClick={() => setEditing(true)}        // desktop
          onClick={() => { if (isTouch) setEditing(true); }} // touch: single tap
        >
          {note.content || <span className="opacity-60">{isTouch ? "Tap to edit…" : "Double-click to edit…"}</span>}
        </div>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            try {
              onChange({ content: localContent });
              await onCommit({ content: localContent });
              setEditing(false);
            } finally {
              setSaving(false);
            }
          }}
        >
          <Textarea
            autoFocus
            value={localContent}
            onChange={(e) => setLocalContent(e.target.value)}
            onBlur={async () => {
              if (localContent !== note.content) {
                setSaving(true);
                try {
                  onChange({ content: localContent });
                  await onCommit({ content: localContent });
                } finally {
                  setSaving(false);
                }
              }
              setEditing(false);
            }}
            onKeyDown={async (e) => {
              if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "enter") {
                e.preventDefault();
                setSaving(true);
                try {
                  onChange({ content: localContent });
                  await onCommit({ content: localContent });
                } finally {
                  setSaving(false);
                }
                setEditing(false);
              }
            }}
            rows={4}
            className="bg-transparent border-none focus-visible:ring-0 focus-visible:outline-none p-0"
          />
          {saving && <div className="text-xs mt-1 opacity-70">Saving...</div>}
        </form>
      )}
    </motion.div>
  );
}

/* =========================================================
   Color Dots
========================================================= */
function ColorDots({
  selected,
  onPick,
}: {
  selected: string;
  onPick: (key: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {NOTE_COLORS.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={() => onPick(c.key)}
          className={clsx(
            "h-4 w-4 rounded-full border ring-0 outline-none focus-visible:ring-2 transition",
            c.className,
            selected === c.key ? c.ring : ""
          )}
          title={c.key}
          aria-label={`Color ${c.key}`}
        />
      ))}
    </div>
  );
}
