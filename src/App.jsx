import { createSignal, onMount, Show, lazy } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

// Defers the module load — and every module-level invoke inside it —
// until the component is actually rendered (i.e., after isDbReady = true)
const MainContent = lazy(() => import("./Components/MainContent"));

function App() {
  const [isDbReady, setIsDbReady] = createSignal(false);
  const [isLoaded, setIsLoaded] = createSignal(false);
  const [errorMessage, setErrorMessage] = createSignal(null);

  onMount(async () => {
    try {
      const isFirstRun = await invoke("initialize_profile_db");
      setIsDbReady(true);
      await new Promise((r) => setTimeout(r, isFirstRun ? 1000 : 200));
      setIsLoaded(true);
    } catch (e) {
      console.error("Init Error:", e);
      setErrorMessage(e.toString());
    }
  });

  return (
    <>
      <Show when={errorMessage()}>
        <div style="position: fixed; z-index: 10000; inset: 0; background: #0f1114; color: red; padding: 20px;">
          <h3>Database Error</h3>
          <p>{errorMessage()}</p>
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      </Show>

      <div class="App-loader-overlay" classList={{ hidden: isLoaded() }}>
        <div class="App-thinking-loader">
          <div class="App-pulse-circle"></div>
        </div>
        <p class="App-loading-text">Preparing Profile...</p>
      </div>

      {/* Only mount MainContent AFTER the DB is fully initialized and delayed */}
      <Show when={isDbReady()}>
        <MainContent />
      </Show>
    </>
  );
}

export default App;
