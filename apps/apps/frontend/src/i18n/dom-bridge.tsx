// src/i18n/dom-bridge.tsx
import { useEffect } from "react";
import i18n from "./index";

/** Translate plain text nodes in the app by matching literal English phrases. */
function translateTree(root: Node) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      const t = n.nodeValue?.trim();
      if (!t) return NodeFilter.FILTER_REJECT;
      // skip long blobs (likely content) to avoid heavy work
      if (t.length > 120) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node.nodeValue ?? "";
    const t = i18n.t(text);
    if (t && t !== text) {
      node.nodeValue = (node.nodeValue || "").replace(text, t);
    }
  }
}

export default function AutoDOMTranslator() {
  useEffect(() => {
    const run = () => {
      document.documentElement.lang = i18n.language;
      translateTree(document.body);
    };
    run();

    const mo = new MutationObserver((mut) => {
      for (const m of mut) {
        if (m.type === "childList") {
          m.addedNodes.forEach((n) => translateTree(n));
        } else if (m.type === "characterData") {
          const text = m.target.nodeValue ?? "";
          const t = i18n.t(text);
          if (t && t !== text) m.target.nodeValue = t;
        }
      }
    });
    mo.observe(document.body, { subtree: true, childList: true, characterData: true });

    const onLang = () => run();
    i18n.on("languageChanged", onLang);

    return () => {
      mo.disconnect();
      i18n.off("languageChanged", onLang);
    };
  }, []);

  return null;
}
