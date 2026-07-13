import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/out/**",
      "**/build/**",
      "**/node_modules/**",
      ".nx/**",
      "tmp/**",
      "**/*.d.ts",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    extends: [...tseslint.configs.recommended],
  },
  {
    // Electron main/preload/signaling/shared code: runs under Node, CommonJS-style globals.
    files: [
      "apps/server-electron/**/*.ts",
      "apps/signaling/**/*.ts",
      "libs/**/*.ts",
    ],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // React PWA client: browser globals + hooks rules.
    files: ["apps/client-pwa/**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
  {
    // Landing page: plain browser TS, no React.
    files: ["apps/landing/**/*.ts"],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // Electron preload script for the hidden WebRTC renderer window: plain CommonJS, runs under Node.
    files: ["apps/server-electron/assets/webrtc/preload.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: globals.node,
    },
  },
  {
    // Electron hidden renderer window: plain browser script (Chromium, no Node integration).
    files: ["apps/server-electron/assets/webrtc/renderer.js"],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // Node CLI scripts, CommonJS.
    files: ["scripts/**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: globals.node,
    },
  },
);
