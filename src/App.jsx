import { createSignal, onMount, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import MainContent from "./Components/MainContent";
import "./App.css";

function App() {
  const [isDbReady, setIsDbReady] = createSignal(false);
  const [isLoaded, setIsLoaded] = createSignal(false);
  const [errorMessage, setErrorMessage] = createSignal(null);

  onMount(async () => {
    try {
      // 1. Initialize the DB first and wait for it to finish
      await invoke("initialize_profile_db");

      // 2. Tweakable 500ms delay to ensure backend SQLite file locks settle
      // await new Promise((r) => setTimeout(r, 300));

      // 3. Mount MainContent so it can safely start fetching its data
      setIsDbReady(true);

      // 4. Let the spinner run another 500ms while MainContent loads silently behind it
      await new Promise((r) => setTimeout(r, 700));

      // 5. Fade out the loader gracefully
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
          <h3>Database Error</h3> <p>{errorMessage()}</p>
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
