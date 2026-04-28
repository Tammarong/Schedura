// src/pages/Document.tsx
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Bold, Italic, Underline, Strikethrough, Highlighter, Type, CaseSensitive,
  AlignLeft, AlignCenter, AlignRight, AlignJustify, List, ListOrdered, ListTodo,
  Undo, Redo, Link as LinkIcon, Image as ImageIcon, Quote, Code, Eraser, Download,
  FileText, Ruler, Table as TableIcon, Search, Save, ChevronDown,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { getToken, API_BASE } from "@/lib/api";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/* =========================
   Types (no `any`)
========================= */
type PageSize = "A4" | "Letter";
type MarginPreset = "narrow" | "normal" | "wide";
type ExportStatus = "idle" | "working" | "done" | "error";
type SaveTarget = "local" | "server";

type DocMeta = {
  id?: string;
  title: string;
  updatedAt: string;
  pageSize: PageSize;
  margin: MarginPreset;
};

/* =========================
   Helpers
========================= */
function clsx(...arr: Array<string | false | null | undefined>): string {
  return arr.filter(Boolean).join(" ");
}
function nowIso(): string { return new Date().toISOString(); }
function pageCSS(size: PageSize): { w: number; h: number } {
  return size === "A4" ? { w: 794, h: 1123 } : { w: 816, h: 1056 };
}
function marginPadding(preset: MarginPreset): string {
  switch (preset) {
    case "narrow": return "p-6 md:p-8";
    case "wide": return "p-10 md:p-14";
    case "normal":
    default: return "p-8 md:p-10";
  }
}

const LS_KEY_DOC = "schedura-doc-current-v1";
const LS_KEY_META = "schedura-doc-meta-v1";

/* =========================
   window.find typing
========================= */
declare global {
  interface Window {
    find?(
      searchString: string,
      caseSensitive?: boolean,
      backwards?: boolean,
      wrapAround?: boolean,
      wholeWord?: boolean,
      searchInFrames?: boolean,
      showDialog?: boolean
    ): boolean;
  }
}

