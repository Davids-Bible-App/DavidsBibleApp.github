import { Show } from "solid-js";
import { consecutiveDaysData } from "../State/globalSignals.js";
import "./CSS/StreakBadge.css";

// Format "YYYY-MM-DD" → "Jul 3, 2026". Returns "—" for null/invalid.
function formatDate(iso) {
  if (!iso || typeof iso !== "string") return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "—";
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function StreakBadge() {
  const data = () => consecutiveDaysData();

  return (
    <div class="StreakBadge-class">
      <button type="button" class="StreakBadge-button neu-button" commandfor="streak-popover" command="toggle-popover" onPointerDown={(e) => e.stopPropagation()} aria-label="View streak details">
        {data().currentStreak}
      </button>

      <div id="streak-popover" popover="auto" class="StreakBadge-popover">
        <div class="StreakBadge-arrow" aria-hidden="true"></div>

        <h3 class="StreakBadge-title">Your Streak</h3>

        <dl class="StreakBadge-stats">
          <div class="StreakBadge-row">
            <dt>Current Streak</dt>
            <dd>
              <Show when={data().currentStreak > 0} fallback="—">
                {data().currentStreak} <span class="StreakBadge-unit">{data().currentStreak === 1 ? "day" : "days"}</span>
              </Show>
            </dd>
          </div>

          <div class="StreakBadge-row StreakBadge-row-highlight">
            <dt>Longest Streak</dt>
            <dd>
              <Show when={data().longestStreak > 0} fallback="—">
                {data().longestStreak} <span class="StreakBadge-unit">{data().longestStreak === 1 ? "day" : "days"}</span>
              </Show>
            </dd>
          </div>

          <div class="StreakBadge-divider" aria-hidden="true"></div>

          <div class="StreakBadge-row">
            <dt>First Day</dt>
            <dd>{formatDate(data().firstDate)}</dd>
          </div>

          <div class="StreakBadge-row">
            <dt>Today</dt>
            <dd>{formatDate(data().currentDate)}</dd>
          </div>

          <Show when={data().longestStreakStartDate && data().longestStreakEndDate}>
            <div class="StreakBadge-divider" aria-hidden="true"></div>
            <div class="StreakBadge-row StreakBadge-row-range">
              <dt>Longest Run</dt>
              <dd>
                {formatDate(data().longestStreakStartDate)}
                <span class="StreakBadge-arrow-inline"> → </span>
                {formatDate(data().longestStreakEndDate)}
              </dd>
            </div>
          </Show>
        </dl>
      </div>
    </div>
  );
}
