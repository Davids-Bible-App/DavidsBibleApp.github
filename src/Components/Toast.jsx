/**
 * USAGE:
 * import ToastStack, { showToast } from "../Components/Toast";
 *
 * </footer> // example
 * <ToastStack />
 *
 * (alias) showToast(message: any, type?: string, duration?: number, silent?: boolean, nobar?: boolean): void
 * Examples:
 * showToast("File uploaded successfully!", "success");
 * showToast("Connection lost.", "error", 3000, false, false);
 **/

import { createSignal, For, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { TransitionGroup } from "solid-transition-group";
import { expandedCtl } from "../State/globalSignals.js";
import "./CSS/Toast.css";

const popSound = new Audio("/Toast.wav");
const [toasts, setToasts] = createSignal([]);

export const showToast = (
  message = "A Toast Component",
  type = "none",
  duration = 3000,
  silent = false,
  nobar = false,
) => {
  if (!silent) {
    popSound.currentTime = 0;
    popSound.volume = 0.6;
    popSound.play().catch(() => console.log("Audio interaction required"));
  }

  const id = Math.random().toString(36).substring(2, 9);
  setToasts((prev) => [...prev, { id, message, type, duration, nobar }]);

  setTimeout(() => removeToast(id), duration);
};

const removeToast = (id) => {
  setToasts((prev) => prev.filter((t) => t.id !== id));
};

const Icon = (props) => {
  /* prettier-ignore */
  const icons = {
    success: <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />,
    error: <path d="m 11.6,7 h 0.7 v 7 h -0.7 z m -0,9 h 0.8 v 0.8 H 11.6 Z M 21,12 a 9,9 0 1 1 -18,0 9,9 0 0 1 18,0 z" />,
    warning: <path d="M 21,12 a 9,9 0 1 1 -18,0 9,9 0 0 1 18,0 z M 12,8.5 8,15.5 h 8 z m -0.4,2.5 h 0.8 v 2.5 h -0.8 z m 0,3.3 h 0.8 v 0.7 h -0.8 z" />,
    info: <path d="m 11.6,10.5 h 0.7 v 6 h -0.7 z m 0,-3 h 0.7 V 8.1 H 11.7 Z M 21,12 a 9,9 0 1 1 -18,0 9,9 0 0 1 18,0 z" />,
    none: <path d="M 21,12 A 9,9 0 1 1 3,12 9,9 0 0 1 21,12 Z" />,
  };
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" class="toast-icon">
      {icons[props.type] || icons.none}
    </svg>
  );
};

export default function ToastStack(props) {
  return (
    <>
      <Portal>
        <div class="toast-stack" style={expandedCtl() ? "--toastPosY: 10rem" : "--toastPosY: 5rem"}>
          <TransitionGroup name="toast" appear>
            <For each={toasts()}>
              {(toast) => {
                const [offsetX, setOffsetX] = createSignal(0);
                const [isSwiping, setIsSwiping] = createSignal(false);
                let startX = 0;

                const handleTouchStart = (e) => {
                  startX = e.touches[0].clientX;
                  setIsSwiping(true);
                };

                const handleTouchMove = (e) => {
                  const deltaX = e.touches[0].clientX - startX;
                  if (deltaX > 0) setOffsetX(deltaX);
                };

                const handleTouchEnd = () => {
                  setIsSwiping(false);
                  if (offsetX() > 120) {
                    // 1. Continue the motion off-screen
                    setOffsetX(window.innerWidth);
                    // 2. Wait for transition (300ms) before actual DOM removal
                    setTimeout(() => {
                      removeToast(toast.id);
                    }, 300);
                  } else {
                    // Bounce back
                    setOffsetX(0);
                  }
                };

                return (
                  <div
                    class={`toast-item ${toast.type}`}
                    onTouchStart={handleTouchStart}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                    style={{
                      // We use offsetX !== 0 so it works during the "throw" and the "snap back"
                      transform: offsetX() !== 0 ? `translateX(${offsetX()}px)` : undefined,
                      opacity: offsetX() !== 0 ? Math.max(0, 1 - offsetX() / 300) : undefined,
                      transition: isSwiping() ? "none" : "transform 0.3s cubic-bezier(0.2, 0, 0, 1), opacity 0.3s ease",
                      "pointer-events": offsetX() > 20 ? "none" : "auto",
                    }}
                  >
                    <div class="toast-body">
                      <Icon type={toast.type} />
                      <span class="toast-message">{toast.message}</span>
                      <button class="toast-close" onClick={() => removeToast(toast.id)}>
                        <svg viewBox="0 0 20 20" fill="currentColor">
                          <path d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" />
                        </svg>
                      </button>
                    </div>
                    <Show when={!toast.nobar}>
                      <div class="toast-timer" style={{ "animation-duration": `${toast.duration}ms` }} />
                    </Show>
                  </div>
                );
              }}
            </For>
          </TransitionGroup>
        </div>
      </Portal>
    </>
  );
}
