import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Fixed, so that mekafit, which runs beside it, knows where to find it.
  server: { port: 5173, strictPort: true },
});
