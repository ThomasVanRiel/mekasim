import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // mekasim's dev server has the usual port; this one stands beside it.
  server: { port: 5174, strictPort: true },
});
