// src/main.tsx
import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { AuthProvider } from "./context/AuthContext"; // ← remove if App.tsx already wraps it
import { ThemeProvider } from "next-themes";

// i18n
import i18n from "./i18n";
import { I18nextProvider } from "react-i18next";
import AutoDOMTranslator from "./i18n/dom-bridge";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      value={{ light: "light", dark: "night" }}
    >
      <I18nextProvider i18n={i18n}>
        {/* Runs a mutation observer that translates text nodes across the app */}
        <AutoDOMTranslator />

        <Suspense fallback={<div className="p-4 text-sm text-muted-foreground">Loading…</div>}>
          {/* If App.tsx already wraps <AuthProvider>, delete the wrapper below */}
          <AuthProvider>
            <App />
          </AuthProvider>
        </Suspense>
      </I18nextProvider>
    </ThemeProvider>
  </StrictMode>
);
