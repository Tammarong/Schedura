import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import jsxA11y from "eslint-plugin-jsx-a11y";
import nextPlugin from "eslint-plugin-next"; // only to satisfy any stray // eslint-disable-next-line @next/next/* comments

export default tseslint.config(
  // Ignores
  { ignores: ["dist", "build", ".vite", "node_modules"] },

  // Main config for TS/React project
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "module",
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      "jsx-a11y": jsxA11y,
      "@next/next": nextPlugin, // don't enable any rules; just makes @next/next/* names resolvable
    },
    // Helpful linter behavior (non-blocking)
    linterOptions: {
      reportUnusedDisableDirectives: "warn",
    },
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,              // typescript-eslint base rules
      jsxA11y.configs?.recommended ?? {},           // accessibility
    ],
    rules: {
      // Keep React hooks correctness
      ...reactHooks.configs.recommended.rules,

      // Fast Refresh: ensures components are exported the right way
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],

      // Tame common TypeScript nags
      "@typescript-eslint/no-explicit-any": "off",  // allow `any` without errors
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  }
);