/* =========================
   Server save (optional)
========================= */
async function authFetch(input: string, init?: RequestInit): Promise<Response> {
  const token = getToken?.();
  const headers = new Headers(init?.headers || {});
  if (token) headers.set("Authorization", token.startsWith("Bearer ") ? token : `Bearer ${token}`);
  if (init?.body && !headers.has("Content-Type") && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const url = input.startsWith("http") ? input : `${API_BASE}${input}`;
  return fetch(url, { ...init, headers });
}

// Safely detect getModifierState on the native event
function hasGetModifierState(ev: unknown): ev is { getModifierState: (key: string) => boolean } {
  return typeof ev === "object" && ev !== null && typeof (ev as Record<string, unknown>).getModifierState === "function";
}

/* =========================
   Selection utils (for inserts)
========================= */
function rangeWithin(root: HTMLElement, range: Range): boolean {
  const c = range.commonAncestorContainer;
  return root === c || root.contains(c);
}
function placeCaretAtEnd(el: HTMLElement) {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

/* =========================
   Column resize helpers
========================= */
const MIN_COL_W = 40;         // px
const EDGE_SLOP = 6;          // px distance from right edge to show col-resize cursor

function firstRowCells(table: HTMLTableElement): HTMLTableCellElement[] {
  const firstRow = table.tHead?.rows?.[0] || table.tBodies[0]?.rows?.[0];
  if (!firstRow) return [];
  return Array.from(firstRow.cells) as HTMLTableCellElement[];
}

function ensureColgroup(table: HTMLTableElement) {
  const cells = firstRowCells(table);
  if (cells.length === 0) return;

  let colgroup = table.querySelector("colgroup");
  if (!colgroup) {
    colgroup = document.createElement("colgroup");
    const tableWidth = table.getBoundingClientRect().width || table.clientWidth || (cells.length * 120);
    const evenWidth = Math.max(MIN_COL_W, Math.floor(tableWidth / cells.length));
    for (let i = 0; i < cells.length; i++) {
      const col = document.createElement("col");
      col.style.width = `${evenWidth}px`;
      colgroup.appendChild(col);
    }
    table.insertBefore(colgroup, table.firstChild);
  } else {
    // Make sure cols match cell count
    const need = cells.length - colgroup.children.length;
    for (let i = 0; i < need; i++) {
      const col = document.createElement("col");
      col.style.width = `${Math.max(MIN_COL_W, Math.floor(table.clientWidth / cells.length))}px`;
      colgroup.appendChild(col);
    }
  }
  table.setAttribute("data-resizable", "true");
}

function isOnRightEdge(e: MouseEvent, cell: HTMLTableCellElement): boolean {
  const rect = cell.getBoundingClientRect();
  return e.clientX >= rect.right - EDGE_SLOP && e.clientX <= rect.right + EDGE_SLOP;
}

function columnIndexFromCell(cell: HTMLTableCellElement): number {
  // Assumes no colspans (matches our inserted tables)
  return cell.cellIndex;
}

/* =========================
   Document Page
========================= */
export default function DocumentPage() {
  const editorRef = useRef<HTMLDivElement | null>(null);

  // selection persistence for inserts
  const savedRangeRef = useRef<Range | null>(null);

  // column resize refs
  const resizingRef = useRef<{
    table: HTMLTableElement;
    startX: number;
    colIndex: number;
    startWidths: number[];
  } | null>(null);

  const hoverRef = useRef<{ table: HTMLTableElement; colIndex: number } | null>(null);

  const [meta, setMeta] = useState<DocMeta>(() => {
    const raw = localStorage.getItem(LS_KEY_META);
    if (raw) { try { return JSON.parse(raw) as DocMeta; } catch { /* ignore */ } }
    return { title: "Untitled Document", updatedAt: nowIso(), pageSize: "A4", margin: "normal" };
  });

  const [exportStatus, setExportStatus] = useState<ExportStatus>("idle");
  const [showFind, setShowFind] = useState<boolean>(false);
  const [findQuery, setFindQuery] = useState<string>("");
  const [replaceWith, setReplaceWith] = useState<string>("");
  const [showLinkDialog, setShowLinkDialog] = useState<boolean>(false);
  const [linkUrl, setLinkUrl] = useState<string>("https://");
  const [showImageDialog, setShowImageDialog] = useState<boolean>(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [showTableDialog, setShowTableDialog] = useState<boolean>(false);
  const [tableRows, setTableRows] = useState<number>(3);
  const [tableCols, setTableCols] = useState<number>(3);

  const [saveTarget, setSaveTarget] = useState<SaveTarget>("local");
  const [saving, setSaving] = useState<boolean>(false);
  const [wordCount, setWordCount] = useState<number>(0);

  /* --- load content --- */
  useEffect(() => {
    const raw = localStorage.getItem(LS_KEY_DOC);
    if (editorRef.current) {
      editorRef.current.innerHTML = raw || starterDocHTML();
      const text = editorRef.current.innerText || "";
      const wc = text.trim().split(/\s+/).filter(Boolean).length;
      setWordCount(wc);
      placeCaretAtEnd(editorRef.current);
      // Prepare any existing tables for resizing
      for (const t of editorRef.current.querySelectorAll("table")) {
        ensureColgroup(t as HTMLTableElement);
      }
    }
  }, []);

  /* --- track selection inside editor --- */
  useEffect(() => {
    const handleSelection = () => {
      const root = editorRef.current;
      if (!root) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const r = sel.getRangeAt(0);
      if (rangeWithin(root, r)) savedRangeRef.current = r.cloneRange();
    };
    document.addEventListener("selectionchange", handleSelection);
    return () => document.removeEventListener("selectionchange", handleSelection);
  }, []);

  const restoreSelectionIntoEditor = () => {
    const root = editorRef.current;
    if (!root) return;
    const sel = window.getSelection();
    if (!sel) return;
    if (savedRangeRef.current && rangeWithin(root, savedRangeRef.current)) {
      sel.removeAllRanges();
      sel.addRange(savedRangeRef.current);
    } else {
      placeCaretAtEnd(root);
    }
    root.focus();
  };

  /* --- autosave (local) --- */
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!editorRef.current) return;
      const html = editorRef.current.innerHTML;
      localStorage.setItem(LS_KEY_DOC, html);
      localStorage.setItem(LS_KEY_META, JSON.stringify({ ...meta, updatedAt: nowIso() }));
      setMeta((m) => ({ ...m, updatedAt: nowIso() }));

      const text = editorRef.current.innerText || "";
      const wc = text.trim().split(/\s+/).filter(Boolean).length;
      setWordCount(wc);
    }, 1500);
    return () => window.clearInterval(id);
  }, [meta]);

  /* --- execCommand wrapper --- */
  const exec = (cmd: string, value?: string) => {
    restoreSelectionIntoEditor();
    document.execCommand(cmd, false, value);
    editorRef.current?.focus();
  };

  /* --- toolbar actions --- */
  const setBlock = (tag: "P" | "H1" | "H2" | "H3" | "H4") => {
    const map: Record<typeof tag, string> = { P: "p", H1: "h1", H2: "h2", H3: "h3", H4: "h4" };
    exec("formatBlock", map[tag]);
  };

  const applyTextColor = (hex: string) => exec("foreColor", hex);
  const applyHighlight = (hex: string) => exec("hiliteColor", hex);

  const insertLink = () => {
    if (!linkUrl || !/^https?:\/\//i.test(linkUrl)) return;
    exec("createLink", linkUrl);
    setShowLinkDialog(false);
    setLinkUrl("https://");
  };

  const insertImage = () => {
    if (!imageFile) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result || "");
      exec("insertImage", src);
      setShowImageDialog(false);
      setImageFile(null);
    };
    reader.readAsDataURL(imageFile);
  };

  const insertQuote = () => exec("formatBlock", "blockquote");

  const getSelectionHtml = (): string => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return "";
    const container = document.createElement("div");
    for (let i = 0; i < selection.rangeCount; i += 1) {
      const range = selection.getRangeAt(i).cloneContents();
      container.appendChild(range);
    }
    return container.innerHTML || "";
  };

  const insertCodeBlock = () => {
    restoreSelectionIntoEditor();
    document.execCommand(
      "insertHTML",
      false,
      `<pre class="bg-muted rounded p-3 overflow-auto"><code>${getSelectionHtml()}</code></pre>`
    );
    editorRef.current?.focus();
  };

  const insertChecklist = () => {
    restoreSelectionIntoEditor();
    document.execCommand(
      "insertHTML",
      false,
      `<ul class="list-none pl-0 space-y-1">
         <li class="flex items-start gap-2"><input type="checkbox" class="mt-1" /> <span>Task item</span></li>
         <li class="flex items-start gap-2"><input type="checkbox" class="mt-1" /> <span>Task item</span></li>
       </ul>`
    );
    editorRef.current?.focus();
  };

  /* --- INSERT TABLE (with colgroup for resizable columns) --- */
  const insertTable = () => {
    const r = Math.min(Math.max(1, tableRows), 20);
    const c = Math.min(Math.max(1, tableCols), 12);

    // initial equal widths
    const initCols = Array.from({ length: c }).map(() => `<col style="width:${Math.max(100, Math.floor(600 / c))}px" />`).join("");

    const cells = Array.from({ length: c })
      .map(() => `<td class="align-top" style="border:1px solid #dadce0; padding:8px; min-width:${MIN_COL_W}px;"> </td>`)
      .join("");

    const rows = Array.from({ length: r })
      .map(() => `<tr>${cells}</tr>`)
      .join("");

    const tableHtml = `
      <table class="w-full my-3" style="border-collapse:collapse; border:1px solid #dadce0;">
        <colgroup>${initCols}</colgroup>
        <tbody>${rows}</tbody>
      </table>`;

    restoreSelectionIntoEditor();
    document.execCommand("insertHTML", false, tableHtml);
    editorRef.current?.focus();

    // ensure newly added table is resizable
    const root = editorRef.current!;
    const tables = root.querySelectorAll("table");
    const last = tables[tables.length - 1] as HTMLTableElement | undefined;
    if (last) ensureColgroup(last);

    setShowTableDialog(false);
  };

  const clearFormatting = () => exec("removeFormat");

  /* --- find & replace --- */
  const doFindNext = () => {
    const root = editorRef.current;
    if (!root || !findQuery.trim()) return;

    if (typeof window.find === "function") {
      const ok = window.find(findQuery, false, false, true, false, false, false) || false;
      if (!ok) {
        root.focus();
        void window.find(findQuery, false, false, true, false, false, false);
      }
      return;
    }

    const selection = window.getSelection();
    const currentOffset = (() => {
      if (!selection || selection.rangeCount === 0) return 0;
      const r = selection.getRangeAt(0);
      const tmp = document.createRange();
      tmp.setStart(root, 0);
      tmp.setEnd(r.startContainer, r.startOffset);
      return tmp.toString().length;
    })();

    const target = findQuery;
    const docText = root.innerText;
    if (!docText) return;

    let hitIndex = docText.indexOf(target, Math.max(0, currentOffset + 1));
    if (hitIndex === -1) hitIndex = docText.indexOf(target, 0);
    if (hitIndex === -1) return;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let acc = 0;
    let startNode: Text | null = null;
    let startOffset = 0;
    let endNode: Text | null = null;
    let endOffset = 0;

    while (true) {
      const node = walker.nextNode() as Text | null;
      if (!node) break;
      const len = node.nodeValue ? node.nodeValue.length : 0;

      if (!startNode && acc + len >= hitIndex) {
        startNode = node;
        startOffset = hitIndex - acc;
      }

      if (startNode && acc + len >= hitIndex + target.length) {
        endNode = node;
        endOffset = hitIndex + target.length - acc;
        break;
      }

      acc += len;
    }

    if (startNode && endNode) {
      const range = document.createRange();
      range.setStart(startNode, Math.max(0, Math.min(startOffset, startNode.length)));
      range.setEnd(endNode, Math.max(0, Math.min(endOffset, endNode.length)));
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      root.focus();
    }
  };

  const doReplace = () => {
    if (!findQuery) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const selectedText = sel.toString();
    if (selectedText === findQuery) {
      document.execCommand("insertText", false, replaceWith);
      doFindNext();
    } else {
      doFindNext();
    }
  };

  const doReplaceAll = () => {
    if (!editorRef.current || !findQuery) return;
    const html = editorRef.current.innerHTML;
    const safeQuery = findQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(safeQuery, "g");
    editorRef.current.innerHTML = html.replace(re, replaceWith);
  };

  /* --- export to PDF --- */
  const exportPDF = async () => {
    if (!editorRef.current) return;
    setExportStatus("working");
    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
      const wrapper = document.getElementById("doc-pages");
      if (!wrapper) throw new Error("Missing doc container");

      const pdf = new jsPDF({ unit: "pt", compress: true });
      const size = pageCSS(meta.pageSize);
      const pxToPt = (px: number) => px * 0.75;

      const pages = Array.from(wrapper.querySelectorAll<HTMLDivElement>("[data-doc-page='true']"));
      if (pages.length === 0) throw new Error("No pages found");

      let isFirst = true;
      for (const page of pages) {
        const canvas = await html2canvas(page, { backgroundColor: "#ffffff", scale: 2, useCORS: true });
        const imgData = canvas.toDataURL("image/png");
        const pageWpt = pxToPt(size.w);
        const pageHpt = pxToPt(size.h);
        if (!isFirst) pdf.addPage([pageWpt, pageHpt], "portrait");
        pdf.addImage(imgData, "PNG", 0, 0, pageWpt, pageHpt);
        isFirst = false;
      }

      pdf.save(`${meta.title || "document"}.pdf`);
      setExportStatus("done");
      setTimeout(() => setExportStatus("idle"), 1400);
    } catch (e) {
      console.error(e);
      setExportStatus("error");
      setTimeout(() => setExportStatus("idle"), 1800);
    }
  };

  /* --- server save (optional) --- */
  const saveNow = async () => {
    if (!editorRef.current) return;
    setSaving(true);
    try {
      if (saveTarget === "local") {
        localStorage.setItem(LS_KEY_DOC, editorRef.current.innerHTML);
        localStorage.setItem(LS_KEY_META, JSON.stringify({ ...meta, updatedAt: nowIso() }));
      } else {
        const payload = {
          title: meta.title,
          html: editorRef.current.innerHTML,
          pageSize: meta.pageSize,
          margin: meta.margin,
          updatedAt: nowIso(),
        };
        const res = await authFetch(`/docs`, { method: meta.id ? "PATCH" : "POST", body: JSON.stringify(payload) });
        if (!res.ok) throw new Error(`Save failed: ${res.status}`);
        const saved: { id: string } = await res.json();
        setMeta((m) => ({ ...m, id: saved.id, updatedAt: nowIso() }));
      }
    } catch (e) {
      console.error(e);
      alert("Failed to save document.");
    } finally {
      setSaving(false);
    }
  };

  /* --- image: drag & drop + paste (for convenience) --- */
  useEffect(() => {
    const root = editorRef.current;
    if (!root) return;

    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer) return;
      const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
      if (!file) return;
      e.preventDefault();
      const reader = new FileReader();
      reader.onload = () => {
        const src = String(reader.result || "");
        restoreSelectionIntoEditor();
        document.execCommand("insertImage", false, src);
      };
      reader.readAsDataURL(file);
    };

    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of items) {
        if (it.kind === "file") {
          const file = it.getAsFile();
          if (file && file.type.startsWith("image/")) {
            e.preventDefault();
            const reader = new FileReader();
            reader.onload = () => {
              const src = String(reader.result || "");
              restoreSelectionIntoEditor();
              document.execCommand("insertImage", false, src);
            };
            reader.readAsDataURL(file);
            break;
          }
        }
      }
    };

    root.addEventListener("drop", onDrop);
    root.addEventListener("paste", onPaste);
    return () => {
      root.removeEventListener("drop", onDrop);
      root.removeEventListener("paste", onPaste);
    };
  }, []);

  /* --- TABLE COLUMN RESIZE: delegated handlers on the editor --- */
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    // ensure any tables (pasted, loaded) are prepared
    const prepareAll = () => {
      for (const t of editor.querySelectorAll<HTMLTableElement>("table")) ensureColgroup(t);
    };
    prepareAll();

    const onMouseMove = (e: MouseEvent) => {
      if (resizingRef.current) return; // currently resizing
      const target = e.target as HTMLElement | null;
      if (!target) return;

      const cell = target.closest("td,th") as HTMLTableCellElement | null;
      const table = target.closest("table") as HTMLTableElement | null;

      // reset cursor by default
      (editor as HTMLElement).style.cursor = "";

      if (!cell || !table) {
        hoverRef.current = null;
        return;
      }

      ensureColgroup(table);

      if (isOnRightEdge(e, cell)) {
        const colIndex = columnIndexFromCell(cell);
        hoverRef.current = { table, colIndex };
        (editor as HTMLElement).style.cursor = "col-resize";
      } else {
        hoverRef.current = null;
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      if (!hoverRef.current) return;
      const { table, colIndex } = hoverRef.current;
      const colgroup = table.querySelector("colgroup");
      if (!colgroup) return;

      // Capture widths
      const cols = Array.from(colgroup.children) as HTMLTableColElement[];
      const startWidths = cols.map((c) => {
        const w = parseFloat((c.style.width || "").replace("px", ""));
        if (Number.isFinite(w)) return w;
        // compute width from rect as fallback
        const firstRow = firstRowCells(table);
        const cell = firstRow[colIndex];
        return cell ? cell.getBoundingClientRect().width : MIN_COL_W;
      });

      resizingRef.current = {
        table,
        startX: e.clientX,
        colIndex,
        startWidths,
      };

      // Prevent text selection while resizing
      e.preventDefault();
      document.addEventListener("mousemove", onDrag);
      document.addEventListener("mouseup", onMouseUp);
    };

    const onDrag = (e: MouseEvent) => {
      const state = resizingRef.current;
      if (!state) return;

      const { table, startX, colIndex, startWidths } = state;
      const delta = e.clientX - startX;

      const colgroup = table.querySelector("colgroup");
      if (!colgroup) return;
      const cols = Array.from(colgroup.children) as HTMLTableColElement[];
      if (cols.length === 0 || !cols[colIndex]) return;

      const totalBefore =
        startWidths.reduce((a, b) => a + b, 0);

      // Resize current and the next column to keep table width constant
      const nextIndex = Math.min(colIndex + 1, cols.length - 1);
      const newW = Math.max(MIN_COL_W, startWidths[colIndex] + delta);
      const newNextW = Math.max(MIN_COL_W, startWidths[nextIndex] - (newW - startWidths[colIndex]));

      // If next shrinks below min, clamp and adjust current accordingly
      const adjustedDelta = (startWidths[nextIndex] - newNextW);
      const finalW = startWidths[colIndex] + (delta - adjustedDelta);

      cols[colIndex].style.width = `${Math.max(MIN_COL_W, Math.round(finalW))}px`;
      cols[nextIndex].style.width = `${Math.max(MIN_COL_W, Math.round(newNextW))}px`;

      // Optional: correct slight drift to keep total width steady
      const totalAfter = Array.from(cols).reduce((sum, c) => sum + parseFloat(c.style.width || "0"), 0);
      const diff = totalBefore - totalAfter;
      if (Math.abs(diff) > 0.5) {
        cols[nextIndex].style.width = `${Math.max(MIN_COL_W, Math.round(newNextW + diff))}px`;
      }
    };

    const onMouseUp = () => {
      resizingRef.current = null;
      (editor as HTMLElement).style.cursor = "";
      document.removeEventListener("mousemove", onDrag);
      document.removeEventListener("mouseup", onMouseUp);
      // re-save selection so inserts still work at current caret
      const sel = window.getSelection();
      if (sel && sel.rangeCount) savedRangeRef.current = sel.getRangeAt(0).cloneRange();
    };

    editor.addEventListener("mousemove", onMouseMove);
    editor.addEventListener("mousedown", onMouseDown);

    // When content changes (paste a table, etc.), prepare tables
    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((n) => {
          if (n instanceof HTMLTableElement) ensureColgroup(n);
          if (n instanceof HTMLElement) {
            n.querySelectorAll("table").forEach((t) => ensureColgroup(t as HTMLTableElement));
          }
        });
      }
    });
    mo.observe(editor, { childList: true, subtree: true });

    return () => {
      editor.removeEventListener("mousemove", onMouseMove);
      editor.removeEventListener("mousedown", onMouseDown);
      mo.disconnect();
      document.removeEventListener("mousemove", onDrag);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  /* =========================
     UI
  ========================= */
  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto px-4 pt-8 pb-10">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="rounded-2xl border bg-card shadow-sm p-5 md:p-6 mb-5"
        >
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <div className="flex items-center gap-3">
              <FileText className="h-7 w-7 text-primary" />
              <div>
                <div className="flex items-center gap-2">
                  <Input
                    className="text-xl md:text-2xl font-semibold w-[14rem] md:w-[24rem]"
                    value={meta.title}
                    onChange={(e) => setMeta((m) => ({ ...m, title: e.target.value }))}
                  />
                  <Badge variant="secondary">Doc</Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Last saved: {new Date(meta.updatedAt).toLocaleString()}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2">
                <Label className="text-xs">Save to</Label>
                <select
                  className="border rounded-md bg-background px-2 py-1 text-sm"
                  value={saveTarget}
                  onChange={(e) => setSaveTarget(e.target.value as SaveTarget)}
                >
                  <option value="local">Local</option>
                  <option value="server">Server</option>
                </select>
              </div>

              <Button onClick={saveNow} disabled={saving} className="gap-2">
                <Save className="h-4 w-4" />
                {saving ? "Saving…" : "Save"}
              </Button>

              <Button onClick={exportPDF} disabled={exportStatus === "working"} className="gap-2">
                <Download className="h-4 w-4" />
                {exportStatus === "working"
                  ? "Exporting…"
                  : exportStatus === "done"
                  ? "Exported!"
                  : exportStatus === "error"
                  ? "Retry Export"
                  : "Export PDF"}
              </Button>
            </div>
          </div>

          {/* Settings */}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Ruler className="h-4 w-4 text-primary" />
              <Label htmlFor="pageSize" className="text-xs">Page</Label>
              <select
                id="pageSize"
                className="border rounded-md bg-background px-2 py-1 text-sm"
                value={meta.pageSize}
                onChange={(e) => setMeta((m) => ({ ...m, pageSize: e.target.value as PageSize }))}
              >
                <option value="A4">A4 (210×297mm)</option>
                <option value="Letter">Letter (8.5×11in)</option>
              </select>

              <Label htmlFor="margin" className="text-xs ml-3">Margins</Label>
              <select
                id="margin"
                className="border rounded-md bg-background px-2 py-1 text-sm"
                value={meta.margin}
                onChange={(e) => setMeta((m) => ({ ...m, margin: e.target.value as MarginPreset }))}
              >
                <option value="narrow">Narrow</option>
                <option value="normal">Normal</option>
                <option value="wide">Wide</option>
              </select>
            </div>

            <div className="ml-auto flex items-center gap-3">
              <Badge variant="secondary" className="gap-1">
                <CaseSensitive className="h-3.5 w-3.5" />
                {wordCount} words
              </Badge>
              <Button variant={showFind ? "default" : "secondary"} size="sm" onClick={() => setShowFind((v) => !v)}>
                <Search className="h-4 w-4 mr-1" />
                Find / Replace
              </Button>
            </div>
          </div>
        </motion.div>

        {/* Toolbar */}
        <Card className="border bg-card shadow-sm sticky top-2 z-30">
          <CardContent className="p-3">
            <div className="flex flex-wrap items-center gap-2">
              {/* Headings */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" size="sm" className="gap-1">
                    <Type className="h-4 w-4" />
                    Headings
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-40">
                  <DropdownMenuItem onClick={() => setBlock("P")}>Normal</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setBlock("H1")}>Heading 1</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setBlock("H2")}>Heading 2</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setBlock("H3")}>Heading 3</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setBlock("H4")}>Heading 4</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="h-6 w-px bg-border mx-1" />

              {/* Basic formatting */}
              <Button variant="secondary" size="sm" onClick={() => exec("bold")}><Bold className="h-4 w-4" /></Button>
              <Button variant="secondary" size="sm" onClick={() => exec("italic")}><Italic className="h-4 w-4" /></Button>
              <Button variant="secondary" size="sm" onClick={() => exec("underline")}><Underline className="h-4 w-4" /></Button>
              <Button variant="secondary" size="sm" onClick={() => exec("strikeThrough")}><Strikethrough className="h-4 w-4" /></Button>

              <div className="h-6 w-px bg-border mx-1" />

              {/* Color & Highlight */}
              <label className="inline-flex items-center gap-2 px-2 py-1.5 border rounded-md cursor-pointer text-sm">
                <Highlighter className="h-4 w-4" />
                Text
                <input type="color" className="ml-1 h-5 w-6 cursor-pointer" onChange={(e) => applyTextColor(e.target.value)} title="Text color" />
              </label>
              <label className="inline-flex items-center gap-2 px-2 py-1.5 border rounded-md cursor-pointer text-sm">
                <Highlighter className="h-4 w-4" />
                Highlight
                <input type="color" className="ml-1 h-5 w-6 cursor-pointer" onChange={(e) => applyHighlight(e.target.value)} title="Highlight color" />
              </label>

              <div className="h-6 w-px bg-border mx-1" />

              {/* Alignment */}
              <Button variant="secondary" size="sm" onClick={() => exec("justifyLeft")}><AlignLeft className="h-4 w-4" /></Button>
              <Button variant="secondary" size="sm" onClick={() => exec("justifyCenter")}><AlignCenter className="h-4 w-4" /></Button>
              <Button variant="secondary" size="sm" onClick={() => exec("justifyRight")}><AlignRight className="h-4 w-4" /></Button>
              <Button variant="secondary" size="sm" onClick={() => exec("justifyFull")}><AlignJustify className="h-4 w-4" /></Button>

              <div className="h-6 w-px bg-border mx-1" />

              {/* Lists */}
              <Button variant="secondary" size="sm" onClick={() => exec("insertUnorderedList")}><List className="h-4 w-4" /></Button>
              <Button variant="secondary" size="sm" onClick={() => exec("insertOrderedList")}><ListOrdered className="h-4 w-4" /></Button>
              <Button variant="secondary" size="sm" onClick={insertChecklist}><ListTodo className="h-4 w-4" /></Button>

              <div className="h-6 w-px bg-border mx-1" />

              {/* Inserts */}
              <Button variant="secondary" size="sm" onClick={() => setShowLinkDialog(true)}><LinkIcon className="h-4 w-4" /></Button>
              <Button variant="secondary" size="sm" onClick={() => setShowImageDialog(true)}><ImageIcon className="h-4 w-4" /></Button>
              <Button variant="secondary" size="sm" onClick={() => setShowTableDialog(true)}><TableIcon className="h-4 w-4" /></Button>
              <Button variant="secondary" size="sm" onClick={insertQuote}><Quote className="h-4 w-4" /></Button>
              <Button variant="secondary" size="sm" onClick={insertCodeBlock}><Code className="h-4 w-4" /></Button>

              <div className="h-6 w-px bg-border mx-1" />

              {/* Undo / Redo / Clear */}
              <Button variant="secondary" size="sm" onClick={() => exec("undo")}><Undo className="h-4 w-4" /></Button>
              <Button variant="secondary" size="sm" onClick={() => exec("redo")}><Redo className="h-4 w-4" /></Button>
              <Button variant="secondary" size="sm" onClick={clearFormatting}><Eraser className="h-4 w-4" /></Button>
            </div>

            {/* Find/Replace row */}
            {showFind && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Input placeholder="Find…" className="w-56" value={findQuery} onChange={(e) => setFindQuery(e.target.value)} />
                <Input placeholder="Replace with…" className="w-56" value={replaceWith} onChange={(e) => setReplaceWith(e.target.value)} />
                <Button size="sm" onClick={doFindNext}>Find next</Button>
                <Button size="sm" variant="secondary" onClick={doReplace}>Replace</Button>
                <Button size="sm" variant="secondary" onClick={doReplaceAll}>Replace all</Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Editor */}
        <div className="mt-5" id="doc-pages">
          <div
            data-doc-page="true"
            className={clsx("mx-auto bg-white rounded-lg border shadow-sm print:shadow-none", marginPadding(meta.margin))}
            style={{ width: pageCSS(meta.pageSize).w, minHeight: pageCSS(meta.pageSize).h }}
          >
            {/* Header */}
            <div className="text-center text-xs text-muted-foreground mb-3 select-none">
              <div className="font-medium">{meta.title || "Untitled Document"}</div>
              <div>{new Date(meta.updatedAt).toLocaleString()}</div>
              <div className="h-px bg-border my-2" />
            </div>

            {/* ContentEditable */}
            <div
              ref={editorRef}
              className="prose dark:prose-invert max-w-none focus:outline-none min-h-[70vh]
                         prose-h1:scroll-mt-24 prose-table:rounded-md prose-table:overflow-hidden
                         prose-img:max-w-full prose-img:rounded-md prose-pre:shadow-sm"
              contentEditable
              suppressContentEditableWarning
              spellCheck
              onInput={(e) => {
                const text = (e.currentTarget as HTMLDivElement).innerText || "";
                const wc = text.trim().split(/\s+/).filter(Boolean).length;
                setWordCount(wc);
              }}
              onClick={() => {
                const root = editorRef.current;
                if (root) root.focus();
              }}
              onPaste={(e) => {
                const native = e.nativeEvent as unknown;
                const shiftHeld = hasGetModifierState(native) && native.getModifierState("Shift");
                if (shiftHeld && e.clipboardData) {
                  e.preventDefault();
                  const text = e.clipboardData.getData("text/plain");
                  document.execCommand("insertText", false, text);
                }
              }}
            />
          </div>
        </div>

        {/* Link Dialog */}
        <Dialog open={showLinkDialog} onOpenChange={(open) => { setShowLinkDialog(open); if (open) restoreSelectionIntoEditor(); }}>
          <DialogContent className="sm:max-w-[420px]">
            <DialogHeader><DialogTitle>Insert Link</DialogTitle></DialogHeader>
            <div className="space-y-2">
              <Label>URL</Label>
              <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://…" />
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setShowLinkDialog(false)}>Cancel</Button>
              <Button onClick={insertLink}>Insert</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Image Dialog */}
        <Dialog open={showImageDialog} onOpenChange={(open) => { setShowImageDialog(open); if (open) restoreSelectionIntoEditor(); }}>
          <DialogContent className="sm:max-w-[420px]">
            <DialogHeader><DialogTitle>Insert Image</DialogTitle></DialogHeader>
            <div className="space-y-2">
              <Label>Choose image</Label>
              <Input type="file" accept="image/*" onChange={(e) => setImageFile(e.target.files?.[0] ?? null)} />
              <p className="text-xs text-muted-foreground">Tip: You can also paste (Ctrl/Cmd+V) or drag &amp; drop an image into the page.</p>
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setShowImageDialog(false)}>Cancel</Button>
              <Button disabled={!imageFile} onClick={insertImage}>Insert</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Table Dialog */}
        <Dialog open={showTableDialog} onOpenChange={(open) => { setShowTableDialog(open); if (open) restoreSelectionIntoEditor(); }}>
          <DialogContent className="sm:max-w-[420px]">
            <DialogHeader><DialogTitle>Insert Table</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Rows</Label>
                <Input type="number" min={1} max={20} value={tableRows} onChange={(e) => setTableRows(Number(e.target.value) || 1)} />
              </div>
              <div>
                <Label>Columns</Label>
                <Input type="number" min={1} max={12} value={tableCols} onChange={(e) => setTableCols(Number(e.target.value) || 1)} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setShowTableDialog(false)}>Cancel</Button>
              <Button onClick={insertTable}>Insert</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

/* =========================
   Starter Document HTML
========================= */
function starterDocHTML(): string {
  return `
  <h1>Welcome to Schedura Docs</h1>
  <p class="text-muted-foreground">A lightweight, fast, and elegant editor — type here 👇</p>
  <p>Tips:</p>
  <ul>
    <li>Use the toolbar above for headings, lists, alignment, and more.</li>
    <li>Insert images (upload, paste, or drag & drop), code blocks, quotes, tables, and checklists.</li>
    <li>Drag a table column edge to resize it. (Cursor changes to ↔.)</li>
    <li>Export your document as a PDF with one click.</li>
  </ul>
  `;
}
