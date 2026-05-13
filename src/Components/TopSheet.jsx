import { createSignal, createMemo, createEffect } from "solid-js";
import { registerSheet } from "../State/sheetStore";
import { activePaper } from "../State/globalSignals.js";
import "./CSS/TopSheet.css";

function TopSheet(props) {
  // states: "Hid", "Min", "Mid", "Max"
  const [isDragging, setIsDragging] = createSignal(false);
  const [dragOffset, setDragOffset] = createSignal(0);
  let startY = 0;

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
      registerSheet(props.id, "top", config().rawSteps);
    }
  });

  const handlePointerDown = (e) => {
    startY = e.clientY;
    setIsDragging(true);
    e.target.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e) => {
    if (!isDragging()) return;
    setDragOffset(e.clientY - startY);
  };

  const handlePointerUp = (e) => {
    if (!isDragging()) return;
    setIsDragging(false);

    const threshold = 50;
    const { steps } = config();

    const currentIndex = steps.indexOf(activeState().name);

    if (currentIndex === -1) {
      if (dragOffset() > threshold) {
        // Dragged DOWN (Expand): Jump to the first declared open step (e.g., "Max")
        props.setSheetState(steps[1] || "Hid");
      } else if (dragOffset() < -threshold) {
        // Dragged UP (Shrink): Close the sheet
        props.setSheetState("Hid");
      }
    } else {
      if (dragOffset() > threshold) {
        if (currentIndex < steps.length - 1) props.setSheetState(steps[currentIndex + 1]);
      } else if (dragOffset() < -threshold) {
        if (currentIndex > 0) props.setSheetState(steps[currentIndex - 1]);
      }
    }

    setDragOffset(0);
    e.target.releasePointerCapture(e.pointerId);
  };

  const getSheetHeight = () => {
    const { name, overrideStr } = activeState();

    if (name === "Hid" && !isDragging()) return "0px";

    // Use override height if it exists, otherwise use config height
    const baseHeightStr = (overrideStr || config().heights[name]) ?? "0px";

    // Convert current drag pixel offset into a vh offset
    const offsetVh = isDragging() ? (dragOffset() / window.innerHeight) * 100 : 0;

    // The maximum possible height allowed by the OS
    const safeMax = `(100vh - var(--edge2edge-top, 0px) - var(--edge2edge-bottom, 0px))`;

    return `calc( min( ${baseHeightStr}, ${safeMax}) + ${offsetVh}vh )`;
  };

  return (
    <>
      <div
        // Use the parsed name here too
        class={`TopSheet-Overlay  ${["Hid", "Min"].includes(activeState().name) ? "hidden" : ""}`}
        onClick={() => props.setSheetState("Hid")}
      />

      <div
        class={`TopSheet-Container paper`}
        classList={{
          dragging: isDragging(),
          hidden: activeState().name === "Hid" && !isDragging(),
          paperOverlay: activePaper(),
        }}
        style={{ height: getSheetHeight() }}
      >
        <div class="TopSheet-Content">{props.children}</div>

        <div
          class="TopSheet-HandleArea"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onDblClick={() => props.setSheetState("Hid")}
          onDragStart={(e) => e.preventDefault()}
        >
          <div class="TopSheet-DragHandle"></div>
        </div>
      </div>
    </>
  );
}

export default TopSheet;
