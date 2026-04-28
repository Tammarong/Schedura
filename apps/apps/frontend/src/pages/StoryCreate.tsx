import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { X, Type, Pencil, ImagePlus, Smile, Music2, Layers } from "lucide-react";
import { useNavigate } from "react-router-dom";

type Tool = "image" | "text" | "draw" | "stickers" | "music";

type TextItem = {
  id: string;
  text: string;
  x: number; // 0..1
  y: number; // 0..1
  scale: number; // relative
  rotation: number; // deg
  color: string;
  font: "sans" | "serif" | "mono";
  align: "left" | "center" | "right";
  highlight: boolean;
};

type StickerItem = {
  id: string;
  kind: "emoji";
  value: string; // emoji char
  x: number;
  y: number;
  scale: number;
  rotation: number;
};

type ImageItem = {
  id: string;
  src: string;
  baseW: number; // natural pixels
  baseH: number;
  x: number; // 0..1 center
  y: number; // 0..1 center
  scale: number; // relative to base
  rotation: number; // deg
  opacity: number; // 0..1
};

type Stroke = {
  color: string;
  size: number; // px @1080 base
  points: Array<{ x: number; y: number }>; // normalized 0..1
};

const CANVAS_W = 1080;
const CANVAS_H = 1920;
const DEFAULT_COLORS = ["#ffffff", "#000000", "#FF2E63", "#FF8A00", "#FFD60A", "#55E6C1", "#00BFFF", "#7C3AED", "#EA4335"];

