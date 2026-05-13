// src/Components/CountdownTimer.jsx
import { createSignal, onCleanup, onMount, For } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { type } from "@tauri-apps/plugin-os";
import { startService, stopService, isServiceRunning } from "tauri-plugin-background-service";
import "./CSS/CountdownTimer.css";

// ─── Background-service helpers (unchanged) ────────────────────────────────

const ensureServiceRunning = async () => {
  try {
    if (!(await isServiceRunning())) {
      await startService({ serviceLabel: "Sleep timer" });
    }
  } catch (e) {
    console.error("[BG] startService failed", e);
  }
};

const ensureServiceStopped = async () => {
  try {
    if (await isServiceRunning()) {
      await stopService();
    }
  } catch (e) {
    console.error("[BG] stopService failed", e);
  }
};

// ─── ScrollColumn ───────────────────────────────────────────────────────────
//
//  props:
//    value      () => number   reactive getter for the current value
//    onChange   (n) => void    called with new value while dragging
//    min        number
//    max        number
//    disabled   () => boolean  locks interaction when true
//    label      string         e.g. "HH" / "MM" / "SS"

const ITEM_H = 48; // px — height of each row
const VISIBLE = 5; // rows visible in the window (must be odd)

const ScrollColumn = (props) => {
  let el;
  let dragging = false;
  let startY = 0;
  let startVal = 0;

  const [offset, setOffset] = createSignal(0); // fractional drag offset in px
  const [isDragging, setIsDragging] = createSignal(false); // drives CSS transition

  const clamp = (v) => Math.max(props.min, Math.min(props.max, v));
  const val = () => clamp(props.value());

  // Position the list so the selected item sits in the centre row.
  //   centre row top = Math.floor(VISIBLE / 2) * ITEM_H  →  96 px (for VISIBLE=5)
  //   item[valIdx] top = translateY + valIdx * ITEM_H
  //   → translateY = centreTop − valIdx * ITEM_H + dragOffset
  const translateY = () => Math.floor(VISIBLE / 2) * ITEM_H - (val() - props.min) * ITEM_H + offset();

  // ── Pointer handlers ─────────────────────────────────────────────────────

  const onPointerDown = (e) => {
    if (props.disabled()) return;
    dragging = true;
    startY = e.clientY;
    startVal = val();
    setOffset(0);
    setIsDragging(true);
    el.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e) => {
    if (!dragging) return;
    const dy = e.clientY - startY;
    // Upward drag → positive steps (larger values); downward → negative.
    const snapSteps = Math.round(-dy / ITEM_H);
    props.onChange(clamp(startVal + snapSteps));
    // Keep the visual position tracking the finger exactly:
    //   visual shift = −snapSteps×ITEM_H + offset  must equal  dy
    //   → offset = dy + snapSteps×ITEM_H
    setOffset(dy + snapSteps * ITEM_H);
  };

  const onPointerUp = () => {
    if (!dragging) return;
    dragging = false;
    setOffset(0); // snap-back animation (CSS transition kicks in)
    setIsDragging(false);
  };

  // Mouse wheel — useful on desktop / emulator
  const onWheel = (e) => {
    if (props.disabled()) return;
    e.preventDefault();
    props.onChange(clamp(val() + (e.deltaY > 0 ? 1 : -1)));
  };

  // Static item list — range never changes after mount
  const items = Array.from({ length: props.max - props.min + 1 }, (_, i) => props.min + i);

  return (
    <div class="scroll-col">
      <div class="scroll-col-window" ref={(r) => (el = r)} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onWheel={onWheel} style={{ cursor: props.disabled() ? "default" : "ns-resize" }}>
        {/* Centre-row highlight band */}
        <div class="scroll-highlight" />

        {/* Scrolling list.
            classList reads val() reactively → distance classes update
            on every tick without re-creating DOM nodes.               */}
        <div
          class="scroll-list"
          style={{
            transform: `translateY(${translateY()}px)`,
            transition: isDragging() ? "none" : "transform 0.14s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
          }}
        >
          <For each={items}>
            {(i) => (
              <div
                class="scroll-item"
                classList={{
                  "scroll-item-sel": i === val(),
                  "scroll-item-near": Math.abs(i - val()) === 1,
                  "scroll-item-far": Math.abs(i - val()) >= 2,
                }}
              >
                {String(i).padStart(2, "0")}
              </div>
            )}
          </For>
        </div>
      </div>

      <div class="scroll-label">{props.label}</div>
    </div>
  );
};

// ─── CountdownTimer ─────────────────────────────────────────────────────────

