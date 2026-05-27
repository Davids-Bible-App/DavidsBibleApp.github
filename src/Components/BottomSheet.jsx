import { createSignal, createMemo, createEffect } from "solid-js";
import { registerSheet } from "../State/sheetStore";
import { activePaper } from "../State/globalSignals.js";
import "./CSS/BottomSheet.css";

function BottomSheet(props) {
  // states: "Hid", "Min", "Mid", "Max"
  const [isDragging, setIsDragging] = createSignal(false);
  // const [dragOffset, setDragOffset] = createSignal(0);
  let startY = 0;
  let currentDragOffset = 0;
  let containerRef;

  // If store sends "Min", name is "Min", override is null
  // If store sends "Min:80px", name is "Min", override is "80px"
  const activeState = createMemo(() => {
    const [name, val] = props.sheetState.split(":");
    let overrideStr = null;

    if (val) {
      const hasUnit = /[a-zA-Z%]+$/.test(val);
      overrideStr = hasUnit ? val : `${val}vh`;
    }

    return { name, overrideStr };
  });

  const config = createMemo(() => {
    const rawSteps = props.steps || ["Max:100"];
    const steps = ["Hid"];
    const heights = { Hid: "0px" };

    rawSteps.forEach((stepStr) => {
      const [name, val] = stepStr.split(":");
      steps.push(name);

      // If the value already has letters (px, rem, vh), use it.
      // Otherwise, assume it's vh.
      const hasUnit = /[a-zA-Z%]+$/.test(val);
      heights[name] = hasUnit ? val : `${val}vh`;
    });

    return { steps, heights, rawSteps };
  });

  // --- AUTO REGISTRATION ---
  // Every time this sheet mounts or steps change, tell the global store
  createEffect(() => {
    if (props.id) {
      registerSheet(props.id, "bottom", config().rawSteps);
    }
  });

  const handlePointerDown = (e) => {
    startY = e.clientY;
    currentDragOffset = 0;
    setIsDragging(true);
    e.target.setPointerCapture(e.pointerId);
  };

  // Helper — computes the resting height for any named step
  const computeSnapHeight = (stepName) => {
    if (stepName === "Hid") return "0px";
    const heightStr = config().heights[stepName] ?? "0px";
    const safeMax = `(100vh - var(--edge2edge-top, 0px) - var(--edge2edge-bottom, 0px))`;
    return `calc(min(${heightStr}, ${safeMax}))`;
  };

  const handlePointerMove = (e) => {
    if (!isDragging()) return;
    currentDragOffset = e.clientY - startY;

    const { name, overrideStr } = activeState();
    const baseHeightStr = (overrideStr || config().heights[name]) ?? "0px";
    const offsetVh = (currentDragOffset / -window.innerHeight) * 100;
    const safeMax = `(100vh - var(--edge2edge-top, 0px) - var(--edge2edge-bottom, 0px))`;

    if (containerRef) {
      // Clamp between 0px and safeMax — prevents viewport overscroll on Android
      containerRef.style.height = `calc(
      min(
        max(0px, min(${baseHeightStr}, ${safeMax}) + ${offsetVh}vh),
        ${safeMax}
      )
    )`;
    }
  };

  const handlePointerUp = (e) => {
    if (!isDragging()) return;
    setIsDragging(false);

    const threshold = 50;
    const { steps } = config();
    const currentIndex = steps.indexOf(activeState().name);

    let nextStep = activeState().name; // logical step name
    let targetStateStr = props.sheetState; // Preserve full string (e.g., "Mid:50%") if no change

    if (currentIndex === -1) {
      if (currentDragOffset < -threshold) {
        nextStep = steps[1] || "Hid";
        targetStateStr = nextStep;
      } else if (currentDragOffset > threshold) {
        nextStep = "Hid";
        targetStateStr = nextStep;
      }
    } else {
      if (currentDragOffset < -threshold && currentIndex < steps.length - 1) {
        nextStep = steps[currentIndex + 1];
        targetStateStr = nextStep;
      } else if (currentDragOffset > threshold && currentIndex > 0) {
        nextStep = steps[currentIndex - 1];
        targetStateStr = nextStep;
      }
    }

    if (containerRef) {
      // ✅ If we didn't change steps, use getSheetHeight() to preserve fallback overrides
      if (nextStep === activeState().name) {
        containerRef.style.height = getSheetHeight();
      } else {
        containerRef.style.height = computeSnapHeight(nextStep);
      }
    }

    // ✅ Pass the preserved string back to the store
    props.setSheetState(targetStateStr);
    currentDragOffset = 0;
    e.target.releasePointerCapture(e.pointerId);
  };

  const getSheetHeight = () => {
    const { name, overrideStr } = activeState();
    if (name === "Hid") return "0px";
    const baseHeightStr = (overrideStr || config().heights[name]) ?? "0px";
    const safeMax = `(100vh - var(--edge2edge-top, 0px) - var(--edge2edge-bottom, 0px))`;
    return `calc(min(${baseHeightStr}, ${safeMax}))`;
  };

  return (
    <>
      <div class={`BottomSheet-Overlay ${["Hid", "Min"].includes(activeState().name) ? "hidden" : ""}`} onClick={() => props.setSheetState("Hid")} />

      <div ref={containerRef} class={`BottomSheet-Container paper`} classList={{ dragging: isDragging(), paperOverlay: activePaper() }} style={{ height: getSheetHeight() }}>
        <div class="BottomSheet-HandleArea" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp} onDblClick={() => props.setSheetState("Hid")} onDragStart={(e) => e.preventDefault()}>
          <div class="BottomSheet-DragHandle"></div>
        </div>

        <div class="BottomSheet-Content">{props.children}</div>
      </div>
    </>
  );
}

export default BottomSheet;
