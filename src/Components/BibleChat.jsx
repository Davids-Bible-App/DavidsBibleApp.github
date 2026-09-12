import { createSignal, For, Show, onCleanup, onMount } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { confirm } from "@tauri-apps/plugin-dialog";
import ModelManager from "./ModelManager";
import "./CSS/BibleChat.css";

const GREETING = { role: "assistant", content: "Ask me anything about the Bible." };

export default function BibleChat() {
  const [messages, setMessages] = createSignal([GREETING]);
  const [input, setInput] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal(null);
  const [modelStatus, setModelStatus] = createSignal("loading");

  const [conversations, setConversations] = createSignal([]);
  const [currentId, setCurrentId] = createSignal(null);
  const [historyOpen, setHistoryOpen] = createSignal(false);
  const [modelManagerOpen, setModelManagerOpen] = createSignal(false);

  let scrollRef;

  const isNearBottom = (threshold = 80) => {
    if (!scrollRef) return true;
    return scrollRef.scrollHeight - scrollRef.scrollTop - scrollRef.clientHeight < threshold;
  };

  const scrollToBottom = (force = false) => {
    queueMicrotask(() => {
      if (!scrollRef) return;
      if (force || isNearBottom()) {
        scrollRef.scrollTop = scrollRef.scrollHeight;
      }
    });
  };

  async function refreshConversations() {
    try {
      const list = await invoke("list_bible_conversations");
      setConversations(list);
    } catch (err) {
      console.error("Failed to load conversation list:", err);
    }
  }

  onMount(async () => {
    const unlistenReady = await listen("model-ready", () => setModelStatus("ready"));
    const unlistenError = await listen("model-error", (e) => {
      setModelStatus("error");
      setError(`Model failed to load: ${e.payload}`);
    });
    // ← NEW: reflect a manual unload immediately
    const unlistenUnloaded = await listen("model-unloaded", () => setModelStatus("unloaded"));

    // ← CHANGED: previously this left modelStatus stuck on "loading" forever
    // if nothing was loaded, because nothing auto-loads a model anymore.
    try {
      const loaded = await invoke("is_model_loaded");
      setModelStatus(loaded ? "ready" : "unloaded");
    } catch {
      setModelStatus("unloaded");
    }

    refreshConversations();

    onCleanup(() => {
      unlistenReady();
      unlistenError();
      unlistenUnloaded();
    });
  });

  function startNewChat() {
    setCurrentId(null);
    setMessages([GREETING]);
    setError(null);
    setHistoryOpen(false);
  }

  async function stop() {
    try {
      await invoke("cancel_chat");
    } catch (err) {
      console.error("Failed to cancel:", err);
    }
  }

  async function openConversation(id) {
    try {
      const history = await invoke("get_bible_conversation_messages", { id });
      setCurrentId(id);
      setMessages(history.length ? history : [GREETING]);
      setError(null);
      setHistoryOpen(false);
      scrollToBottom();
    } catch (err) {
      console.error("Failed to load conversation:", err);
      setError("Couldn't load that conversation.");
    }
  }

  async function deleteConversation(id, event) {
    event.stopPropagation(); // don't also trigger openConversation
    const sure = await confirm("Delete this conversation? This can't be undone.", {
      title: "Delete conversation",
      kind: "warning",
    });
    if (!sure) return;

    try {
      await invoke("delete_bible_conversation", { id });
      if (currentId() === id) startNewChat();
      refreshConversations();
    } catch (err) {
      console.error("Failed to delete conversation:", err);
      setError("Couldn't delete that conversation.");
    }
  }

  async function send() {
    const text = input().trim();
    if (!text || busy() || modelStatus() !== "ready") return;

    setError(null);
    setInput("");

    const historyForBackend = messages().map(({ role, content }) => ({ role, content }));

    setMessages((prev) => [...prev, { role: "user", content: text }, { role: "assistant", content: "" }]);
    scrollToBottom(true);
    setBusy(true);

    let full = "";
    const unlisten = await listen("chat-token", (e) => {
      full += e.payload;
      setMessages((prev) => {
        const next = prev.slice();
        next[next.length - 1] = { role: "assistant", content: full };
        return next;
      });
      scrollToBottom();
    });

    try {
      // Lazily create the conversation row on the first message of a new chat.
      let conversationId = currentId();
      if (conversationId === null) {
        conversationId = await invoke("create_bible_conversation");
        setCurrentId(conversationId);
      }

      await invoke("append_bible_message", { conversationId, role: "user", content: text });
      await invoke("chat", { prompt: text, history: historyForBackend });
      await invoke("append_bible_message", { conversationId, role: "assistant", content: full });

      refreshConversations();
    } catch (err) {
      console.error("BibleChat error:", err);
      setError(typeof err === "string" ? err : "Something went wrong generating a reply.");
      setMessages((prev) => prev.slice(0, -1)); // drop the empty placeholder
    } finally {
      unlisten();
      setBusy(false);
    }
  }

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const formatDate = (unixSeconds) => new Date(unixSeconds * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  function TypingDots() {
    return (
      <span class="BibleChat-typing">
        <span class="BibleChat-typing-dot" />
        <span class="BibleChat-typing-dot" />
        <span class="BibleChat-typing-dot" />
      </span>
    );
  }

  return (
    <div class="BibleChat-root">
      <div class="BibleChat-topbar">
        <button class="BibleChat-topbar-btn" onClick={() => setHistoryOpen((v) => !v)}>
          History
        </button>
        <button class="BibleChat-topbar-btn" onClick={startNewChat}>
          + New Chat
        </button>
        <button class="BibleChat-topbar-btn BibleChat-topbar-btn--icon" onClick={() => setModelManagerOpen(true)}>
          Models
        </button>
      </div>

      <ModelManager open={modelManagerOpen()} onClose={() => setModelManagerOpen(false)} />

      <Show when={historyOpen()}>
        <div class="BibleChat-history-overlay" onClick={() => setHistoryOpen(false)}>
          <div class="BibleChat-history-panel" onClick={(e) => e.stopPropagation()}>
            <Show when={conversations().length > 0} fallback={<div class="BibleChat-history-empty">No past conversations yet.</div>}>
              <For each={conversations()}>
                {(c) => (
                  <div class={`BibleChat-history-item ${c.id === currentId() ? "BibleChat-history-item--active" : ""}`} onClick={() => openConversation(c.id)}>
                    <div class="BibleChat-history-item-text">
                      <div class="BibleChat-history-item-title">{c.title}</div>
                      <div class="BibleChat-history-item-date">{formatDate(c.updated_at)}</div>
                    </div>
                    <button class="BibleChat-history-delete" onClick={(e) => deleteConversation(c.id, e)} title="Delete conversation">
                      ×
                    </button>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </div>
      </Show>

      <div ref={scrollRef} class="BibleChat-scroll scroll_Win">
        <For each={messages()}>
          {(m, i) => (
            <div class={`BibleChat-row BibleChat-row--${m.role}`}>
              <div class={`BibleChat-bubble BibleChat-bubble--${m.role}`}>{m.content ? m.content : busy() && i() === messages().length - 1 ? <TypingDots /> : ""}</div>
            </div>
          )}
        </For>
      </div>

      {modelStatus() === "unloaded" && (
        <div class="BibleChat-status">
          No model loaded.{" "}
          <button class="BibleChat-status-link" onClick={() => setModelManagerOpen(true)}>
            Open Models
          </button>{" "}
          to pick one.
        </div>
      )}
      {modelStatus() === "loading" && <div class="BibleChat-status">Loading model — this can take a little while for a large GGUF file…</div>}
      {error() && <div class="BibleChat-error">{error()}</div>}

      <div class="BibleChat-input-area">
        <textarea class="BibleChat-textarea" value={input()} onInput={(e) => setInput(e.currentTarget.value)} onKeyDown={onKeyDown} placeholder={modelStatus() === "ready" ? "Ask a question about scripture…" : "Waiting for model…"} rows={1} disabled={busy() || modelStatus() !== "ready"} />
        <Show
          when={busy()}
          fallback={
            <button class="BibleChat-send" onClick={send} disabled={!input().trim() || modelStatus() !== "ready"}>
              Send
            </button>
          }
        >
          <button class="BibleChat-send BibleChat-send--stop" onClick={stop}>
            Stop
          </button>
        </Show>
      </div>
    </div>
  );
}
