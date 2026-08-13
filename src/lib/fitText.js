/**
 * fitText(container, options)
 *
 * Pixel-accurate font scaling using binary search. Given a container element
 * (and optionally a child text element inside it), it finds the largest
 * font-size in [minFontSize, maxFontSize] such that the text fits within the
 * container minus `padding` on all sides.
 *
 * Automatically re-fits when:
 *   - the container resizes (ResizeObserver)
 *   - the text content changes  (MutationObserver)
 *   - fonts finish loading (document.fonts.ready)
 *   - inner <img> finish loading
 *
 * Returns a cleanup function.
 *
 * @param {HTMLElement} container
 * @param {Object}   [options]
 * @param {HTMLElement} [options.textEl]      defaults to container.firstElementChild
 * @param {number}   [options.maxFontSize=34]
 * @param {number}   [options.minFontSize=10]
 * @param {number}   [options.padding=8]      inner padding on all sides
 * @param {number}   [options.precision=0.5]  binary-search stop threshold (px)
 * @param {'ellipsis'|'clip'|'none'} [options.overflow='clip']
 * @returns {() => void} cleanup
 */
export function fitText(container, options = {}) {
  if (!container) return () => {};

  const { textEl = container.firstElementChild || container, maxFontSize = 34, minFontSize = 10, padding = 8, precision = 0.5, overflow = "clip" } = options;

  if (!textEl) return () => {};

  // ---- prepare textEl so measurements are deterministic ----
  const prev = {
    boxSizing: textEl.style.boxSizing,
    padding: textEl.style.padding,
    width: textEl.style.width,
    height: textEl.style.height,
    overflow: textEl.style.overflow,
    textOverflow: textEl.style.textOverflow,
    wordBreak: textEl.style.wordBreak,
    lineHeight: textEl.style.lineHeight,
    display: textEl.style.display,
  };
  textEl.style.boxSizing = "border-box";
  textEl.style.padding = `${padding}px`;
  textEl.style.width = "100%";
  textEl.style.height = "100%";
  // if (!textEl.style.display) textEl.style.display = "block";

  textEl.style.wordBreak = textEl.style.wordBreak || "break-word";
  textEl.style.lineHeight = textEl.style.lineHeight || "1.25";
  if (overflow === "ellipsis") {
    textEl.style.overflow = "hidden";
    textEl.style.textOverflow = "ellipsis";
  } else if (overflow === "clip") {
    textEl.style.overflow = "hidden";
  }

  const fits = (cw, ch) => textEl.scrollWidth <= cw + 0.5 && textEl.scrollHeight <= ch + 0.5;

  const runFit = () => {
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (cw === 0 || ch === 0) return false;

    // Fast path: try max first.
    textEl.style.fontSize = `${maxFontSize}px`;
    if (fits(cw, ch)) return true;

    // Binary search in [lo, hi]. Converges in ~5-6 iterations.
    let lo = minFontSize;
    let hi = maxFontSize;
    let best = minFontSize;
    while (hi - lo > precision) {
      const mid = (lo + hi) / 2;
      textEl.style.fontSize = `${mid}px`;
      if (fits(cw, ch)) {
        best = mid;
        lo = mid;
      } else {
        hi = mid;
      }
    }
    textEl.style.fontSize = `${best}px`;
    return true;
  };

  // Retry on rAF until container has real dimensions (up to ~1s).
  let scheduled = false;
  let retries = 0;
  const MAX_RETRIES = 60;

  const measure = () => {
    scheduled = false;
    const ok = runFit();
    if (!ok && retries < MAX_RETRIES) {
      retries += 1;
      schedule();
    } else {
      retries = 0;
    }
  };

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(measure);
  };

  // ---- initial fit + observers ----
  schedule();

  const ro = new ResizeObserver(schedule);
  ro.observe(container);
  ro.observe(textEl);

  const mo = new MutationObserver(schedule);
  mo.observe(textEl, { childList: true, characterData: true, subtree: true });

  // Re-fit when web fonts finish loading (metrics change).
  if (document.fonts && typeof document.fonts.ready?.then === "function") {
    document.fonts.ready.then(schedule).catch(() => {});
  }

  // Re-fit when inner <img> finish loading (background image affects layout timing).
  const imgs = container.querySelectorAll("img");
  const onImgLoad = () => schedule();
  imgs.forEach((img) => {
    if (!img.complete) img.addEventListener("load", onImgLoad, { once: true });
  });

  // ---- cleanup ----
  return () => {
    ro.disconnect();
    mo.disconnect();
    imgs.forEach((img) => img.removeEventListener("load", onImgLoad));
    Object.assign(textEl.style, prev);
  };
}
