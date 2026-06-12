import { createSignal, createEffect, createMemo, onMount, onCleanup, untrack } from "solid-js";
import { setExpandedCtl, selection, setShowUniTopic, setShowUniCtrl } from "../State/globalSignals.js";
import { abbreviator, getBook } from "../lib/functions";
import "./CSS/UniVerse.css";
import { isFullscreen, toggleFullscreen, setFullscreen } from "../state/fullscreen.js";

const normalizeVerse = (v) => ({
  ed: v.ed || v.shortName || abbreviator(v.translation_id) || abbreviator(v.translation),
  bn: getBook(v.bk) || getBook(v.book_id) || v.Bname || v.book_name,
  tr: v.tr || v.translation || v.translation_id?.replace(/\.dba$/i, ""),
  bk: v.bk || v.book_id,
  ch: Number(v.ch || v.chapter || v.chapterNumber),
  vs: Number(v.vs || v.verse || v.verse_id || v.number),
  tx: v.tx || v.text,
});

const formatCitation = (v) => `${v.ed} ${v.bn} ${v.ch}:${v.vs}`;

export default function UniVerse(props) {
  const [currentIndex, setCurrentIndex] = createSignal(0);
  let textContainerRef;
  let textRef;
  let wasFullscreen = false;

  // Touch & Gesture Tracking
  let touchStartX = 0;
  let touchStartY = 0;
  let initialPinchDist = 0;
  let isPinching = false;

  const unifiedSelection = createMemo(() => {
    const src = selection()?.length ? selection() : props.uniTopic();
    return src.map(normalizeVerse);
  });

  const currentVerse = createMemo(() => unifiedSelection()[currentIndex()]);

  // Robust, Pixel-accurate Font Scaling Algorithm
  const adjustFontSize = () => {
    if (!textRef || !textContainerRef) return;

    // Read exact layout pixel dimensions of the container
    const containerWidth = textContainerRef.clientWidth;
    const containerHeight = textContainerRef.clientHeight;

    // Safety check if component is not yet fully laid out
    if (containerWidth === 0 || containerHeight === 0) return;
    // --- FINE TUNING VARS ---
    const absoluteMaxFontSize = 34;
    const minFontSize = 14;

    // Calculate initial size, but cap it at the absoluteMaxFontSize
    let currentSize = Math.min(Math.min(containerWidth, containerHeight) * 0.4, absoluteMaxFontSize);

    textRef.style.fontSize = `${currentSize}px`;

    // Step down font size until it fits perfectly within bounds
    while ((textRef.scrollHeight > containerHeight || textRef.scrollWidth > containerWidth) && currentSize > minFontSize) {
      currentSize -= 1;
      textRef.style.fontSize = `${currentSize}px`;
    }
  };

  createEffect(() => {
    currentVerse(); // Track dependency
    adjustFontSize(); // Trigger initial fit
  });

  onMount(() => {
    window.addEventListener("resize", adjustFontSize);
    adjustFontSize(); // Final fit on mount
    if (isFullscreen()) wasFullscreen = true;
    setFullscreen(true);
  });

  onCleanup(() => {
    window.removeEventListener("resize", adjustFontSize);
  });

  // Navigation handlers
  const nextVerse = () => {
    if (currentIndex() < unifiedSelection().length - 1) {
      setCurrentIndex(currentIndex() + 1);
    }
  };

  const prevVerse = () => {
    if (currentIndex() > 0) {
      setCurrentIndex(currentIndex() - 1);
    }
  };

  // Touch Event Handlers for Swipe and Pinch-to-Unzoom
  const handleTouchStart = (e) => {
    if (e.touches.length === 1) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      isPinching = false;
    } else if (e.touches.length === 2) {
      isPinching = true;
      initialPinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    }
  };

  const handleTouchMove = (e) => {
    if (isPinching && e.touches.length === 2) {
      const currentDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);

      // If pinched inwards below 70% of initial distance, close component
      if (currentDist / initialPinchDist < 0.7) {
        setShowUniCtrl(false);
        setShowUniTopic(false);
        // wasFullscreen === false &&
        setFullscreen(false);
      }
    }
  };

  const handleTouchEnd = (e) => {
    if (isPinching) return;

    // Use changedTouches for robust single touch end detection
    if (e.changedTouches && e.changedTouches.length > 0) {
      const touchEndX = e.changedTouches[0].clientX;
      const touchEndY = e.changedTouches[0].clientY;

      // Correcting SWIPE direction logic based on device orientation
      const isPortrait = window.innerHeight > window.innerWidth;

      if (isPortrait) {
        // Hardware axis flip:
        // Visual LEFT swipe (next) = Physical DOWN swipe (Y increases)
        // Visual RIGHT swipe (prev) = Physical UP swipe (Y decreases)
        const diffY = touchEndY - touchStartY;
        const swipeThreshold = 50; // slightly larger for Y swipe

        if (Math.abs(diffY) > swipeThreshold) {
          if (diffY > 0) {
            // Physical DOWN = Visual LEFT (prev)
            prevVerse();
          } else {
            // Physical UP = Visual RIGHT (next)
            nextVerse();
          }
        }
      } else {
        // Standard landscape
        // Standard horizontal axis behavior:
        // Visual LEFT swipe (next) = Physical LEFT swipe (X decreases)
        // Visual RIGHT swipe (prev) = Physical RIGHT swipe (X increases)
        const diffX = touchStartX - touchEndX;
        const swipeThreshold = 40; // pixel deadzone margin

        if (Math.abs(diffX) > swipeThreshold) {
          if (diffX > 0) {
            // Physical LEFT = Visual LEFT (next)
            nextVerse();
          } else {
            // Physical RIGHT = Visual RIGHT (prev)
            prevVerse();
          }
        }
      }
    }
  };

  return (
    <div class={`UniVerse-screen Shell-wrap ${isFullscreen() ? "is-fullscreen" : ""}`}>
      <div class="UniVerse-container" onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
        {/* Top Header Bar */}
        <header class="UniVerse-header">
          <span class="UniVerse-citation">{formatCitation(currentVerse())}</span>
          {/* &emsp;
          <button
            class="UniVerse-closeBtnc"
            onClick={() => {
              setShowUniTopic(false);
              setShowUniCtrl(false);
            }}
          >
            Exit UniVerse
          </button>
          &emsp;
          <button onClick={toggleFullscreen}>{isFullscreen() ? "Exit Fullscreen" : "Enter Fullscreen"}</button> */}
        </header>

        {/* Main Content Area */}
        <main class="UniVerse-main">
          <button class="UniVerse-navBtn" onClick={prevVerse} disabled={currentIndex() === 0}>
            ‹
          </button>

          <div class="UniVerse-textWrapper" ref={textContainerRef}>
            <p class="UniVerse-text" ref={textRef}>
              {currentVerse().tx}
            </p>
          </div>

          <button class="UniVerse-navBtn" onClick={nextVerse} disabled={currentIndex() === unifiedSelection().length - 1}>
            ›
          </button>
        </main>
      </div>
    </div>
  );
}
