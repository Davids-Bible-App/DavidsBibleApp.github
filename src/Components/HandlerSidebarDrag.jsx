/* HandlerSidebarDrag.jsx – 120fps direct-DOM mutation, no layout thrashing */
import { createSignal, createEffect, onCleanup, onMount } from "solid-js";
import { trigger, setTrigger } from "../State/globalSignals.js";

const allSpeed = 0.2;
const animTime = allSpeed;
const minAnim = allSpeed;
const minSwipeSpeedPx = 0.1;
const maxSwipeSpeedPx = 500000;
const animCurve = "ease-out";

export default function HandlerSidebarDrag(props) {
  /* ───── Pure JS State (Bypassing SolidJS during drag for max performance) ───── */
  let startX = 0;
  let isDragging = false;
  let cachedCw = 0; // Caches window width so we don't cause layout thrashing
  let translateMainX = 0;
  let lastMoveTime = 0;
  let lastMoveX = 0;
  let currentVelPxS = 0;

  /* ───── Signals for layout/logic only ───── */
  const [androidBarTop, setAndroidBarTop] = createSignal(0);
  const [androidBarBottom, setAndroidBarBottom] = createSignal(0);
  const [androidBarLeft, setAndroidBarLeft] = createSignal(0);
  const [androidBarRight, setAndroidBarRight] = createSignal(0);
  const [openSide, setOpenSide] = createSignal(null);
  const [activeSide, setActiveSide] = createSignal(null);

  /* dom refs */
  let mainEl, leftEl, rightEl;

  const globalDragConfig = {
    visualStartThreshold: 3,
    dragMarginTop: () => androidBarTop() + 50,
    dragMarginBottom: () => androidBarBottom() + 60,
  };

  const config = {
    left: {
      direction: 1,
      clickOpen: false,
      clickClose: true,
      threshold: 0.2,
      edgeSize: 40,
      mainContainerPct: 0.9,
      getEl: () => leftEl,
    },
    right: {
      direction: -1,
      clickOpen: false,
      clickClose: true,
      threshold: 0.2,
      edgeSize: 40,
      mainContainerPct: 0.9,
      getEl: () => rightEl,
    },
  };

  const getClientX = (e) =>
    typeof e.clientX === "number" ? e.clientX : (e.touches?.[0]?.clientX ?? e.changedTouches?.[0]?.clientX ?? 0);
  const getClientY = (e) =>
    typeof e.clientY === "number" ? e.clientY : (e.touches?.[0]?.clientY ?? e.changedTouches?.[0]?.clientY ?? 0);

  createEffect(() => {
    const i = props.insets?.();
    if (i && typeof i.adjustedInsetTop === "number") {
      setAndroidBarTop(i.adjustedInsetTop);
      setAndroidBarBottom(i.adjustedInsetBottom);
      setAndroidBarLeft(i.adjustedInsetLeft || 0);
      setAndroidBarRight(i.adjustedInsetRight || 0);
    }
  });

  /* ───── Direct DOM Mutation (The secret to native speed) ───── */
  function applyTransforms(mainX, transition = "none") {
    if (mainEl) {
      mainEl.style.transition = transition;
      mainEl.style.transform = `translate3d(${mainX}px, 0, 0)`;
    }

    // Binary Visibility: Hides the inactive sidebar instantly without math-heavy alpha blending
    if (leftEl) {
      const leftW =
        cachedCw > 0 ? cachedCw * config.left.mainContainerPct : window.innerWidth * config.left.mainContainerPct;
      leftEl.style.transition = transition;
      leftEl.style.transform = `translate3d(${-leftW / 3 + mainX / 3}px, 0, 0)`;

      if (mainX > 0) {
        // Dragging right, exposing Left SB
        // leftEl.style.opacity = "1";
        leftEl.style.zIndex = "0";
      } else if (mainX < 0) {
        // Dragging left, hide Left SB
        // leftEl.style.opacity = "0";
        leftEl.style.zIndex = "-1";
      }
    }

    if (rightEl) {
      const rightW =
        cachedCw > 0 ? cachedCw * config.right.mainContainerPct : window.innerWidth * config.right.mainContainerPct;
      rightEl.style.transition = transition;
      rightEl.style.transform = `translate3d(${rightW / 3 + mainX / 3}px, 0, 0)`;

      if (mainX < 0) {
        // Dragging left, exposing Right SB
        // rightEl.style.opacity = "1";
        rightEl.style.zIndex = "0";
      } else if (mainX > 0) {
        // Dragging right, hide Right SB
        // rightEl.style.opacity = "0";
        rightEl.style.zIndex = "-1";
      }
    }
  }

  onMount(() => {
    mainEl = props.mainContainer;
    leftEl = props.leftSB;
    rightEl = props.rightSB;
    if (!mainEl) return;

    const rect = props.rect();
    if (rect) cachedCw = rect.width;

    // Apply baseline styles so the browser promotes them to the GPU
    [mainEl, leftEl, rightEl].forEach((el) => {
      if (el) {
        // Add opacity to willChange
        el.style.willChange = "transform, opacity";
        el.style.backfaceVisibility = "hidden";

        // Force sidebars to be invisible on initial mount
        if (el !== mainEl) {
          // el.style.opacity = "0";
          el.style.zIndex = "-1";
        }
      }
    });

    applyTransforms(0);

    mainEl.style.touchAction = "none";

    /* mouse */
    mainEl.addEventListener("mousedown", handleDown, { passive: false });
    window.addEventListener("mousemove", handleMove, { passive: false });
    window.addEventListener("mouseup", handleUp, { passive: false });
    /* touch */
    mainEl.addEventListener("touchstart", handleDown, { passive: false });
    window.addEventListener("touchmove", handleMove, { passive: false });
    window.addEventListener("touchend", handleUp, { passive: false });
    window.addEventListener("touchcancel", handleUp, { passive: false });

    onCleanup(() => {
      mainEl.removeEventListener("mousedown", handleDown);
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      mainEl.removeEventListener("touchstart", handleDown);
      window.removeEventListener("touchmove", handleMove);
      window.removeEventListener("touchend", handleUp);
      window.removeEventListener("touchcancel", handleUp);
    });
  });

  /* ───── external trigger ───── */
  createEffect(() => {
    const trig = trigger && trigger();
    const rect = props.rect();
    if (!rect) return;

    cachedCw = rect.width; // Keep cache updated
    if (trig === "left") {
      if (leftEl) leftEl.style.zIndex = "0";
      openSidebar("left", rect.width);
    } else if (trig === "right") {
      if (rightEl) rightEl.style.zIndex = "0";
      openSidebar("right", rect.width);
    } else if (trig === "") {
      closeSidebar(rect.width);
    }
  });

  function handleDown(e) {
    if (props.touchActionRestored()) return;
    if (e.touches && e.touches.length > 1) return;

    const x = getClientX(e);
    const y = getClientY(e);

    // CACHE ONCE: Read layout here, never during handleMove
    const rect = props.rect();
    if (rect) cachedCw = rect.width;

    const winH = window.innerHeight;
    if (y < globalDragConfig.dragMarginTop() || y > winH - globalDragConfig.dragMarginBottom()) return;

    const insetL = androidBarLeft();
    const insetR = androidBarRight();

    const edges = {
      left: [translateMainX + insetL, translateMainX + insetL + config.left.edgeSize],
      right: [cachedCw + translateMainX - insetR - config.right.edgeSize, cachedCw + translateMainX - insetR],
    };

    let side = null;
    if (openSide()) {
      if (openSide() === "left" && x >= edges.left[0] && x <= edges.left[1]) side = "left";
      if (openSide() === "right" && x >= edges.right[0] && x <= edges.right[1]) side = "right";
    } else {
      if (x >= insetL && x <= insetL + config.left.edgeSize) side = "left";
      if (x >= cachedCw - insetR - config.right.edgeSize && x <= cachedCw - insetR) side = "right";
    }

    if (!side) return;
    if (e.cancelable) e.preventDefault();

    setActiveSide(side);
    const sb = config[side].getEl();
    if (sb) sb.style.zIndex = "0";

    startX = x;
    isDragging = true;
    lastMoveTime = performance.now();
    lastMoveX = x;
    currentVelPxS = 0;

    document.body.style.userSelect = "none";
  }

  function handleMove(e) {
    // If we aren't dragging, do absolutely nothing.
    if (!isDragging || props.touchActionRestored()) return;
    if (e.touches && e.touches.length > 1) return;
    if (e.cancelable) e.preventDefault();

    props.setIsDragging(true);

    const currentX = getClientX(e);
    const totalDx = currentX - startX;

    const now = performance.now();
    const dt = now - lastMoveTime;
    if (dt > 0) {
      currentVelPxS = ((currentX - lastMoveX) / dt) * 1000;
      lastMoveTime = now;
      lastMoveX = currentX;
    }

    const side = activeSide();
    if (side) {
      const threshold = globalDragConfig.visualStartThreshold;
      const effectiveDx = Math.abs(totalDx) > threshold ? totalDx - Math.sign(totalDx) * threshold : 0;

      const baseOffset =
        openSide() === "left"
          ? cachedCw * config.left.mainContainerPct
          : openSide() === "right"
            ? -cachedCw * config.right.mainContainerPct
            : 0;

      translateMainX = baseOffset + effectiveDx;

      translateMainX = Math.max(
        -cachedCw * config.right.mainContainerPct,
        Math.min(translateMainX, cachedCw * config.left.mainContainerPct),
      );

      // FASTEST UPDATE: Update inline styles directly. No rAF loop, no signal updates.
      applyTransforms(translateMainX, "none");
    }
  }

  function handleUp(e) {
    if (!isDragging) return;
    if (e.cancelable) e.preventDefault();

    const now = performance.now();
    if (now - lastMoveTime > 50) {
      currentVelPxS = 0;
    }

    const side = activeSide();
    const dx = getClientX(e) - startX;

    let shouldOpen = false;
    let shouldClose = false;

    if (side) {
      const { direction, threshold, clickOpen, clickClose, mainContainerPct } = config[side];
      const sidebarWidthPx = cachedCw * mainContainerPct;
      const threshPx = sidebarWidthPx * threshold;

      if (!openSide()) {
        if (Math.abs(dx) > threshPx && Math.sign(dx) === direction) shouldOpen = true;
        else if (clickOpen && Math.abs(dx) < 10) shouldOpen = true;
      } else if (openSide() === side) {
        if (Math.abs(dx) > threshPx * 0.5 && Math.sign(dx) !== direction) shouldClose = true;
        else if (clickClose && Math.abs(dx) < 10) shouldClose = true;
      }
    }

    const targetWidth = shouldOpen ? config[side].direction * cachedCw * config[side].mainContainerPct : 0;
    const remaining = Math.abs(targetWidth - translateMainX);
    const clampedSpeed = Math.max(minSwipeSpeedPx, Math.min(Math.abs(currentVelPxS), maxSwipeSpeedPx));

    let duration = remaining / clampedSpeed;
    duration = Math.max(minAnim, Math.min(animTime, duration));

    if (shouldOpen) openSidebar(side, cachedCw, duration);
    else if (shouldClose) closeSidebar(cachedCw, duration);
    else if (openSide()) openSidebar(openSide(), cachedCw, duration);
    else closeSidebar(cachedCw, duration);

    isDragging = false;
    setActiveSide(null);
    props.setIsDragging(false);
    document.body.style.userSelect = "";
  }

  function snapTo(targetX, durationSec) {
    translateMainX = targetX;
    const t = `transform ${durationSec}s ${animCurve}`;

    // We only use requestAnimationFrame here to ensure the browser registers
    // the CSS transition string before moving the element
    requestAnimationFrame(() => {
      applyTransforms(targetX, t);
    });
  }

  function openSidebar(side, cw, durationSec = animTime) {
    cachedCw = cw;
    const offset = config[side].direction * (cw * config[side].mainContainerPct);
    const sb = config[side].getEl();

    if (sb) {
      sb.style.zIndex = "0";
      sb.ontransitionend = null;
    }

    snapTo(offset, durationSec);
    setOpenSide(side);

    if (typeof setTrigger === "function" && trigger && trigger() !== side) {
      setTrigger(side);
    }
  }

  function closeSidebar(cw, durationSec = animTime) {
    cachedCw = cw;
    snapTo(0, durationSec);

    if (leftEl) {
      leftEl.ontransitionend = () => {
        if (openSide() !== "left") {
          leftEl.style.zIndex = "-1";
          // leftEl.style.opacity = "0"; // Clean up
        }
      };
    }
    if (rightEl) {
      rightEl.ontransitionend = () => {
        if (openSide() !== "right") {
          rightEl.style.zIndex = "-1";
          // rightEl.style.opacity = "0"; // Clean up
        }
      };
    }

    setOpenSide(null);
    if (typeof setTrigger === "function" && trigger && trigger() !== "") {
      setTrigger("");
    }
  }
}
