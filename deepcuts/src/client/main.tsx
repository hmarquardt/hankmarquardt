import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<App />);
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      window.dispatchEvent(
        new CustomEvent("deepcuts-notice", {
          detail:
            "Offline launch could not be enabled. Keep this tab open and try again.",
        }),
      );
    });
  });
}