export default function StoryCreate() {
  const nav = useNavigate();

  // stage / tool
  const [activeTool, setActiveTool] = useState<Tool>("image");
  const stageRef = useRef<HTMLDivElement | null>(null);
  const drawCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // layers
  const [images, setImages] = useState<ImageItem[]>([]);
  const [texts, setTexts] = useState<TextItem[]>([]);
  const [stickers, setStickers] = useState<StickerItem[]>([]);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // drawing tool state
  const [drawColor, setDrawColor] = useState(DEFAULT_COLORS[0]);
  const [drawSize, setDrawSize] = useState(12);
  const [isDrawing, setIsDrawing] = useState(false);

  // caption (optional)
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);

  // music (preview-only; uploaded as extra metadata fields)
  const [musicFile, setMusicFile] = useState<File | null>(null);
  const [musicUrl, setMusicUrl] = useState<string | null>(null);
  const [musicStart, setMusicStart] = useState(0); // seconds
  const [musicDur, setMusicDur] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      // cleanup objectURLs
      images.forEach(i => URL.revokeObjectURL(i.src));
      if (musicUrl) URL.revokeObjectURL(musicUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ----------------------------- utilities ----------------------------- */
  function percentFromClient(stage: HTMLDivElement, clientX: number, clientY: number) {
    const r = stage.getBoundingClientRect();
    const x = (clientX - r.left) / r.width;
    const y = (clientY - r.top) / r.height;
    return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
  }

  function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  /* ----------------------------- add layers ----------------------------- */
  async function addImageFromFile(f: File) {
    const url = URL.createObjectURL(f);
    const img = await loadImage(url);
    // initial scale: fit 70% of width
    const targetW = CANVAS_W * 0.7;
    const scale = targetW / img.naturalWidth;
    const item: ImageItem = {
      id: crypto.randomUUID(),
      src: url,
      baseW: img.naturalWidth,
      baseH: img.naturalHeight,
      x: 0.5,
      y: 0.5,
      scale: Math.max(0.2, Math.min(3, scale)),
      rotation: 0,
      opacity: 1,
    };
    setImages(arr => [...arr, item]);
    setSelectedId(item.id);
    setActiveTool("image");
  }

  function addText() {
    const newItem: TextItem = {
      id: crypto.randomUUID(),
      text: "Your text",
      x: 0.5,
      y: 0.5,
      scale: 1,
      rotation: 0,
      color: "#ffffff",
      font: "sans",
      align: "center",
      highlight: false,
    };
    setTexts(t => [...t, newItem]);
    setSelectedId(newItem.id);
    setActiveTool("text");
  }

  function addSticker(emoji: string) {
    const newItem: StickerItem = {
      id: crypto.randomUUID(),
      kind: "emoji",
      value: emoji,
      x: 0.5,
      y: 0.5,
      scale: 1.2,
      rotation: 0,
    };
    setStickers(s => [...s, newItem]);
    setSelectedId(newItem.id);
    setActiveTool("stickers");
  }

  /* ----------------------------- select/drag ----------------------------- */
  const dragState = useRef<{ id: string | null; kind: "image" | "text" | "sticker" | null }>({
    id: null, kind: null
  });

  function beginDrag(e: React.PointerEvent, id: string, kind: "image" | "text" | "sticker") {
    if (!stageRef.current) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragState.current = { id, kind };
    setSelectedId(id);
  }

  function onDrag(e: React.PointerEvent) {
    if (!stageRef.current) return;
    const { id, kind } = dragState.current;
    if (!id || !kind) return;
    const p = percentFromClient(stageRef.current, e.clientX, e.clientY);
    if (kind === "image") setImages(arr => arr.map(i => i.id === id ? { ...i, x: p.x, y: p.y } : i));
    if (kind === "text") setTexts(arr => arr.map(t => t.id === id ? { ...t, x: p.x, y: p.y } : t));
    if (kind === "sticker") setStickers(arr => arr.map(s => s.id === id ? { ...s, x: p.x, y: p.y } : s));
  }

  function endDrag(e: React.PointerEvent) {
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
    dragState.current = { id: null, kind: null };
  }

  /* ----------------------------- drawing overlay ----------------------------- */
  function startDraw(e: React.PointerEvent) {
    if (activeTool !== "draw" || !stageRef.current) return;
    setIsDrawing(true);
    const p = percentFromClient(stageRef.current, e.clientX, e.clientY);
    setStrokes(arr => [...arr, { color: drawColor, size: drawSize, points: [p] }]);
  }
  function moveDraw(e: React.PointerEvent) {
    if (!isDrawing || !stageRef.current) return;
    const p = percentFromClient(stageRef.current, e.clientX, e.clientY);
    setStrokes(arr => {
      const copy = arr.slice();
      copy[copy.length - 1].points.push(p);
      return copy;
    });
  }
  function endDraw() { setIsDrawing(false); }

  // keep preview canvas in sync
  useEffect(() => {
    const cvs = drawCanvasRef.current;
    const stage = stageRef.current;
    if (!cvs || !stage) return;
    const rect = stage.getBoundingClientRect();
    cvs.width = rect.width * devicePixelRatio;
    cvs.height = rect.height * devicePixelRatio;
    const ctx = cvs.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, cvs.width, cvs.height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const s of strokes) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = (s.size * cvs.width) / CANVAS_W;
      ctx.beginPath();
      s.points.forEach((pt, i) => {
        const x = pt.x * cvs.width;
        const y = pt.y * cvs.height;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  }, [strokes, images.length, texts.length, stickers.length, activeTool]);

  /* ----------------------------- export ----------------------------- */
  async function exportImageBlob(): Promise<Blob> {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;

    // Black background template
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // IMAGES (in order)
    for (const it of images) {
      const img = await loadImage(it.src);
      const drawW = it.baseW * it.scale;
      const drawH = it.baseH * it.scale;
      const x = it.x * CANVAS_W;
      const y = it.y * CANVAS_H;
      ctx.save();
      ctx.globalAlpha = it.opacity;
      ctx.translate(x, y);
      ctx.rotate((it.rotation * Math.PI) / 180);
      ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
      ctx.restore();
    }

    // DRAW strokes
    for (const s of strokes) {
      ctx.save();
      ctx.strokeStyle = s.color;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = s.size;
      ctx.beginPath();
      s.points.forEach((pt, i) => {
        const x = pt.x * CANVAS_W;
        const y = pt.y * CANVAS_H;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.restore();
    }

    // STICKERS
    for (const st of stickers) {
      const x = st.x * CANVAS_W;
      const y = st.y * CANVAS_H;
      const fontPx = 160 * st.scale;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((st.rotation * Math.PI) / 180);
      ctx.font = `${fontPx}px system-ui, Apple Color Emoji, Segoe UI Emoji`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(st.value, 0, 0);
      ctx.restore();
    }

    // TEXT
    for (const t of texts) {
      const x = t.x * CANVAS_W;
      const y = t.y * CANVAS_H;
      const fontPx = 64 * t.scale;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((t.rotation * Math.PI) / 180);
      const family =
        t.font === "serif" ? "Georgia, serif" :
        t.font === "mono" ? "ui-monospace, SFMono-Regular, Menlo, monospace" :
        "Inter, ui-sans-serif, system-ui";
      ctx.font = `800 ${fontPx}px ${family}`;
      ctx.fillStyle = t.color;
      ctx.textAlign = t.align;
      ctx.textBaseline = "middle";

      if (t.highlight) {
        const padX = 24 * t.scale;
        const padY = 14 * t.scale;
        const metrics = ctx.measureText(t.text);
        const textW = metrics.width;
        const textH = fontPx;
        const w = textW + padX * 2;
        const h = textH + padY * 2;
        const rx = Math.min(24 * t.scale, h / 2);
        roundRect(ctx, -w / 2, -h / 2, w, h, rx, "rgba(0,0,0,0.35)");
      }

      ctx.fillText(t.text, 0, 0);
      ctx.restore();
    }

    return await new Promise<Blob>((resolve) => {
      canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.95);
    });
  }

  function roundRect(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, w: number, h: number, r: number, fill: string
  ) {
    ctx.save();
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /* ----------------------------- submit ----------------------------- */
  async function onSubmit() {
    setBusy(true);
    try {
      const blob = await exportImageBlob();
      const file = new File([blob], "story.jpg", { type: "image/jpeg" });

      const form = new FormData();
      form.append("file", file, file.name);
      if (caption) form.append("caption", caption);

      // music metadata (server will ignore if not supported yet)
      if (musicFile) {
        form.append("music_name", musicFile.name);
        form.append("music_start", String(musicStart));
        form.append("music_duration", String(Math.min(15, Math.max(0, Math.floor(musicDur - musicStart)))));
      }

      await api("/stories", { method: "POST", body: form });
      nav("/story");
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /* ----------------------------- UI ----------------------------- */
  const hasAnything = images.length || texts.length || stickers.length || strokes.length;

  return (
    <div className="mx-auto max-w-6xl px-4 py-4 sm:py-6">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => nav(-1)} title="Close">
            <X className="w-5 h-5" />
          </Button>
          <div className="text-sm text-muted-foreground">Create Story</div>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={onSubmit} disabled={!hasAnything || busy}>
            {busy ? "Posting…" : "Share"}
          </Button>
        </div>
      </div>

      {/* Canvas + tools */}
      <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-4">
        {/* Stage */}
        <Card className="shadow-xl">
          <CardContent className="p-3">
            {/* stage */}
            <div className="mt-1 flex justify-center">
              <div
                ref={stageRef}
                className="relative w-full max-w-[420px] bg-black overflow-hidden rounded-xl"
                style={{ aspectRatio: "9 / 16", touchAction: "none" }}
                onPointerMove={(e) => { onDrag(e); moveDraw(e); }}
                onPointerUp={(e) => { endDrag(e); endDraw(); }}
                onPointerLeave={() => endDraw()}
              >
                {/* Black background fills container via bg-black */}

                {/* IMAGES */}
                {images.map((it) => (
                  <img
                    key={it.id}
                    src={it.src}
                    alt=""
                    onPointerDown={(e) => beginDrag(e, it.id, "image")}
                    className="absolute select-none"
                    style={{
                      left: `${it.x * 100}%`,
                      top: `${it.y * 100}%`,
                      transform: `translate(-50%,-50%) rotate(${it.rotation}deg) scale(${it.scale})`,
                      width: it.baseW + "px",
                      height: "auto",
                      opacity: it.opacity,
                      filter: "drop-shadow(0 4px 12px rgba(0,0,0,.35))",
                    }}
                  />
                ))}

                {/* DRAW overlay (canvas) */}
                <canvas ref={drawCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />

                {/* STICKERS */}
                {stickers.map((s) => (
                  <div
                    key={s.id}
                    role="button"
                    onPointerDown={(e) => beginDrag(e, s.id, "sticker")}
                    className="absolute select-none"
                    style={{
                      left: `${s.x * 100}%`,
                      top: `${s.y * 100}%`,
                      transform: `translate(-50%,-50%) rotate(${s.rotation}deg) scale(${s.scale})`,
                      fontSize: "160px",
                      filter: "drop-shadow(0 2px 6px rgba(0,0,0,.35))",
                    }}
                  >
                    {s.value}
                  </div>
                ))}

                {/* TEXT */}
                {texts.map((t) => (
                  <div
                    key={t.id}
                    role="button"
                    onPointerDown={(e) => beginDrag(e, t.id, "text")}
                    className="absolute px-3 py-2 rounded-full"
                    style={{
                      left: `${t.x * 100}%`,
                      top: `${t.y * 100}%`,
                      transform: `translate(-50%,-50%) rotate(${t.rotation}deg) scale(${t.scale})`,
                      color: t.color,
                      backgroundColor: t.highlight ? "rgba(0,0,0,0.35)" : "transparent",
                      fontFamily:
                        t.font === "serif"
                          ? "Georgia, serif"
                          : t.font === "mono"
                          ? "ui-monospace, SFMono-Regular, Menlo, monospace"
                          : "Inter, ui-sans-serif, system-ui",
                      fontWeight: 800,
                      fontSize: "64px",
                      textAlign: t.align as any,
                      textShadow: "0 1px 2px rgba(0,0,0,0.45)",
                    }}
                  >
                    {t.text}
                  </div>
                ))}

                {/* DRAW interactive/capture */}
                {activeTool === "draw" ? (
                  <div
                    className="absolute inset-0"
                    onPointerDown={(e) => startDraw(e)}
                    onPointerMove={(e) => moveDraw(e)}
                    onPointerUp={() => endDraw()}
                  />
                ) : null}
              </div>
            </div>

            {/* caption */}
            <div className="mt-4 space-y-2">
              <Label htmlFor="caption">Caption (optional)</Label>
              <Input
                id="caption"
                value={caption}
                onChange={(e) => setCaption(e.target.value.slice(0, 500))}
                placeholder="Say something…"
              />
              <div className="text-xs text-muted-foreground">{caption.length}/500</div>
            </div>
          </CardContent>
        </Card>

        {/* Right rail: tools & panels */}
        <div className="space-y-4">
          <Card>
            <CardContent className="p-3">
              {/* Tool buttons */}
              <div className="grid grid-cols-5 gap-2">
                <ToolButton
                  label="Image"
                  icon={<ImagePlus className="w-5 h-5" />}
                  active={activeTool === "image"}
                  onClick={() => setActiveTool("image")}
                />
                <ToolButton
                  label="Text"
                  icon={<Type className="w-5 h-5" />}
                  active={activeTool === "text"}
                  onClick={() => { setActiveTool("text"); addText(); }}
                />
                <ToolButton
                  label="Draw"
                  icon={<Pencil className="w-5 h-5" />}
                  active={activeTool === "draw"}
                  onClick={() => setActiveTool("draw")}
                />
                <ToolButton
                  label="Stickers"
                  icon={<Smile className="w-5 h-5" />}
                  active={activeTool === "stickers"}
                  onClick={() => setActiveTool("stickers")}
                />
                <ToolButton
                  label="Music"
                  icon={<Music2 className="w-5 h-5" />}
                  active={activeTool === "music"}
                  onClick={() => setActiveTool("music")}
                />
              </div>

              {/* Panels */}
              <div className="mt-3 space-y-4">
                {activeTool === "image" && (
                  <ImagePanel
                    images={images}
                    selectedId={selectedId}
                    onPickFile={async (f) => addImageFromFile(f)}
                    onChange={(id, patch) =>
                      setImages(arr => arr.map(i => (i.id === id ? { ...i, ...patch } : i)))
                    }
                    onDelete={(id) => setImages(arr => arr.filter(i => i.id !== id))}
                    onSelect={(id) => setSelectedId(id)}
                    onBringFront={(id) => setImages(arr => {
                      const idx = arr.findIndex(i => i.id === id);
                      if (idx < 0) return arr;
                      const item = arr[idx];
                      const rest = arr.slice(0, idx).concat(arr.slice(idx + 1));
                      return [...rest, item];
                    })}
                  />
                )}

                {activeTool === "text" && selectedId && texts.some(t => t.id === selectedId) && (
                  <TextPanel
                    item={texts.find(t => t.id === selectedId)!}
                    onChange={(p) => setTexts(arr => arr.map(t => t.id === selectedId ? { ...t, ...p } : t))}
                    onDelete={() => {
                      setTexts(arr => arr.filter(t => t.id !== selectedId));
                      setSelectedId(null);
                    }}
                  />
                )}

                {activeTool === "stickers" && (
                  <StickerPanel
                    onAdd={addSticker}
                    onClear={() => setStickers([])}
                  />
                )}

                {activeTool === "draw" && (
                  <DrawPanel
                    color={drawColor}
                    size={drawSize}
                    onColor={setDrawColor}
                    onSize={setDrawSize}
                    onUndo={() => setStrokes(arr => arr.slice(0, Math.max(0, arr.length - 1)))}
                    onClear={() => setStrokes([])}
                  />
                )}

                {activeTool === "music" && (
                  <MusicPanel
                    musicUrl={musicUrl}
                    musicStart={musicStart}
                    onPick={(f) => {
                      if (musicUrl) URL.revokeObjectURL(musicUrl);
                      const url = URL.createObjectURL(f);
                      setMusicFile(f);
                      setMusicUrl(url);
                      setTimeout(() => audioRef.current?.load(), 0);
                    }}
                    onStart={setMusicStart}
                  />
                )}
              </div>
            </CardContent>
          </Card>

          {/* Audio preview (kept outside so it persists) */}
          {musicUrl && (
            <Card>
              <CardContent className="p-3 space-y-2">
                <Label>Music preview</Label>
                <audio
                  ref={audioRef}
                  src={musicUrl}
                  controls
                  onLoadedMetadata={(e) => setMusicDur(e.currentTarget.duration || 0)}
                  onPlay={() => {
                    const el = audioRef.current;
                    if (!el) return;
                    // jump to selected start
                    el.currentTime = musicStart;
                  }}
                />
                <div className="text-xs text-muted-foreground">
                  Starts at {musicStart.toFixed(1)}s
                </div>
              </CardContent>
            </Card>
          )}

          {/* Reset */}
          <Card>
            <CardContent className="p-3 space-y-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setImages([]);
                  setTexts([]);
                  setStickers([]);
                  setStrokes([]);
                  setSelectedId(null);
                  setCaption("");
                }}
              >
                Reset Canvas
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ----------------------- Panels & small UI ----------------------- */

function ToolButton({
  label, icon, active, onClick, disabled,
}: {
  label: string; icon: React.ReactNode; active?: boolean; onClick?: () => void; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-center justify-center gap-1 rounded-lg border p-2 h-16 ${
        active ? "bg-primary/10 border-primary text-primary" : "bg-card hover:bg-muted"
      } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
      title={label}
    >
      {icon}
      <span className="text-[11px]">{label}</span>
    </button>
  );
}

function ColorRow({ value, onChange }: { value: string; onChange: (v: string) => void; }) {
  return (
    <div className="flex flex-wrap gap-2">
      {DEFAULT_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className="w-7 h-7 rounded-full border"
          style={{ backgroundColor: c }}
          title={c}
        />
      ))}
      <label className="w-7 h-7 rounded-full border grid place-items-center cursor-pointer">
        <ImagePlus className="w-4 h-4 opacity-60" />
        <input type="color" className="hidden" value={value} onChange={(e) => onChange(e.target.value)} />
      </label>
    </div>
  );
}

/* ---------- Image panel ---------- */
function ImagePanel({
  images, selectedId, onPickFile, onChange, onDelete, onSelect, onBringFront,
}: {
  images: ImageItem[];
  selectedId: string | null;
  onPickFile: (f: File) => void;
  onChange: (id: string, patch: Partial<ImageItem>) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string) => void;
  onBringFront: (id: string) => void;
}) {
  return (
    <div className="space-y-3">
      <Label>Add image</Label>
      <Input
        type="file"
        accept="image/*"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPickFile(f);
          // reset input so same file can be re-added if needed
          (e.target as HTMLInputElement).value = "";
        }}
      />
      {images.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">Layers</div>
          <div className="space-y-2">
            {images.map((i, idx) => {
              const sel = i.id === selectedId;
              return (
                <div key={i.id} className={`rounded-md border p-2 ${sel ? "border-primary" : ""}`}>
                  <div className="flex items-center justify-between">
                    <button
                      className="text-left text-sm font-medium truncate mr-2"
                      onClick={() => onSelect(i.id)}
                      title={`Image ${idx + 1}`}
                    >
                      Image {idx + 1}
                    </button>
                    <div className="flex items-center gap-2">
                      <Button size="icon" variant="ghost" title="Bring to front" onClick={() => onBringFront(i.id)}>
                        <Layers className="w-4 h-4" />
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => onDelete(i.id)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                  {sel && (
                    <div className="mt-2 space-y-2">
                      <div className="space-y-1">
                        <div className="text-xs">Scale</div>
                        <input
                          type="range" min={0.2} max={3} step={0.01}
                          value={i.scale}
                          onChange={(e) => onChange(i.id, { scale: parseFloat(e.target.value) })}
                          className="w-full"
                        />
                      </div>
                      <div className="space-y-1">
                        <div className="text-xs">Rotate</div>
                        <input
                          type="range" min={-180} max={180} step={1}
                          value={i.rotation}
                          onChange={(e) => onChange(i.id, { rotation: parseFloat(e.target.value) })}
                          className="w-full"
                        />
                      </div>
                      <div className="space-y-1">
                        <div className="text-xs">Opacity</div>
                        <input
                          type="range" min={20} max={100} step={1}
                          value={Math.round(i.opacity * 100)}
                          onChange={(e) => onChange(i.id, { opacity: parseInt(e.target.value) / 100 })}
                          className="w-full"
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Tip: click an image on the canvas to move it. Use sliders to resize & rotate.</p>
    </div>
  );
}

/* ---------- Text panel ---------- */
function TextPanel({
  item, onChange, onDelete,
}: { item: TextItem; onChange: (patch: Partial<TextItem>) => void; onDelete: () => void; }) {
  return (
    <div className="space-y-3">
      <Label>Text</Label>
      <Input value={item.text} onChange={(e) => onChange({ text: e.target.value })} placeholder="Your text" />
      <div className="space-y-1">
        <Label>Color</Label>
        <ColorRow value={item.color} onChange={(c) => onChange({ color: c })} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Button variant={item.font === "sans" ? "default" : "secondary"} onClick={() => onChange({ font: "sans" })}>Sans</Button>
        <Button variant={item.font === "serif" ? "default" : "secondary"} onClick={() => onChange({ font: "serif" })}>Serif</Button>
        <Button variant={item.font === "mono" ? "default" : "secondary"} onClick={() => onChange({ font: "mono" })}>Mono</Button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Button variant={item.align === "left" ? "default" : "secondary"} onClick={() => onChange({ align: "left" })}>Left</Button>
        <Button variant={item.align === "center" ? "default" : "secondary"} onClick={() => onChange({ align: "center" })}>Center</Button>
        <Button variant={item.align === "right" ? "default" : "secondary"} onClick={() => onChange({ align: "right" })}>Right</Button>
      </div>
      <div className="space-y-1">
        <Label>Size</Label>
        <input type="range" min={0.5} max={3} step={0.01} value={item.scale} onChange={(e) => onChange({ scale: parseFloat(e.target.value) })} className="w-full" />
      </div>
      <div className="space-y-1">
        <Label>Rotate</Label>
        <input type="range" min={-180} max={180} step={1} value={item.rotation} onChange={(e) => onChange({ rotation: parseFloat(e.target.value) })} className="w-full" />
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <input id="highlight" type="checkbox" checked={item.highlight} onChange={(e) => onChange({ highlight: e.target.checked })} />
          <Label htmlFor="highlight">Highlight background</Label>
        </div>
        <Button variant="destructive" onClick={onDelete}>Delete</Button>
      </div>
      <p className="text-xs text-muted-foreground">Drag the text on the canvas to position it.</p>
    </div>
  );
}

/* ---------- Sticker panel ---------- */
function StickerPanel({ onAdd, onClear }: { onAdd: (emoji: string) => void; onClear: () => void; }) {
  const emojis = ["😍", "🔥", "🎉", "👍", "🙌", "🤩", "😎", "✨", "💖", "🌟", "🥳", "🍀", "💯", "🫶"];
  return (
    <div className="space-y-2">
      <Label>Stickers</Label>
      <div className="flex flex-wrap gap-2">
        {emojis.map((e) => (
          <button key={e} onClick={() => onAdd(e)} className="text-2xl p-2 rounded-lg hover:bg-muted" title={`Add ${e}`}>
            {e}
          </button>
        ))}
      </div>
      <div className="pt-2">
        <Button variant="secondary" onClick={onClear}>Clear Stickers</Button>
      </div>
    </div>
  );
}

/* ---------- Draw panel ---------- */
function DrawPanel({
  color, size, onColor, onSize, onUndo, onClear,
}: {
  color: string; size: number; onColor: (c: string) => void; onSize: (n: number) => void; onUndo: () => void; onClear: () => void;
}) {
  return (
    <div className="space-y-3">
      <Label>Brush</Label>
      <div className="space-y-1">
        <Label>Color</Label>
        <ColorRow value={color} onChange={onColor} />
      </div>
      <div className="space-y-1">
        <Label>Size</Label>
        <input type="range" min={4} max={48} step={1} value={size} onChange={(e) => onSize(parseInt(e.target.value))} className="w-full" />
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onUndo}>Undo</Button>
        <Button variant="secondary" onClick={onClear}>Clear</Button>
      </div>
      <p className="text-xs text-muted-foreground">Draw directly on the story canvas.</p>
    </div>
  );
}

/* ---------- Music panel ---------- */
function MusicPanel({
  musicUrl, musicStart, onPick, onStart,
}: {
  musicUrl: string | null;
  musicStart: number;
  onPick: (f: File) => void;
  onStart: (s: number) => void;
}) {
  return (
    <div className="space-y-3">
      <Label>Add music (preview)</Label>
      <Input
        type="file"
        accept="audio/*"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          (e.target as HTMLInputElement).value = "";
        }}
      />
      <div className="space-y-1">
        <div className="text-xs">Start at (seconds)</div>
        <input
          type="range"
          min={0}
          max={60}
          step={0.1}
          value={musicStart}
          onChange={(e) => onStart(parseFloat(e.target.value))}
          className="w-full"
        />
      </div>
      {musicUrl ? (
        <div className="text-xs text-muted-foreground">You can preview the track at the bottom.</div>
      ) : (
        <p className="text-xs text-muted-foreground">Pick an audio file to attach. Audio is preview-only for now.</p>
      )}
    </div>
  );
}
