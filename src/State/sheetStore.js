// sheetStore.jsx
import { createSignal, createEffect } from "solid-js";

// --- DYNAMIC REGISTRY ---
export const sheetRegistry = new Map();

export const registerSheet = (id, type, rawSteps) => {
  if (!id) return;
  // Extract just the base names (e.g., ["Min", "Mid", "Max"])
  const baseSteps = rawSteps.map((step) => step.split(":")[0]);
  sheetRegistry.set(id, { type, baseSteps });
};

const FALLBACK_STEPS = {
  Min: "Min:20%",
  Mid: "Mid:50%",
  Max: "Max:90%",
};

/**
 * @signal activeSheet
 * @description Stores the ID (string) of the currently visible sheet.
 * If no sheet is open, this is `null`.
 * @example
 * if (activeSheet() === "searchSheet") { ... }
 */
export const [activeSheet, setActiveSheet] = createSignal(null);

/**
 * @signal sheetStep
 * @description Stores the current size/step of the active sheet.
 * Can be a standard step ("Min", "Mid", "Max", "Hid") or a custom step ("Min:120px").
 * @example
 * console.log(sheetStep()); // Outputs: "Mid" or "Max:100vh"
 */
export const [sheetStep, setSheetStep] = createSignal("Hid");

/**
 * @function toggleSheet
 * @description The primary method to open, change, or close a sheet.
 * @param {string} id - The unique name of the sheet (e.g., "strlook", "search").
 * @param {string} [step="Mid"] - The target size (e.g., "Max", "Min:120px", "Hid").
 * @param {boolean} [shouldToggle=false] - If true, clicking a button for an already-open sheet will close it.
 * * @example
 * * // Open "strlook" to 120px
 * toggleSheet("strlook", "Min:120px");
 * * // Toggle the search sheet (closes it if it's already at "Mid")
 * toggleSheet("search", "Mid", true);
 */
export const toggleSheet = (id, step = "Mid", shouldToggle = false) => {
  const currentId = activeSheet();
  const currentStep = sheetStep();

  if (shouldToggle && currentId === id && currentStep === step) {
    setSheetStep("Hid");
    setActiveSheet(null);
    return;
  }

  let finalStep = step;

  if (step !== "Hid") {
    const baseStep = step.split(":")[0];
    const sheetConfig = sheetRegistry.get(id);

    if (sheetConfig) {
      // If the sheet doesn't natively support the requested step, force the fallback
      if (!sheetConfig.baseSteps.includes(baseStep)) {
        finalStep = FALLBACK_STEPS[baseStep] || step;
        // console.log(`Fallback: ${id} (${sheetConfig.type}) doesn't support ${baseStep}. Defaulting to ${finalStep}`);
      }
    } else {
      // Safety net if toggle is called before the component mounts
      if (!step.includes(":")) finalStep = FALLBACK_STEPS[baseStep] || step;
    }
  }

  setActiveSheet(finalStep === "Hid" ? null : id);
  setSheetStep(finalStep);
};

/**
 * @function getBaseStep
 * @description Strips custom CSS values from the current step to allow safe logical comparisons.
 * Extracts the string before the colon.
 * @returns {string} The logical step ("Min", "Mid", "Max", "Hid").
 * * @example
 * * // If sheetStep() is "Min:120px"
 * getBaseStep() === "Min" // true
 * getBaseStep() === "Min:120px" // false OR use sheetStep() === "Min:120px" true
 */
export const getBaseStep = () => {
  const step = sheetStep();
  if (!step) return "Hid";
  return step.split(":")[0];
};

/**
 * @function sheetProps
 * @description Generates the reactive props needed to bind a specific sheet UI to the global store.
 * Spread this directly onto your Sheet component.
 * @param {string} id - The unique ID assigned to this specific sheet component.
 * * @example
 * <TopSheet {...sheetProps("strlook")} steps={["Min:320px", "Mid:50vh", "Max:90%"]}>
 * <MyContent />
 * </TopSheet>
 */
export const sheetProps = (id) => ({
  id, // <--- Passes the ID directly to the sheet component
  get sheetState() {
    return activeSheet() === id ? sheetStep() : "Hid";
  },
  setSheetState: (newStep) => {
    toggleSheet(id, newStep, false);
  },
});

/**
 * @function currentSheet
 * @description Safely checks the exact status of a specific sheet without triggering reactive updates elsewhere.
 * @param {string} id - The ID of the sheet to check.
 * @returns {string} The step it is currently at, or "Hid" if closed/inactive.
 * * @example
 * const searchStatus = currentSheet("search");
 * if (searchStatus !== "Hid") { ... }
 */
export const currentSheet = (id) => {
  return activeSheet() === id ? sheetStep() : "Hid";
};

/**
 * @function closeAllSheets
 * @description A global kill-switch to immediately hide whatever sheet is currently open.
 * Useful for route changes or pressing the physical 'Escape' key.
 * * @example
 * document.addEventListener('keydown', (e) => {
 * if (e.key === "Escape") closeAllSheets();
 * });
 */
export const closeAllSheets = () => {
  setActiveSheet(null);
  setSheetStep("Hid");
};

/**
 * @function onSheetClose
 * @description A specialized lifecycle hook that fires a callback ONLY when a specific sheet finishes closing.
 * Perfect for cleaning up UI (like blurring inputs) after the sheet's CSS slide-down animation finishes.
 * @param {string} id - The sheet ID to watch.
 * @param {function} callback - The logic to execute when the sheet closes.
 * @param {number} [delay=300] - Matches your CSS transition time so the callback runs AFTER the animation.
 * * @example
 * onSheetClose("search", () => {
 * searchInputRef.blur();
 * resetSearchData();
 * }, 300);
 */
export function onSheetClose(id, callback, delay = 300) {
  let wasOpen = false;

  createEffect(() => {
    // Check if the specific sheet is active and NOT hidden
    const isOpen = activeSheet() === id && sheetStep() !== "Hid";

    if (wasOpen && !isOpen) {
      // Move the execution to the end of the transition/event loop
      if (delay > 0) {
        setTimeout(callback, delay);
      } else {
        // Fallback for immediate execution if delay is 0
        callback();
      }
    }

    wasOpen = isOpen;
  });
}
