import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// One JS and one CSS file, which scripts/embed-ui.mjs inlines into the HTML.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "../dist-ui",
    emptyOutDir: true,
    modulePreload: false,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000,
    rolldownOptions: { output: { codeSplitting: false } },
  },
});
