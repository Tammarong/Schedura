// src/components/OnboardingTour.tsx
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";

type Step = { id: string; title: string; body: string }; // id can be "#nav-pulse" or "nav-pulse"

type Props = {
  username?: string | null;
  enabled?: boolean;
  steps: Step[];
  storageKeyPrefix?: string;
  onDone?: () => void;
};

function useQueryFlag(key: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get(key) === "1";
  } catch {
    return false;
  }
}

export default function OnboardingTour({
  username,
  enabled = true,
  steps,
  storageKeyPrefix = "tourSeen",
  onDone,
}: Props) {
  const force = useQueryFlag("tour");
  const key = useMemo(() => `${storageKeyPrefix}:${(username || "anon").trim()}`, [username, storageKeyPrefix]);

  const [idx, setIdx] = useState(0);
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  // Decide to open, mark as seen immediately (unless forced)
  useEffect(() => {
    if (!enabled || steps.length === 0) return;

    let seen = false;
    try { seen = localStorage.getItem(key) === "1"; } catch {
        // ignore
    }
    if (!seen || force) {
      setOpen(true);
      if (!force) {
        try { localStorage.setItem(key, "1"); } catch {
            // ignore
        }
      }
    } else {
      setOpen(false);
    }
    setIdx(0);
  }, [enabled, key, steps.length, force]);

  // Helper to resolve a DOM element from step.id (supports "#id" / ".class" / plain id)
  const resolveElement = (rawId: string): HTMLElement | null => {
    if (typeof document === "undefined") return null;
    if (!rawId) return null;

    const sel = rawId.startsWith("#") || rawId.startsWith(".") ? rawId : `#${rawId}`;
    const el = document.querySelector(sel);
    return (el as HTMLElement) || null;
  };

  useEffect(() => {
    if (!open) return;

    let rafId = 0;
    let observer: MutationObserver | null = null;
    let attempts = 0;

    const updateRect = () => {
      attempts += 1;
      const el = resolveElement(steps[idx]?.id);
      if (el) {
        setAnchorRect(el.getBoundingClientRect());
        return;
      }
      if (attempts < 12) {
        rafId = requestAnimationFrame(updateRect);
      } else {
        setAnchorRect(null); // fallback to centered bubble
      }
    };

    updateRect();

    // Observe DOM changes (e.g., navbar mounts late or route transitions)
    if (typeof MutationObserver !== "undefined") {
      observer = new MutationObserver(() => {
        const el = resolveElement(steps[idx]?.id);
        if (el) setAnchorRect(el.getBoundingClientRect());
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    const onResize = () => {
      const el = resolveElement(steps[idx]?.id);
      setAnchorRect(el ? el.getBoundingClientRect() : null);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
      observer?.disconnect();
    };
  }, [open, idx, steps]);

  const endTour = () => {
    setOpen(false);
    onDone?.();
  };

  if (!open) return null;

  const step = steps[idx];
  const rect = anchorRect;
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = 320, h = 148;
  const pad = 12;

  const placeAbove = rect ? rect.bottom + h + pad > vh : false;
  const left = rect ? Math.max(pad, Math.min(rect.left, vw - w - pad)) : Math.max(pad, Math.min(24, vw - w - pad));
  const top = rect
    ? placeAbove ? Math.max(pad, rect.top - h - pad) : Math.min(rect.bottom + pad, vh - h - pad)
    : Math.max(pad, Math.min(24, vh - h - pad));

  return createPortal(
    <>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-[2px] z-[1000]" onClick={endTour} />
      {rect && (
        <div
          className="fixed z-[1001] rounded-xl ring-4 ring-primary/60 pointer-events-none"
          style={{ left: rect.left - 8, top: rect.top - 8, width: rect.width + 16, height: rect.height + 16 }}
        />
      )}
      <div className="fixed z-[1002] max-w-[320px] rounded-xl border bg-card shadow-xl p-4" style={{ left, top }}>
        <div className="text-sm text-muted-foreground mb-1">Step {idx + 1} / {steps.length}</div>
        <h3 className="font-semibold mb-1">{step.title}</h3>
        <p className="text-sm mb-3">{step.body}</p>
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={endTour}>Close</Button>
          {idx > 0 && <Button variant="secondary" onClick={() => setIdx((i) => i - 1)}>Back</Button>}
          {idx < steps.length - 1
            ? <Button onClick={() => setIdx((i) => i + 1)}>Next</Button>
            : <Button onClick={endTour}>Done</Button>}
        </div>
      </div>
    </>,
    document.body
  );
}
