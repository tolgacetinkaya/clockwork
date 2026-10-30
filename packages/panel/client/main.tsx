import { t, initializeLocale } from "./i18n.js";
import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@fontsource-variable/dm-sans";
import "./styles.css";
import { App } from "./App.js";
import "./arcade-theme.css";

initializeLocale();

const cache = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});
class PanelBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? (
      <main className="fatal-state">
        <h1>{t("The workspace could not render.")}</h1>
        <p>{t("Your project files are unchanged. Reload to reconnect.")}
            </p>
        <button
          className="primary-button"
          onClick={() => window.location.reload()}
        >
          {t("Reload workspace")}
            </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PanelBoundary>
      <QueryClientProvider client={cache}>
        <App />
      </QueryClientProvider>
    </PanelBoundary>
  </React.StrictMode>,
);
