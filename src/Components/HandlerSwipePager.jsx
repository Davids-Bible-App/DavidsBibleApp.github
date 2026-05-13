import { onMount, onCleanup } from "solid-js";
import { triggerHaptic } from "../lib/functions.js";

/* ---------- helpers ---------- */
function distance(p1, p2) {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.hypot(dx, dy);
}

function getZone(x, y) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const top = 0.1 * vh,
    bottom = 0.1 * vh,
    left = 0.15 * vw,
    right = 0.15 * vw;
  return x < left || x > vw - right || y < top || y > vh - bottom ? "edge" : "center";
}
/* --------------------------------------------------------------- */

export default function HandlerSwipePager(props) {
  const pointers = new Map();

  // single-finger
  let isSwiping = false;
  let startX = 0;
  let startY = 0;
  let singleFingerPaged = false;
  let singleFingerIntent = "idle"; // "idle" | "horizontal" | "vertical" | "longpress"

  // NEW: Long Press State
  let longPressTimer = null;

  // two-finger
  let twoFingerMode = "idle"; // "idle" | "paging" | "zoom"
  let anchorX;
  let anchorDist;

  // Frame lock to prevent continuous gesture stutter
  let isTicking = false;

  /* ---------- pointer handlers --------------------------------- */
  function onPointerDown(e) {
    if (props.touchActionRestored && props.touchActionRestored()) return;
    if (e.pointerType !== "touch") return;

    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Always clear the timer on a new touch to be safe
    clearTimeout(longPressTimer);

    if (pointers.size === 1) {
      // first finger
      startX = e.clientX;
      startY = e.clientY;
      isSwiping = getZone(startX, startY) === "center";
      singleFingerPaged = false;
      singleFingerIntent = "idle";

      // NEW: Start the Long Press Timer
      if (isSwiping) {
        const target = e.target;
        longPressTimer = setTimeout(() => {
          singleFingerIntent = "longpress";
          isSwiping = false;

          triggerHaptic("soft");

          props.onLongPress?.({ target, x: startX, y: startY });
          target.dispatchEvent(new CustomEvent("pager-long-press", { bubbles: true }));
        }, 500);
      }
    } else if (pointers.size === 2) {
      // Second finger landed: cancel long press
      clearTimeout(longPressTimer);

      let p1, p2;
      let idx = 0;
      for (const p of pointers.values()) {
        if (idx === 0) p1 = p;
        else p2 = p;
        idx++;
      }
      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;
      isSwiping = getZone(midX, midY) === "center";
      twoFingerMode = "idle";
      anchorX = undefined;
      anchorDist = undefined;
    }
  }

  function onPointerMove(e) {
    if (props.touchActionRestored && props.touchActionRestored()) return;
    if (e.pointerType !== "touch" || !pointers.has(e.pointerId)) return;

    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 1) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      // NEW: Cancel long press if the finger drifts more than 10px
      if (absDx > 20 || absDy > 20) {
        clearTimeout(longPressTimer);
      }

      if (isSwiping) {
        if (singleFingerIntent === "idle") {
          if (absDy > 20 && absDy > absDx) {
            singleFingerIntent = "vertical";
            isSwiping = false;
            return;
          } else if (absDx > 20 && absDx > absDy) {
            singleFingerIntent = "horizontal";
          }
        }

        if (singleFingerIntent === "horizontal") {
          if (e.cancelable) e.preventDefault();
          if (!singleFingerPaged && absDx > 20) {
            props.onPageChange?.(dx > 0 ? -1 : 1);
            singleFingerPaged = true;
          }
        }
      }
    }

    if (!isSwiping) return;

    /* ---------- TWO FINGERS ----------------------------------- */
    if (pointers.size === 2) {
      if (e.cancelable) e.preventDefault(); // stop UA scrolling / zoom

      // Frame pacing for continuous 2-finger updates
      if (!isTicking) {
        requestAnimationFrame(() => {
          let p1, p2;
          let idx = 0;
          for (const p of pointers.values()) {
            if (idx === 0) p1 = p;
            else p2 = p;
            idx++;
          }
          if (!p1 || !p2) {
            isTicking = false;
            return;
          }

          const midX = (p1.x + p2.x) / 2;
          const dist = distance(p1, p2);

          // 1) first move with 2 fingers ⇒ set anchors
          if (anchorDist === undefined) {
            anchorX = midX;
            anchorDist = dist;
            isTicking = false;
            return;
          }

          const dx = midX - anchorX;
          const distDelta = dist - anchorDist;

          // 2) decide intent once per gesture
          if (twoFingerMode === "idle") {
            if (Math.abs(distDelta) > 30) twoFingerMode = "zoom";
            else if (Math.abs(dx) > 10) twoFingerMode = "paging";
            else {
              isTicking = false;
              return;
            }
          }

          /* ---- ZOOM MODE ---- */
          if (twoFingerMode === "zoom") {
            if (Math.abs(distDelta) > 30) {
              props.onFontResize?.(distDelta > 0 ? 1 : -1);
              anchorDist = dist; // incremental zoom
            }
          } else if (twoFingerMode === "paging") {
            /* ---- PAGING MODE ---- */
            const PAGE = 20; // px mapped to one page
            const pages = Math.floor(Math.abs(dx) / PAGE);
            if (pages > 0) {
              const dir = dx > 0 ? -1 : 1;
              for (let i = 0; i < pages; i++) props.onPageChange?.(dir);
              anchorX += dir === -1 ? pages * PAGE : -pages * PAGE;
            }
          }
          isTicking = false;
        });
        isTicking = true;
      }
      return;
    }

    /* ---------- SINGLE FINGER -------------------------------- */
    if (pointers.size === 1) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      // 1) Lock Intent early to prevent diagonal drift from cancelling the gesture
      if (singleFingerIntent === "idle") {
        if (absDy > 20 && absDy > absDx) {
          singleFingerIntent = "vertical";
          isSwiping = false; // vertical scroll cancels swipe
          return;
        } else if (absDx > 10 && absDx > absDy) {
          singleFingerIntent = "horizontal";
        }
      }

      if (singleFingerIntent === "horizontal") {
        if (e.cancelable) e.preventDefault();

        if (!singleFingerPaged && absDx > 10) {
          props.onPageChange?.(dx > 0 ? -1 : 1);
          singleFingerPaged = true;
        }
      }
    }
  }

  function onPointerUp(e) {
    pointers.delete(e.pointerId);
    // NEW: Finger lifted, cancel the long press
    clearTimeout(longPressTimer);

    if (pointers.size === 0) {
      isSwiping = false;
      singleFingerIntent = "idle";
      twoFingerMode = "idle";
      anchorX = undefined;
      anchorDist = undefined;
    }
  }

  /* ---------- Solid lifecycle --------------------------------- */
  onMount(() => {
    const el = props.splitPanes;
    if (!el) return;

    el.classList.add("swipe-pager");

    el.addEventListener("pointerdown", onPointerDown, { passive: false });
    el.addEventListener("pointermove", onPointerMove, { passive: false });
    el.addEventListener("pointerup", onPointerUp, { passive: true });
    el.addEventListener("pointercancel", onPointerUp, { passive: true });

    onCleanup(() => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
      el.classList.remove("swipe-pager");
    });
  });

  return (
    <>
      <style>{`
        /* Global CSS Important*/        
        .swipe-pager {
          touch-action: pan-y;
        }
      `}</style>
    </>
  );
}
