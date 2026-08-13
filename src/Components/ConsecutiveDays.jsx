import { onCleanup } from "solid-js";
import { setConsecutiveDaysData } from "../State/globalSignals.js";
import { invoke } from "@tauri-apps/api/core";

const STORAGE_KEY = "streak:data";

// --- Local-day helpers ------------------------------------------------------

// YYYY-MM-DD in the user's local timezone.
function localDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Returns the local dateKey for (today - 1 day).
function localYesterdayKey() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return localDateKey(d);
}

function msUntilLocalMidnight() {
  const now = new Date();
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return nextMidnight.getTime() - now.getTime();
}

// --- Storage (SQLite via Tauri) ---------------------------------------------

const EMPTY = {
  firstDate: null,
  currentDate: null,
  currentStreak: 0,
  longestStreak: 0,
  longestStreakStartDate: null,
  longestStreakEndDate: null,
};

async function loadStreak() {
  try {
    const raw = await invoke("get_config", { key: STORAGE_KEY });
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw);
    // Shallow shape validation with safe defaults.
    return {
      firstDate: typeof parsed.firstDate === "string" ? parsed.firstDate : null,
      currentDate: typeof parsed.currentDate === "string" ? parsed.currentDate : null,
      currentStreak: Number.isFinite(parsed.currentStreak) && parsed.currentStreak >= 0 ? parsed.currentStreak : 0,
      longestStreak: Number.isFinite(parsed.longestStreak) && parsed.longestStreak >= 0 ? parsed.longestStreak : 0,
      longestStreakStartDate: typeof parsed.longestStreakStartDate === "string" ? parsed.longestStreakStartDate : null,
      longestStreakEndDate: typeof parsed.longestStreakEndDate === "string" ? parsed.longestStreakEndDate : null,
    };
  } catch (err) {
    console.error("ConsecutiveDays load failed:", err);
    return { ...EMPTY };
  }
}

async function saveStreak(data) {
  try {
    await invoke("set_config", {
      key: STORAGE_KEY,
      value: JSON.stringify(data),
    });
  } catch (err) {
    console.error("ConsecutiveDays save failed:", err);
  }
}

// --- Core streak update -----------------------------------------------------

// Given a stored streak record + today's date, returns the updated record.
// The current-streak's start date is derived as (today - currentStreak + 1),
// so we can track the longest streak's start/end without persisting a
// separate "currentStreakStartDate" field.
function computeUpdated(prev, today, yesterday) {
  // First-ever open, or storage was empty.
  if (!prev.currentDate) {
    return {
      firstDate: today,
      currentDate: today,
      currentStreak: 1,
      longestStreak: Math.max(prev.longestStreak, 1),
      longestStreakStartDate: prev.longestStreak >= 1 ? prev.longestStreakStartDate : today,
      longestStreakEndDate: prev.longestStreak >= 1 ? prev.longestStreakEndDate : today,
    };
  }

  // Already counted today → no-op.
  if (prev.currentDate === today) return prev;

  let currentStreak;
  if (prev.currentDate === yesterday) {
    currentStreak = prev.currentStreak + 1;
  } else {
    // Missed one or more days → reset to 1.
    currentStreak = 1;
  }

  const currentStreakStartDate = computeStreakStartDate(today, currentStreak);

  let longestStreak = prev.longestStreak;
  let longestStreakStartDate = prev.longestStreakStartDate;
  let longestStreakEndDate = prev.longestStreakEndDate;
  if (currentStreak > longestStreak) {
    longestStreak = currentStreak;
    longestStreakStartDate = currentStreakStartDate;
    longestStreakEndDate = today;
  } else if (currentStreak === longestStreak && prev.currentDate === yesterday) {
    // Tie while extending — keep the current run as the "official" longest end.
    longestStreakEndDate = today;
    longestStreakStartDate = currentStreakStartDate;
  }

  return {
    firstDate: prev.firstDate ?? today,
    currentDate: today,
    currentStreak,
    longestStreak,
    longestStreakStartDate,
    longestStreakEndDate,
  };
}

// Subtract (streakLength - 1) days from today, in local time.
function computeStreakStartDate(todayKey, streakLength) {
  const [y, m, d] = todayKey.split("-").map(Number);
  const start = new Date(y, m - 1, d);
  start.setDate(start.getDate() - (streakLength - 1));
  return localDateKey(start);
}

// ---------------------------------------------------------------------------

export default function ConsecutiveDays(props) {
  const emit = (data) => {
    setConsecutiveDaysData(data);
    props.onUpdate?.(data);
  };

  const check = async () => {
    const today = localDateKey();
    const yesterday = localYesterdayKey();
    const prev = await loadStreak();
    const next = computeUpdated(prev, today, yesterday);

    // Only write if something actually changed.
    if (next.currentDate !== prev.currentDate || next.currentStreak !== prev.currentStreak || next.longestStreak !== prev.longestStreak || next.firstDate !== prev.firstDate) {
      await saveStreak(next);
    }

    emit(next);
  };

  // Run once on mount.
  check();

  // Re-check at local midnight (handles app staying open across midnight).
  let midnightTimer;
  const scheduleMidnight = () => {
    midnightTimer = setTimeout(async () => {
      await check();
      scheduleMidnight();
    }, msUntilLocalMidnight() + 500);
  };
  scheduleMidnight();

  onCleanup(() => {
    if (midnightTimer) clearTimeout(midnightTimer);
  });

  return null; // headless
}
