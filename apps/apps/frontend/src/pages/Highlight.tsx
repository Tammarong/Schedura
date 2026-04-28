import { useEffect, useMemo, useState } from "react";
import { api, apiUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

type HighlightItem = { storyId: number; position: number; addedAt: string };
type Highlight = {
  id: number;
  userId: number;
  title: string;
  coverStoryId: number | null;
  createdAt: string;
  updatedAt: string;
  items?: HighlightItem[];
};
type HLList = { items: Highlight[] };

type Story = {
  id: number;
  userId: number;
  caption: string | null;
  media: { url: string | null; mime?: string | null; seconds?: number | null };
  createdAt: string;
  hasSeen?: boolean;
};

export default function HighlightPage() {
  const [me, setMe] = useState<{ username: string } | null>(null);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [newTitle, setNewTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [myActive, setMyActive] = useState<Story[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const meRes = await api<{ username: string }>("/users/current_user");
        setMe(meRes || null);

        const hl = await api<HLList>("/highlights/me");
        setHighlights(hl?.items ?? []);

        if (meRes?.username) {
          const acts = await api<{ items: Story[] }>(`/stories/${encodeURIComponent(meRes.username)}/active`);
          setMyActive(acts?.items ?? []);
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function createHighlight() {
    if (!newTitle.trim()) return;
    setBusy(true);
    try {
      const res = await api<{ highlight: Highlight }>("/highlights", {
        method: "POST",
        body: { title: newTitle.trim() },
      });
      if (res?.highlight) setHighlights((prev) => [res.highlight, ...prev]);
      setNewTitle("");
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function renameHighlight(id: number, title: string) {
    try {
      const res = await api<{ highlight: Highlight }>(`/highlights/${id}`, {
        method: "PATCH",
        body: { title },
      });
      if (res?.highlight) {
        setHighlights((prev) => prev.map(h => h.id === id ? res.highlight : h));
      }
    } catch (e) { alert(String(e)); }
  }
  async function setCover(id: number, storyId: number) {
    try {
      const res = await api<{ highlight: Highlight }>(`/highlights/${id}`, {
        method: "PATCH",
        body: { coverStoryId: storyId },
      });
      if (res?.highlight) {
        setHighlights((prev) => prev.map(h => h.id === id ? res.highlight : h));
      }
    } catch (e) { alert(String(e)); }
  }
  async function addItem(id: number, storyId: number) {
    try {
      await api(`/highlights/${id}/add`, { method: "POST", body: { storyId } });
      // re-pull list
      const hl = await api<HLList>("/highlights/me");
      setHighlights(hl?.items ?? []);
    } catch (e) { alert(String(e)); }
  }
  async function removeItem(id: number, storyId: number) {
    try {
      await api(`/highlights/${id}/remove`, { method: "DELETE", body: { storyId } });
      const hl = await api<HLList>("/highlights/me");
      setHighlights(hl?.items ?? []);
    } catch (e) { alert(String(e)); }
  }
  async function delHighlight(id: number) {
    if (!confirm("Delete this highlight?")) return;
    try {
      await api(`/highlights/${id}`, { method: "DELETE" });
      setHighlights((prev) => prev.filter(h => h.id !== id));
    } catch (e) { alert(String(e)); }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Highlights</h1>
      </div>

      {loading && <p className="text-sm text-muted-foreground mt-2">Loading…</p>}
      {err && <p className="text-sm text-red-500 mt-2">{err}</p>}

      {/* Create */}
      <Card className="mt-4">
        <CardContent className="p-4 space-y-3">
          <Label htmlFor="newTitle">New highlight title</Label>
          <div className="flex gap-2">
            <Input
              id="newTitle"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value.slice(0, 100))}
              placeholder="e.g., Summer ‘24"
            />
            <Button onClick={createHighlight} disabled={!newTitle.trim() || busy}>
              Create
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Your active stories for adding */}
      <Card className="mt-4">
        <CardContent className="p-4">
          <div className="font-medium mb-2">Your active stories</div>
          <div className="flex gap-2 overflow-x-auto">
            {myActive.map((s) => (
              <div key={s.id} className="w-24">
                <div className="w-24 h-36 rounded border overflow-hidden bg-muted">
                  {s.media?.url ? (
                    <img src={apiUrl(s.media.url)} alt="" className="w-full h-full object-cover" />
                  ) : null}
                </div>
                <div className="text-[11px] text-muted-foreground truncate mt-1">{s.caption || "—"}</div>
              </div>
            ))}
            {!myActive.length && (
              <div className="text-sm text-muted-foreground">No active stories right now.</div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Highlights list */}
      <div className="mt-6 grid md:grid-cols-2 gap-4">
        {highlights.map((h) => (
          <Card key={h.id}>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <input
                  className="text-lg font-semibold bg-transparent outline-none border-b border-transparent focus:border-border"
                  defaultValue={h.title}
                  onBlur={(e) => {
                    const v = e.currentTarget.value.trim();
                    if (v && v !== h.title) renameHighlight(h.id, v);
                    else e.currentTarget.value = h.title;
                  }}
                />
                <Button variant="destructive" onClick={() => delHighlight(h.id)}>
                  Delete
                </Button>
              </div>

              <Separator />

              {/* cover preview */}
              <div>
                <div className="text-sm font-medium mb-1">Cover</div>
                <div className="flex gap-2 overflow-x-auto">
                  {myActive.map((s) => (
                    <button
                      key={s.id}
                      className={`w-20 h-28 rounded border overflow-hidden ${h.coverStoryId === s.id ? "ring-2 ring-primary" : ""}`}
                      onClick={() => setCover(h.id, s.id)}
                      title="Set as cover"
                    >
                      {s.media?.url ? (
                        <img src={apiUrl(s.media.url)} alt="" className="w-full h-full object-cover" />
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>

              <Separator />

              {/* items */}
              <div>
                <div className="text-sm font-medium mb-1">Items</div>
                <div className="flex flex-wrap gap-2">
                  {h.items?.length ? (
                    h.items.map((it) => {
                      const s = myActive.find(x => x.id === it.storyId);
                      return (
                        <div key={it.storyId} className="w-20">
                          <div className="w-20 h-28 rounded border overflow-hidden bg-muted">
                            {s?.media?.url ? (
                              <img src={apiUrl(s.media.url)} alt="" className="w-full h-full object-cover" />
                            ) : null}
                          </div>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="w-full mt-1"
                            onClick={() => removeItem(h.id, it.storyId)}
                          >
                            Remove
                          </Button>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-sm text-muted-foreground">Empty. Add from your active stories below.</div>
                  )}
                </div>
              </div>

              <div>
                <div className="text-sm font-medium mb-1">Add from active</div>
                <div className="flex gap-2 overflow-x-auto">
                  {myActive.map((s) => (
                    <button
                      key={s.id}
                      className="w-20 h-28 rounded border overflow-hidden"
                      onClick={() => addItem(h.id, s.id)}
                      title="Add to highlight"
                    >
                      {s.media?.url ? (
                        <img src={apiUrl(s.media.url)} alt="" className="w-full h-full object-cover" />
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {!highlights.length && !loading && (
        <p className="text-sm text-muted-foreground mt-4">You don’t have any highlights yet.</p>
      )}
    </div>
  );
}