const CountdownTimer = (props) => {
  const [hours, setHours] = createSignal(0);
  const [minutes, setMinutes] = createSignal(0);
  const [secondsLeft, setSecondsLeft] = createSignal(0);
  const [isActive, setIsActive] = createSignal(false);

  let unlistenTick = null;
  let unlistenDone = null;

  const totalSeconds = () => hours() * 3600 + minutes() * 60;

  // ── What the picker displays ──────────────────────────────────────────────
  //
  //  editable  — no timer loaded at all: user sets hours + minutes
  //  locked    — timer is running OR paused: show live / paused countdown
  //
  const hasTime = () => secondsLeft() > 0;
  const editable = () => !isActive() && !hasTime();

  const dispH = () => (hasTime() ? Math.floor(secondsLeft() / 3600) : hours());
  const dispM = () => (hasTime() ? Math.floor((secondsLeft() % 3600) / 60) : minutes());
  const dispS = () => (hasTime() ? secondsLeft() % 60 : 0);

  // ── Backend event handlers (unchanged) ────────────────────────────────────

  const handleBackendTrigger = async () => {
    try {
      if (props.isPlaying()) {
        type() === "android" && (await props.pause());
        type() === "windows" && (await props.audioRef.pause());
        props.setIsPlaying(false);
        setIsActive(false);
      }
    } catch (err) {
      console.error("Backend call failed", err);
    }
  };

  onMount(async () => {
    unlistenTick = await listen("my-service://timer-tick", (event) => {
      const remaining = Number(event.payload);
      setSecondsLeft(remaining);
      setIsActive(remaining > 0);
    });

    unlistenDone = await listen("my-service://timer-done", async () => {
      setSecondsLeft(0);
      setIsActive(false);
      await handleBackendTrigger();
      await ensureServiceStopped();
    });

    if (await isServiceRunning()) {
      const remaining = await invoke("timer_get_remaining");
      if (remaining > 0) {
        setSecondsLeft(Number(remaining));
        setIsActive(true);
      }
    }
  });

  onCleanup(() => {
    unlistenTick && unlistenTick();
    unlistenDone && unlistenDone();
  });

  // ── Timer actions (unchanged) ─────────────────────────────────────────────

  const startTimer = async () => {
    if (isActive()) return;
    const seed = secondsLeft() === 0 ? totalSeconds() : secondsLeft();
    if (seed <= 0) return;
    await ensureServiceRunning();
    await invoke("timer_start", { seconds: seed });
    setSecondsLeft(seed);
    setIsActive(true);
  };

  const stopTimer = async () => {
    setIsActive(false);
    const remaining = await invoke("timer_pause");
    setSecondsLeft(Number(remaining));
  };

  const resetTimer = async () => {
    await invoke("timer_cancel");
    setIsActive(false);
    setSecondsLeft(0);
    await ensureServiceStopped();
  };

  const handleBegin = async () => {
    try {
      if (props.hasState() || (props.playableSrc() && !props.isPlaying())) {
        await startTimer();
        type() === "android" && (await props.resume());
        type() === "windows" && props.audioRef.play();
        props.setIsPlaying(true);
      } else if (!props.hasState() || (props.playableSrc() && !props.isPlaying() && totalSeconds() > 0)) {
        await startTimer();
        type() === "android" && props.togglePlay();
        type() === "windows" && props.audioRef.play();
        props.setIsPlaying(true);
      }
    } catch (err) {
      console.error("Timer Play/Resume call failed", err);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div class="CountdownTimer-container">
      <h2 class="CountdownTimer-title">Stop Audio After:</h2>

      {/* Drum-roll picker — replaces both the old display and the number inputs */}
      <div class={`CountdownTimer-picker${editable() ? "" : " picker-locked"}`}>
        <ScrollColumn value={dispH} onChange={(v) => editable() && setHours(v)} min={0} max={23} disabled={() => !editable()} label="HH" />

        <div class="scroll-sep">:</div>

        <ScrollColumn value={dispM} onChange={(v) => editable() && setMinutes(v)} min={0} max={59} disabled={() => !editable()} label="MM" />

        <div class="scroll-sep">:</div>

        {/* Seconds: always read-only — just shows the live countdown */}
        <ScrollColumn value={dispS} onChange={() => {}} min={0} max={59} disabled={() => true} label="SS" />
      </div>

      <div class="CountdownTimer-controls">
        {!isActive() ? (
          <button class="CountdownTimer-btn start" onClick={handleBegin}>
            {secondsLeft() > 0 ? "Resume" : "Start"}
          </button>
        ) : (
          <button
            class="CountdownTimer-btn stop"
            onClick={async () => {
              await stopTimer();
              try {
                if (props.isPlaying()) {
                  type() === "android" && (await props.pause());
                  type() === "windows" && (await props.audioRef.pause());
                }
              } catch (err) {
                console.error("Timer Pause call failed", err);
              }
            }}
          >
            Stop
          </button>
        )}
        <button class="CountdownTimer-btn reset" onClick={resetTimer}>
          Reset
        </button>
      </div>
    </div>
  );
};

export default CountdownTimer;
