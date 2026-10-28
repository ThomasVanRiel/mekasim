import { analyticsScript, startAnalytics } from "@mekasim/ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./index.css";

startAnalytics(analyticsScript(import.meta.env.VITE_PLAUSIBLE_SCRIPT));

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
