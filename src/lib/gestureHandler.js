// src/lib/gestureHandler.js

export function createGesture(handlers) {
  let pointers = new Map();
  let maxPointers = 0; // Tracks if 2 fingers were used during the interaction
  let startY = 0;
  let longPressTimer = null;
  let lastTapTime = 0;
  let actionTriggered = false; // Prevents multiple actions from firing in one interaction

  const onPointerDown = (e) => {
    pointers.set(e.pointerId, e.clientY);
    maxPointers = Math.max(maxPointers, pointers.size);

    // Only start tracking primary interactions when the first finger/click lands
    if (pointers.size === 1) {
      actionTriggered = false;
      startY = e.clientY;

      // Start long press timer (500ms threshold)
      longPressTimer = setTimeout(() => {
        if (!actionTriggered && maxPointers === 1) {
          actionTriggered = true;
          handlers.onLongPress && handlers.onLongPress(e);
        }
      }, 500);
    } else {
      // If a second finger lands, it's definitely not a simple long press
      clearTimeout(longPressTimer);
    }
  };

  const onPointerUp = (e) => {
    clearTimeout(longPressTimer);

    if (!actionTriggered && pointers.has(e.pointerId)) {
      const dy = e.clientY - startY;

      // Check for Swipe (40px threshold)
      if (Math.abs(dy) > 40) {
        actionTriggered = true;
        if (dy < 0) {
          // Negative dy = Swipe UP
          if (maxPointers === 1) handlers.onSwipe1Up && handlers.onSwipe1Up();
          if (maxPointers === 2) handlers.onSwipe2Up && handlers.onSwipe2Up();
        } else {
          // Positive dy = Swipe DOWN
          if (maxPointers === 1) handlers.onSwipe1Down && handlers.onSwipe1Down();
          if (maxPointers === 2) handlers.onSwipe2Down && handlers.onSwipe2Down();
        }
      }
      // Check for tap / double click (allow a small 10px wiggle room)
      else if (Math.abs(dy) <= 10 && maxPointers === 1) {
        const now = Date.now();
        if (now - lastTapTime < 300) {
          // 300ms double click threshold
          actionTriggered = true;
          handlers.onDblClick && handlers.onDblClick();
          lastTapTime = 0; // Reset
        } else {
          lastTapTime = now;
        }
      }
    }

    // Clean up the removed pointer
    pointers.delete(e.pointerId);
    if (pointers.size === 0) {
      maxPointers = 0; // Reset cycle once all fingers are off the screen
    }
  };

  const onPointerCancel = (e) => {
    clearTimeout(longPressTimer);
    pointers.delete(e.pointerId);
    if (pointers.size === 0) maxPointers = 0;
  };

  // Return the event listeners to bind to the JSX element
  return {
    onPointerDown,
    onPointerUp,
    onPointerCancel,
    onPointerLeave: onPointerCancel,
  };
}
