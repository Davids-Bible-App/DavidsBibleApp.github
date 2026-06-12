import { createEffect, createSignal, createResource, onMount, onCleanup, Suspense, lazy } from "solid-js";
// prettier-ignore
import {
  bible1, expandedCtl, setExpandedCtl, setInjectedVerse, setSelectedTopic,
  selection, setSelection, showSelection, setShowSelection, setTrigger,
  setBibleVersion, setActiveNoteVerse, setTopicController, setTargetVerse,
  showUniCtrl, setShowUniCtrl
} from "../State/globalSignals.js";
import { openBookmarkModal, openTopicModal } from "../State/modalStore.js";
import { settings, triggerRefetch } from "../State/settingsStore.js";
import { groupConsecutiveVerses, dbExists, getBook } from "../lib/functions.js";
import { toggleSheet, closeAllSheets } from "../State/sheetStore";
import ToastStack, { showToast } from "./Toast";
import { updateAndLogScripture } from "../State/historyStore";
import { shareText } from "@choochmeque/tauri-plugin-sharekit-api";
import { type } from "@tauri-apps/plugin-os";
import { invoke } from "@tauri-apps/api/core";
import "./CSS/ControlBox.css";

const CompareVerse = lazy(() => import("./CompareVerse"));
const UniVerse = lazy(() => import("./UniVerse"));

export default function ControlBox(props) {
  const [selectedVerses, setSelectedVerses] = createSignal([]);
  const [strongsExists, setStrongsExists] = createSignal(false);

  // --- Pinch-zoom gesture (two-finger, touch only) ---
  let _pinchStartDist = null;
  let _pinchFired = false;

  const _getTouchDist = (touches) => {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const _onTouchStart = (e) => {
    if (e.touches.length === 2) {
      _pinchStartDist = _getTouchDist(e.touches);
      _pinchFired = false;
    }
  };

  const _onTouchMove = (e) => {
    if (e.touches.length !== 2 || _pinchStartDist === null || _pinchFired) return;

    const currentDist = _getTouchDist(e.touches);

    // Calculate raw difference without Math.abs()
    // Positive means expanding, negative means contracting
    const delta = currentDist - _pinchStartDist;

    // Only fire if they expanded outward by more than 55px
    if (delta > 55) {
      _pinchFired = true;
      uniVerse();
    }
  };

  const _onTouchEnd = () => {
    _pinchStartDist = null;
    _pinchFired = false;
  };

  onMount(async () => {
    const result = await dbExists("strongs_kjv.db");
    setStrongsExists(result);
  });

  const clr = (n) => `var(--hlClr${n})`;
  const setColor = async (clrValue) => {
    const selectedVerses = document.querySelectorAll(".select verse");
    if (selectedVerses.length === 0) return;

    const first = selectedVerses[0].dataset;

    // Ensure the ID has the extension to match what Rust uses for ATTACH
    let transId = first.tr;
    if (!transId.endsWith(".dba")) {
      transId += ".dba";
    }

    const verseIds = Array.from(selectedVerses).map((el) => parseInt(el.dataset.vs));
    const dbColor = clrValue === "var(--hlNone)" ? "transparent" : clrValue;

    try {
      await invoke("toggle_highlight_batch", {
        trans: transId,
        book: first.bk,
        chap: parseInt(first.ch),
        verses: verseIds,
        color: dbColor,
      });

      // Immediate UI Feedback
      selectedVerses.forEach((el) => {
        // Verse only gets color if sideLights is FALSE
        el.setAttribute("data-clr", !settings.sideLights ? clrValue : "none");
        el.classList.remove("select");

        const parent = el.closest("list");
        if (parent) {
          // List only gets color if sideLights is TRUE
          parent.setAttribute("data-clr", settings.sideLights ? clrValue : "none");
        }
      });
    } catch (err) {
      console.error("Save failed:", err);
    } finally {
      triggerRefetch("refetchChapters", "refetchHighlights");
      setExpandedCtl(0);
    }
  };

  const [verseData, { refetch }] = createResource(async () => {
    const elements = document.querySelectorAll(".select verse");
    if (!elements || elements.length === 0) {
      return { selectedStr: [], selectedObj: [] };
    }

    // 1. Gather the raw metadata from the selected DOM elements
    const rawSelection = Array.from(elements).map((el) => ({
      ed: el.dataset.ed,
      tr: el.dataset.tr,
      bk: el.dataset.bk,
      ch: parseInt(el.dataset.ch),
      vs: parseInt(el.dataset.vs),
    }));

    // 2. Group by Book and Chapter (in case they select across chapters)
    const fetchGroups = {};
    rawSelection.forEach((v) => {
      const key = `${v.tr}_${v.bk}_${v.ch}`;
      if (!fetchGroups[key]) {
        fetchGroups[key] = { tr: v.tr, bk: v.bk, ch: v.ch, vsArray: [] };
      }
      fetchGroups[key].vsArray.push(v.vs);
    });

    try {
      // 3. Fetch clean text from Rust for all groups in parallel
      const fetchPromises = Object.values(fetchGroups).map((g) =>
        invoke("get_verses", {
          t: `${g.tr}.dba`,
          b: g.bk,
          c: g.ch,
          vs: g.vsArray,
        }),
      );

      // Resolve all promises and flatten the arrays into one big list of clean verses
      const results = await Promise.all(fetchPromises);
      const allCleanVerses = results.flat();

      const selectedStr = [];
      const selectedObj = [];

      // 4. Map the clean text back to your standard output format
      rawSelection.forEach((raw) => {
        // Find the matching clean verse from the Rust response
        // (Using the keys provided by your Rust backend in your previous screenshot)
        const cleanVerse = allCleanVerses.find((cv) => cv.number === raw.vs && cv.bookId === raw.bk && cv.chapterNumber === raw.ch);

        // Fallback to empty string if not found, rather than crashing
        const cleanText = cleanVerse ? cleanVerse.text : "";

        selectedStr.push(`(${raw.ed}) ${getBook(raw.bk)} ${raw.ch}:${raw.vs} ${cleanText}`);

        selectedObj.push({
          ed: raw.ed,
          tr: raw.tr,
          bk: raw.bk,
          ch: raw.ch,
          vs: raw.vs,
          tx: cleanText, // Now strictly clean!
        });
      });

      return { selectedStr, selectedObj };
    } catch (error) {
      console.error("Failed to fetch clean verses globally:", error);
      return { selectedStr: [], selectedObj: [] };
    }
  });

  const updateVerseSelection = async () => {
    const data = await refetch();

    if (data && data.selectedObj.length > 0) {
      setSelectedVerses(data.selectedStr);
      setSelection(data.selectedObj);
    }

    return data;
  };

  const addBookmark = async () => {
    // 1. Get the selection data
    const data = await updateVerseSelection();

    if (data?.selectedObj) openBookmarkModal(data.selectedObj);
    addToHistory(data);
    setExpandedCtl(0);
    setSelection([]);
  };

  const copyVerse = async () => {
    // 1. Get the selection data
    const data = await updateVerseSelection();

    if (data && data.selectedObj && data.selectedObj.length > 0) {
      const selected = data.selectedObj;

      // 3. Format the verses
      const formattedText = groupConsecutiveVerses(selected, true);

      // 4. Write to clipboard
      await navigator.clipboard.writeText(formattedText);

      // 5. Fire the side effects
      showToast(selectedVerses(), "none", 5000, true, true);
      addToHistory(data);
      setExpandedCtl(0);
      setSelection([]);
    }
  };

  const addToHistory = async (data) => {
    // console.log(`LOG[:179]: data: `, data);
    if (data) {
      updateAndLogScripture({
        translation_id: data.selectedObj[0].tr,
        book_id: data.selectedObj[0].bk,
        chapter: parseInt(data.selectedObj[0].ch),
        verse_id: parseInt(data.selectedObj[0].vs),
      });
    }
  };

  const strongsVerse = async () => {
    try {
      const data = await updateVerseSelection();
      if (data) {
        toggleSheet("strongs", "Mid");
        setExpandedCtl(0);
        setSelection([]);
        addToHistory(data);
      }
    } catch (error) {
      console.error("Selection failed", error);
    }
  };

  const compareVerse = async () => {
    try {
      const data = await updateVerseSelection();
      if (data) {
        setShowSelection(true);
        addToHistory(data);
      }
    } catch (error) {
      console.error("Selection failed", error);
    }
  };

  const uniVerse = async () => {
    try {
      const data = await updateVerseSelection();
      if (data) {
        setShowUniCtrl(true);
        addToHistory(data);
      }
    } catch (error) {
      console.error("Controlbox UniVerse", error);
    }
  };

  const topicAddVerse = async () => {
    // 1. Get the selection data
    const data = await updateVerseSelection();

    if (data?.selectedObj) openTopicModal(data.selectedObj);
    addToHistory(data);
    setExpandedCtl(0);
    setSelection([]);

    // if (data) {
    // setSelectedTopic(null);
    // setTrigger("right");
    // setTopicController(true);
    // addToHistory(data);
    // }
  };

  const verseAddNote = async () => {
    const data = await updateVerseSelection();
    if (data) {
      setBibleVersion(data.selectedObj[0].tr);
      setActiveNoteVerse(parseInt(data.selectedObj[0].vs));
      setTargetVerse(data.selectedObj[0].tx);
      addToHistory(data);
    }
  };

  const pictureAddVerse = async () => {
    const data = await updateVerseSelection();

    if (data) {
      const formatedText = groupConsecutiveVerses(selection(), true);
      setInjectedVerse(formatedText);

      toggleSheet("meme", "Max");
      setExpandedCtl(0);
      setSelection([]);
      addToHistory(data);
    }
  };

  const shareVerse = async () => {
    let shareData = {
      title: "A Title",
      text: "Some Text",
      url: "https://mylink.here.org",
    };

    const data = await updateVerseSelection();

    if (data && data.selectedObj && data.selectedObj.length > 0) {
      const selected = data.selectedObj;

      const formattedText = groupConsecutiveVerses(selected);

      if (type() === "windows") {
        try {
          await shareText(`Sharing with you:\n ${formattedText}`);
          addToHistory(data);
        } catch (err) {
          showToast(`Error: ${err}`, "error");
        } finally {
          setExpandedCtl(0);
          setSelection([]);
        }
      } else {
        try {
          await shareText(`Sharing with you all:\n ${formattedText}`);
          addToHistory(data);
        } catch (error) {
          showToast(`Android Sharing failed: ${error}`, "error", 4000);
        } finally {
          setExpandedCtl(0);
          setSelection([]);
        }
      }
    }
  };

  createEffect(() => {
    expandedCtl() && closeAllSheets();
    props.setTouchActionRestored(expandedCtl());
  });

  createEffect(() => {
    if (expandedCtl()) {
      document.addEventListener("touchstart", _onTouchStart, { passive: true });
      document.addEventListener("touchmove", _onTouchMove, { passive: true });
      document.addEventListener("touchend", _onTouchEnd, { passive: true });
    } else {
      document.removeEventListener("touchstart", _onTouchStart);
      document.removeEventListener("touchmove", _onTouchMove);
      document.removeEventListener("touchend", _onTouchEnd);
    }
  });

  onCleanup(() => {
    document.removeEventListener("touchstart", _onTouchStart);
    document.removeEventListener("touchmove", _onTouchMove);
    document.removeEventListener("touchend", _onTouchEnd);
  });

  return (
    <>
      <footer class="ControlBox-footer">
        <nav class="ControlBox-nav">
          <content class="ControlBox-content" style={expandedCtl() !== 0 ? "height: 8rem; " : "height: 0; "}>
            <div class="ControlBox-btn-row">
              <group class="ControlBox-group">
                <div class="ControlBox-scroller">
                  <div class="ControlBox-highlighters">
                    <button class="ControlBox-button" data-clr={"none"} onClick={() => setColor("var(--hlNone)")} />
                    <button class="ControlBox-button" data-clr={"var(--hlClr1)"} onClick={() => setColor(clr(1))} />
                    <button class="ControlBox-button" data-clr={"var(--hlClr2)"} onClick={() => setColor(clr(2))} />
                    <button class="ControlBox-button" data-clr={"var(--hlClr3)"} onClick={() => setColor(clr(3))} />
                    <button class="ControlBox-button" data-clr={"var(--hlClr4)"} onClick={() => setColor(clr(4))} />
                    <button class="ControlBox-button" data-clr={"var(--hlClr5)"} onClick={() => setColor(clr(5))} />
                    <button class="ControlBox-button" data-clr={"var(--hlClr6)"} onClick={() => setColor(clr(6))} />
                    <button class="ControlBox-button" data-clr={"var(--hlClr7)"} onClick={() => setColor(clr(7))} />
                    <button class="ControlBox-button" data-clr={"var(--hlClr8)"} onClick={() => setColor(clr(8))} />
                  </div>
                </div>
                <pre>Highlight Swatches</pre>
              </group>
            </div>
            <div class="ControlBox-btn-row">
              <Show when={strongsExists() && bible1() === "eng_kjv"}>
                <group class="ControlBox-group">
                  <button class="ControlBox-button" onClick={() => strongsVerse()}>
                    <svg width="30px" height="30px" viewBox="0 0 800 800" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <g transform="matrix(33.333333,0,0,33.333333,0,0)">
                        <path
                          d="M11.943,1.25L12.057,1.25C14.366,1.25 16.175,1.25 17.586,1.44C19.031,1.634 20.171,2.039 21.066,2.934C21.961,3.829 22.366,4.969 22.56,6.414C22.75,7.825 22.75,9.634 22.75,11.943L22.75,12.057C22.75,14.366 22.75,16.175 22.56,17.586C22.366,19.031 21.961,20.171 21.066,21.066C20.171,21.961 19.031,22.366 17.586,22.56C16.175,22.75 14.366,22.75 12.057,22.75L11.943,22.75C9.634,22.75 7.825,22.75 6.414,22.56C4.969,22.366 3.829,21.961 2.934,21.066C2.039,20.171 1.634,19.031 1.44,17.586C1.25,16.175 1.25,14.366 1.25,12.057L1.25,11.943C1.25,9.634 1.25,7.825 1.44,6.414C1.634,4.969 2.039,3.829 2.934,2.934C3.829,2.039 4.969,1.634 6.414,1.44C7.825,1.25 9.634,1.25 11.943,1.25ZM6.614,2.926C5.335,3.098 4.564,3.425 3.995,3.995C3.425,4.564 3.098,5.335 2.926,6.614C2.752,7.914 2.75,9.622 2.75,12C2.75,14.378 2.752,16.086 2.926,17.386C3.098,18.665 3.425,19.436 3.995,20.005C4.564,20.575 5.335,20.902 6.614,21.074C7.914,21.248 9.622,21.25 12,21.25C14.378,21.25 16.086,21.248 17.386,21.074C18.665,20.902 19.436,20.575 20.005,20.005C20.575,19.436 20.902,18.665 21.074,17.386C21.248,16.086 21.25,14.378 21.25,12C21.25,9.622 21.248,7.914 21.074,6.614C20.902,5.335 20.575,4.564 20.005,3.995C19.436,3.425 18.665,3.098 17.386,2.926C16.086,2.752 14.378,2.75 12,2.75C9.622,2.75 7.914,2.752 6.614,2.926Z"
                          fill="currentColor"
                        />
                      </g>
                      <g transform="matrix(3.1,0,0,3.0,-541.264857,-510.898152)">
                        <path
                          d="M354.015,211.323L354.015,271.6L349.26,271.6C347.718,260.033 344.955,250.822 340.97,243.968C336.986,237.113 331.31,231.673 323.941,227.646C316.573,223.619 308.947,221.605 301.064,221.605C292.154,221.605 284.785,224.326 278.959,229.766C273.132,235.207 270.219,241.398 270.219,248.338C270.219,253.65 272.061,258.491 275.746,262.861C281.058,269.287 293.696,277.855 313.66,288.565C329.939,297.305 341.056,304.009 347.011,308.679C352.966,313.348 357.55,318.853 360.763,325.194C363.976,331.534 365.582,338.175 365.582,345.115C365.582,358.31 360.463,369.684 350.224,379.237C339.985,388.791 326.812,393.568 310.704,393.568C305.648,393.568 300.893,393.182 296.438,392.411C293.781,391.982 288.276,390.419 279.923,387.72C271.569,385.021 266.278,383.671 264.05,383.671C261.908,383.671 260.216,384.314 258.973,385.599C257.731,386.884 256.81,389.54 256.21,393.568L251.455,393.568L251.455,333.805L256.21,333.805C258.438,346.314 261.437,355.675 265.207,361.887C268.977,368.099 274.739,373.261 282.493,377.374C290.247,381.486 298.751,383.543 308.005,383.543C318.715,383.543 327.176,380.715 333.388,375.06C339.6,369.405 342.705,362.722 342.705,355.011C342.705,350.727 341.527,346.4 339.171,342.03C336.815,337.66 333.152,333.591 328.183,329.821C324.841,327.25 315.716,321.788 300.807,313.434C285.899,305.08 275.296,298.418 268.998,293.449C262.701,288.479 257.924,282.996 254.668,276.998C251.412,271 249.784,264.403 249.784,257.206C249.784,244.696 254.582,233.922 264.179,224.882C273.775,215.843 285.984,211.323 300.807,211.323C310.061,211.323 319.871,213.594 330.239,218.135C335.037,220.277 338.421,221.348 340.392,221.348C342.62,221.348 344.441,220.684 345.854,219.356C347.268,218.028 348.403,215.35 349.26,211.323L354.015,211.323Z"
                          fill="currentColor"
                        />
                      </g>
                    </svg>
                  </button>
                  <pre>Strongs</pre>
                </group>
              </Show>
              <group class="ControlBox-group">
                <button class="ControlBox-button" onClick={() => compareVerse()}>
                  <svg width="30px" height="30px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path
                      fill-rule="evenodd"
                      clip-rule="evenodd"
                      d="M16.3939 2.02121L16.4604 2.03904C17.5598 2.33361 18.431 2.56704 19.1162 2.81458C19.8172 3.06779 20.3888 3.35744 20.8597 3.79847C21.5453 4.44068 22.0252 5.27179 22.2385 6.18671C22.385 6.81503 22.3501 7.45486 22.2189 8.18849C22.0906 8.90573 21.8572 9.77697 21.5626 10.8764L21.0271 12.8747C20.7326 13.974 20.4991 14.8452 20.2516 15.5305C19.9984 16.2314 19.7087 16.803 19.2677 17.2739C18.6459 17.9377 17.8471 18.4087 16.9665 18.6316C16.7093 19.2213 16.3336 19.7554 15.8597 20.1993C15.3888 20.6403 14.8172 20.9299 14.1162 21.1832C13.431 21.4307 12.5598 21.6641 11.4605 21.9587L11.394 21.9765C10.2946 22.2711 9.42337 22.5045 8.70613 22.6328C7.9725 22.764 7.33266 22.7989 6.70435 22.6524C5.78943 22.4391 4.95832 21.9592 4.31611 21.2736C3.87508 20.8027 3.58542 20.2311 3.33222 19.5302C3.08468 18.8449 2.85124 17.9737 2.55667 16.8743L2.02122 14.876C1.72664 13.7766 1.4932 12.9054 1.36495 12.1882C1.23376 11.4546 1.19881 10.8147 1.34531 10.1864C1.55864 9.27149 2.03849 8.44038 2.72417 7.79817C3.19505 7.35714 3.76664 7.06749 4.46758 6.81428C5.15283 6.56674 6.02404 6.3333 7.12341 6.03873L7.15665 6.02983C7.42112 5.95896 7.67134 5.89203 7.90825 5.82944C8.29986 4.43031 8.64448 3.44126 9.31611 2.72417C9.95831 2.03849 10.7894 1.55864 11.7043 1.34531C12.3327 1.19881 12.9725 1.23376 13.7061 1.36495C14.4233 1.49319 15.2945 1.72664 16.3939 2.02121ZM7.45502 7.5028C6.36214 7.79571 5.57905 8.00764 4.9772 8.22505C4.36778 8.4452 4.00995 8.64907 3.74955 8.89296C3.2804 9.33237 2.95209 9.90103 2.80613 10.527C2.72511 10.8745 2.72747 11.2863 2.84152 11.9242C2.95723 12.5712 3.17355 13.381 3.47902 14.521L3.99666 16.4529C4.30212 17.5929 4.51967 18.4023 4.74299 19.0205C4.96314 19.63 5.16701 19.9878 5.4109 20.2482C5.85031 20.7173 6.41897 21.0456 7.04496 21.1916C7.39242 21.2726 7.80425 21.2703 8.4421 21.1562C9.08915 21.0405 9.89893 20.8242 11.0389 20.5187C12.1789 20.2132 12.9884 19.9957 13.6066 19.7724C14.216 19.5522 14.5739 19.3484 14.8343 19.1045C14.9719 18.9756 15.0973 18.8357 15.2096 18.6865C15.0306 18.6612 14.8463 18.629 14.6557 18.5911C13.9839 18.4575 13.1769 18.2413 12.1808 17.9744L12.1234 17.959C11.024 17.6644 10.1528 17.431 9.46758 17.1835C8.76664 16.9302 8.19505 16.6406 7.72416 16.1996C7.03849 15.5574 6.55864 14.7262 6.34531 13.8113C6.19881 13.183 6.23376 12.5432 6.36494 11.8095C6.4932 11.0923 6.72664 10.2211 7.02122 9.12174L7.45502 7.5028ZM13.4421 2.84152C12.8042 2.72747 12.3924 2.72511 12.045 2.80613C11.419 2.95209 10.8503 3.2804 10.4109 3.74955C9.97479 4.21518 9.70642 4.93452 9.2397 6.64323C9.16384 6.92093 9.08365 7.22023 8.99665 7.54488L8.47902 9.47673C8.17355 10.6167 7.95723 11.4265 7.84152 12.0736C7.72747 12.7114 7.72511 13.1232 7.80613 13.4707C7.95209 14.0967 8.2804 14.6654 8.74955 15.1048C9.00995 15.3487 9.36778 15.5525 9.9772 15.7727C10.5954 15.996 11.4049 16.2136 12.5449 16.519C13.5703 16.7938 14.3303 16.997 14.9482 17.1199C15.5635 17.2422 15.981 17.2723 16.3232 17.23C16.3976 17.2209 16.4691 17.2082 16.5389 17.1919C17.1649 17.0459 17.7335 16.7176 18.1729 16.2485C18.4168 15.9881 18.6207 15.6303 18.8408 15.0208C19.0642 14.4026 19.2817 13.5932 19.5872 12.4532L20.1048 10.5213C20.4103 9.38129 20.6266 8.57151 20.7423 7.92446C20.8564 7.28661 20.8587 6.87479 20.7777 6.52733C20.6317 5.90133 20.3034 5.33267 19.8343 4.89327C19.5739 4.64937 19.216 4.4455 18.6066 4.22535C17.9884 4.00203 17.1789 3.78448 16.0389 3.47902C14.8989 3.17355 14.0892 2.95723 13.4421 2.84152ZM11.0524 9.80588C11.1596 9.40578 11.5709 9.16834 11.971 9.27555L16.8006 10.5696C17.2007 10.6768 17.4381 11.0881 17.3309 11.4882C17.2237 11.8883 16.8125 12.1257 16.4124 12.0185L11.5827 10.7244C11.1826 10.6172 10.9452 10.206 11.0524 9.80588ZM10.2755 12.7036C10.3828 12.3035 10.794 12.066 11.1941 12.1733L14.0919 12.9497C14.492 13.0569 14.7294 13.4682 14.6222 13.8683C14.515 14.2684 14.1038 14.5058 13.7037 14.3986L10.8059 13.6221C10.4058 13.5149 10.1683 13.1037 10.2755 12.7036Z"
                      fill="currentColor"
                    />
                  </svg>
                </button>
                <pre>Compare</pre>
              </group>
              <group class="ControlBox-group">
                <button class="ControlBox-button" onClick={() => copyVerse()}>
                  <svg width="30px" height="30px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path
                      fill-rule="evenodd"
                      clip-rule="evenodd"
                      d="M15 1.25H10.9436C9.10583 1.24998 7.65019 1.24997 6.51098 1.40314C5.33856 1.56076 4.38961 1.89288 3.64124 2.64124C2.89288 3.38961 2.56076 4.33856 2.40314 5.51098C2.24997 6.65019 2.24998 8.10582 2.25 9.94357V16C2.25 17.8722 3.62205 19.424 5.41551 19.7047C5.55348 20.4687 5.81753 21.1208 6.34835 21.6517C6.95027 22.2536 7.70814 22.5125 8.60825 22.6335C9.47522 22.75 10.5775 22.75 11.9451 22.75H15.0549C16.4225 22.75 17.5248 22.75 18.3918 22.6335C19.2919 22.5125 20.0497 22.2536 20.6517 21.6517C21.2536 21.0497 21.5125 20.2919 21.6335 19.3918C21.75 18.5248 21.75 17.4225 21.75 16.0549V10.9451C21.75 9.57754 21.75 8.47522 21.6335 7.60825C21.5125 6.70814 21.2536 5.95027 20.6517 5.34835C20.1208 4.81753 19.4687 4.55348 18.7047 4.41551C18.424 2.62205 16.8722 1.25 15 1.25ZM17.1293 4.27117C16.8265 3.38623 15.9876 2.75 15 2.75H11C9.09318 2.75 7.73851 2.75159 6.71085 2.88976C5.70476 3.02502 5.12511 3.27869 4.7019 3.7019C4.27869 4.12511 4.02502 4.70476 3.88976 5.71085C3.75159 6.73851 3.75 8.09318 3.75 10V16C3.75 16.9876 4.38624 17.8265 5.27117 18.1293C5.24998 17.5194 5.24999 16.8297 5.25 16.0549V10.9451C5.24998 9.57754 5.24996 8.47522 5.36652 7.60825C5.48754 6.70814 5.74643 5.95027 6.34835 5.34835C6.95027 4.74643 7.70814 4.48754 8.60825 4.36652C9.47522 4.24996 10.5775 4.24998 11.9451 4.25H15.0549C15.8297 4.24999 16.5194 4.24998 17.1293 4.27117ZM7.40901 6.40901C7.68577 6.13225 8.07435 5.9518 8.80812 5.85315C9.56347 5.75159 10.5646 5.75 12 5.75H15C16.4354 5.75 17.4365 5.75159 18.1919 5.85315C18.9257 5.9518 19.3142 6.13225 19.591 6.40901C19.8678 6.68577 20.0482 7.07435 20.1469 7.80812C20.2484 8.56347 20.25 9.56458 20.25 11V16C20.25 17.4354 20.2484 18.4365 20.1469 19.1919C20.0482 19.9257 19.8678 20.3142 19.591 20.591C19.3142 20.8678 18.9257 21.0482 18.1919 21.1469C17.4365 21.2484 16.4354 21.25 15 21.25H12C10.5646 21.25 9.56347 21.2484 8.80812 21.1469C8.07435 21.0482 7.68577 20.8678 7.40901 20.591C7.13225 20.3142 6.9518 19.9257 6.85315 19.1919C6.75159 18.4365 6.75 17.4354 6.75 16V11C6.75 9.56458 6.75159 8.56347 6.85315 7.80812C6.9518 7.07435 7.13225 6.68577 7.40901 6.40901Z"
                      fill="currentColor"
                    />
                  </svg>
                </button>
                <pre>Copy</pre>
              </group>
              <group class="ControlBox-group">
                <button class="ControlBox-button" onClick={() => addBookmark()}>
                  <svg width="30px" height="30px" viewBox="0 0 800 800" version="1.1" xml:space="preserve" style="fill-rule:evenodd;clip-rule:evenodd;stroke-linejoin:round;stroke-miterlimit:2;" id="svg3" xmlns="http://www.w3.org/2000/svg" xmlns:svg="http://www.w3.org/2000/svg">
                    <defs id="defs3" />
                    <g transform="matrix(33.333333,0,0,33.333333,0,0)" id="g1">
                      <path
                        d="M11.943,1.25C9.634,1.25 7.825,1.25 6.414,1.44C4.969,1.634 3.829,2.039 2.934,2.934C2.039,3.829 1.634,4.969 1.44,6.414C1.25,7.825 1.25,9.634 1.25,11.943L1.25,12.057C1.25,14.366 1.25,16.175 1.44,17.586C1.634,19.031 2.039,20.171 2.934,21.066C3.829,21.961 4.969,22.366 6.414,22.56C7.825,22.75 9.634,22.75 11.943,22.75L12.057,22.75C14.366,22.75 16.175,22.75 17.586,22.56C19.031,22.366 20.171,21.961 21.066,21.066C21.961,20.171 22.366,19.031 22.56,17.586C22.75,16.175 22.75,14.366 22.75,12.057L22.75,10.5C22.75,10.086 22.414,9.75 22,9.75C21.586,9.75 21.25,10.086 21.25,10.5L21.25,12C21.25,14.378 21.248,16.086 21.074,17.386C20.902,18.665 20.575,19.436 20.005,20.005C19.436,20.575 18.665,20.902 17.386,21.074C16.086,21.248 14.378,21.25 12,21.25C9.622,21.25 7.914,21.248 6.614,21.074C5.335,20.902 4.564,20.575 3.995,20.005C3.425,19.436 3.098,18.665 2.926,17.386C2.752,16.086 2.75,14.378 2.75,12C2.75,9.622 2.752,7.914 2.926,6.614C3.098,5.335 3.425,4.564 3.995,3.995C4.564,3.425 5.335,3.098 6.614,2.926C7.914,2.752 9.622,2.75 12,2.75L13.5,2.75C13.914,2.75 14.25,2.414 14.25,2C14.25,1.586 13.914,1.25 13.5,1.25L11.943,1.25Z"
                        fill="currentColor"
                        id="path1"
                      />
                    </g>

                    <g transform="matrix(1,0,0,1,266.666667,-133.333338)" id="g3">
                      <path d="M400,175C413.807,175 425,186.193 425,200L425,241.667L466.667,241.667C480.473,241.667 491.667,252.86 491.667,266.667C491.667,280.474 480.473,291.667 466.667,291.667L425,291.667L425,333.333C425,347.14 413.807,358.333 400,358.333C386.193,358.333 375,347.14 375,333.333L375,291.667L333.332,291.667C319.525,291.667 308.332,280.474 308.332,266.667C308.332,252.86 319.525,241.667 333.332,241.667L375,241.667L375,200C375,186.193 386.193,175 400,175Z" fill="currentColor" id="path3" />
                    </g>
                    <path
                      fill-rule="evenodd"
                      clip-rule="evenodd"
                      d="m 558.33334,369.10708 c 0,-46.975 -22.67668,-84.88733 -60.53335,-98.821 -31.32333,-11.53033 -66.68666,-4.29867 -97.8,18.85933 -31.11333,-23.158 -66.47666,-30.38966 -97.8,-18.85933 -37.85665,13.934 -60.53332,51.84633 -60.53332,98.82133 0,26.238 11.92334,50.58833 26.19666,70.72567 14.51,20.47266 33.29334,39.17 51.08667,54.62866 l 2.82667,2.46067 C 345.71,517.76108 365.64334,535.11374 400,535.11374 c 34.35667,0 54.29,-17.35233 78.22334,-38.191 l 2.82666,-2.46066 c 17.79667,-15.45867 36.57666,-34.156 51.08666,-54.62867 14.27333,-20.13767 26.19668,-44.488 26.19668,-70.72633 z m -77.80335,-51.89867 c -14.20666,-5.22966 -37.64,-2.687 -62.80666,22.61167 -4.69,4.71733 -11.07,7.36967 -17.72334,7.36967 -6.65333,0 -13.03333,-2.65234 -17.72333,-7.36967 -25.16667,-25.29867 -48.6,-27.84133 -62.80667,-22.61167 -13.81332,5.08367 -27.80332,20.79 -27.80332,51.899 0,11.366 5.42,25.49167 16.99,41.81167 11.33,15.98466 26.88667,31.72633 43.08333,45.79733 27.76334,24.11967 34.13333,28.39867 48.26,28.39867 14.12999,0 20.49666,-4.279 48.25999,-28.39834 16.19667,-14.071 31.75334,-29.81233 43.08335,-45.797 11.57,-16.32 16.99,-30.446 16.99,-41.81266 0,-31.109 -13.99,-46.815 -27.80335,-51.89867 z"
                      fill="currentColor"
                      id="path2"
                      style="stroke-width:33.3333"
                    />
                  </svg>
                </button>
                <pre>Bookmark</pre>
              </group>
              <group class="ControlBox-group">
                <button class="ControlBox-button" onClick={() => topicAddVerse()}>
                  <svg width="30px" height="30px" viewBox="0 0 800 800" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" xmlns:serif="http://www.serif.com/" style="fill-rule:evenodd;clip-rule:evenodd;stroke-linejoin:round;stroke-miterlimit:2;">
                    <g transform="matrix(33.333333,0,0,33.333333,0,0)">
                      <path
                        d="M11.943,1.25C9.634,1.25 7.825,1.25 6.414,1.44C4.969,1.634 3.829,2.039 2.934,2.934C2.039,3.829 1.634,4.969 1.44,6.414C1.25,7.825 1.25,9.634 1.25,11.943L1.25,12.057C1.25,14.366 1.25,16.175 1.44,17.586C1.634,19.031 2.039,20.171 2.934,21.066C3.829,21.961 4.969,22.366 6.414,22.56C7.825,22.75 9.634,22.75 11.943,22.75L12.057,22.75C14.366,22.75 16.175,22.75 17.586,22.56C19.031,22.366 20.171,21.961 21.066,21.066C21.961,20.171 22.366,19.031 22.56,17.586C22.75,16.175 22.75,14.366 22.75,12.057L22.75,10.5C22.75,10.086 22.414,9.75 22,9.75C21.586,9.75 21.25,10.086 21.25,10.5L21.25,12C21.25,14.378 21.248,16.086 21.074,17.386C20.902,18.665 20.575,19.436 20.005,20.005C19.436,20.575 18.665,20.902 17.386,21.074C16.086,21.248 14.378,21.25 12,21.25C9.622,21.25 7.914,21.248 6.614,21.074C5.335,20.902 4.564,20.575 3.995,20.005C3.425,19.436 3.098,18.665 2.926,17.386C2.752,16.086 2.75,14.378 2.75,12C2.75,9.622 2.752,7.914 2.926,6.614C3.098,5.335 3.425,4.564 3.995,3.995C4.564,3.425 5.335,3.098 6.614,2.926C7.914,2.752 9.622,2.75 12,2.75L13.5,2.75C13.914,2.75 14.25,2.414 14.25,2C14.25,1.586 13.914,1.25 13.5,1.25L11.943,1.25Z"
                        fill="currentColor"
                      />
                    </g>
                    <g transform="matrix(33.333333,0,0,33.333333,0,0)">
                      <path
                        d="M9.952,6.25C9.522,6.25 9.12,6.25 8.792,6.299C8.421,6.354 8.04,6.485 7.735,6.824C7.441,7.151 7.337,7.541 7.292,7.913C7.25,8.261 7.25,8.692 7.25,9.18L7.25,9.75C7.25,10.164 7.586,10.5 8,10.5C8.414,10.5 8.75,10.164 8.75,9.75L8.75,9.222C8.75,8.679 8.751,8.34 8.781,8.093C8.795,7.977 8.813,7.91 8.827,7.872C8.839,7.84 8.847,7.83 8.85,7.827L8.851,7.826C8.852,7.825 8.853,7.824 8.862,7.819C8.879,7.812 8.922,7.796 9.014,7.782C9.218,7.752 9.505,7.75 10,7.75L11.25,7.75L11.25,16.25L9.5,16.25C9.086,16.25 8.75,16.586 8.75,17C8.75,17.414 9.086,17.75 9.5,17.75L15,17.75C15.414,17.75 15.75,17.414 15.75,17C15.75,16.586 15.414,16.25 15,16.25L12.75,16.25L12.75,7.75L14,7.75C14.495,7.75 14.782,7.752 14.986,7.782C15.078,7.796 15.121,7.812 15.138,7.819C15.147,7.824 15.148,7.825 15.149,7.826L15.15,7.827C15.152,7.83 15.161,7.84 15.173,7.872C15.187,7.91 15.205,7.977 15.219,8.093C15.249,8.34 15.25,8.679 15.25,9.222L15.25,9.75C15.25,10.164 15.586,10.5 16,10.5C16.414,10.5 16.75,10.164 16.75,9.75L16.75,9.18C16.75,8.692 16.75,8.261 16.708,7.913C16.663,7.541 16.559,7.151 16.265,6.824C15.96,6.485 15.579,6.354 15.208,6.299C14.88,6.25 14.478,6.25 14.048,6.25L9.952,6.25Z"
                        fill="currentColor"
                      />
                    </g>
                    <g transform="matrix(1,0,0,1,266.666667,-133.333338)">
                      <path d="M400,175C413.807,175 425,186.193 425,200L425,241.667L466.667,241.667C480.473,241.667 491.667,252.86 491.667,266.667C491.667,280.474 480.473,291.667 466.667,291.667L425,291.667L425,333.333C425,347.14 413.807,358.333 400,358.333C386.193,358.333 375,347.14 375,333.333L375,291.667L333.332,291.667C319.525,291.667 308.332,280.474 308.332,266.667C308.332,252.86 319.525,241.667 333.332,241.667L375,241.667L375,200C375,186.193 386.193,175 400,175Z" fill="currentColor" />
                    </g>
                  </svg>
                </button>
                <pre>Topic</pre>
              </group>
              <group class="ControlBox-group">
                <button class="ControlBox-button" onClick={() => verseAddNote()}>
                  <svg width="30px" height="30px" viewBox="0 0 800 800" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" xmlns:serif="http://www.serif.com/" style="fill-rule:evenodd;clip-rule:evenodd;stroke-linejoin:round;stroke-miterlimit:2;">
                    <path
                      d="M364.787,41.667L435.213,41.667C496.473,41.666 544.993,41.666 582.967,46.771C622.047,52.025 653.68,63.096 678.627,88.041C688.387,97.805 688.387,113.634 678.627,123.397C668.863,133.16 653.033,133.16 643.27,123.397C629.163,109.29 609.84,100.834 576.307,96.325C542.05,91.72 496.893,91.667 433.333,91.667L366.667,91.667C303.106,91.667 257.95,91.72 223.695,96.325C190.159,100.834 170.837,109.29 156.73,123.397C142.623,137.504 134.167,156.825 129.659,190.362C125.053,224.617 125,269.773 125,333.333L125,466.667C125,530.227 125.053,575.383 129.659,609.64C134.167,643.173 142.623,662.497 156.73,676.603C170.837,690.71 190.159,699.167 223.695,703.673C257.95,708.28 303.106,708.333 366.667,708.333L433.333,708.333C496.893,708.333 542.05,708.28 576.307,703.673C609.84,699.167 629.163,690.71 643.27,676.603C666.467,653.407 673.493,617.36 674.713,532.973C674.913,519.167 686.267,508.137 700.073,508.337C713.877,508.537 724.907,519.89 724.707,533.693C723.537,614.61 718.3,672.283 678.627,711.96C653.68,736.903 622.047,747.973 582.967,753.23C544.993,758.333 496.473,758.333 435.213,758.333L364.787,758.333C303.528,758.333 255.006,758.333 217.033,753.23C177.952,747.973 146.32,736.903 121.375,711.96C96.429,687.013 85.359,655.38 80.105,616.3C74.999,578.327 74.999,529.807 75,468.547L75,331.453C74.999,270.194 74.999,221.673 80.105,183.699C85.359,144.619 96.429,112.987 121.375,88.041C146.32,63.096 177.952,52.025 217.033,46.771C255.006,41.666 303.527,41.666 364.787,41.667Z"
                      fill="currentColor"
                    />
                    <path d="M241.667,300C241.667,286.193 252.86,275 266.667,275L483.333,275C497.14,275 508.333,286.193 508.333,300C508.333,313.807 497.14,325 483.333,325L266.667,325C252.86,325 241.667,313.807 241.667,300Z" fill="currentColor" />
                    <g transform="matrix(1,0,0,1,0,301.041667)">
                      <path d="M241.667,266.667C241.667,252.86 252.86,241.667 266.667,241.667L533.333,241.667C547.14,241.667 558.333,252.86 558.333,266.667C558.333,280.474 547.14,291.667 533.333,291.667L266.667,291.667C252.86,291.667 241.667,280.474 241.667,266.667Z" fill="currentColor" />
                    </g>
                    <g transform="matrix(1,0,0,1,0,34.375)">
                      <path d="M241.667,400C241.667,386.193 252.86,375 266.667,375L533.333,375C547.14,375 558.333,386.193 558.333,400C558.333,413.807 547.14,425 533.333,425L266.667,425C252.86,425 241.667,413.807 241.667,400Z" fill="currentColor" />
                    </g>
                    <g transform="matrix(1,0,0,1,234.001,64.333333)">
                      <path d="M400,175C413.807,175 425,186.193 425,200L425,241.667L466.667,241.667C480.473,241.667 491.667,252.86 491.667,266.667C491.667,280.474 480.473,291.667 466.667,291.667L425,291.667L425,333.333C425,347.14 413.807,358.333 400,358.333C386.193,358.333 375,347.14 375,333.333L375,291.667L333.332,291.667C319.525,291.667 308.332,280.474 308.332,266.667C308.332,252.86 319.525,241.667 333.332,241.667L375,241.667L375,200C375,186.193 386.193,175 400,175Z" fill="currentColor" />
                    </g>
                  </svg>
                </button>
                <pre>Note</pre>
              </group>
              <group class="ControlBox-group">
                <button class="ControlBox-button" onClick={() => pictureAddVerse()}>
                  <svg width="30px" height="30px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path fill-rule="evenodd" clip-rule="evenodd" d="M18.5 1.25C18.9142 1.25 19.25 1.58579 19.25 2V4.75H22C22.4142 4.75 22.75 5.08579 22.75 5.5C22.75 5.91421 22.4142 6.25 22 6.25H19.25V9C19.25 9.41421 18.9142 9.75 18.5 9.75C18.0858 9.75 17.75 9.41421 17.75 9V6.25H15C14.5858 6.25 14.25 5.91421 14.25 5.5C14.25 5.08579 14.5858 4.75 15 4.75H17.75V2C17.75 1.58579 18.0858 1.25 18.5 1.25Z" fill="currentColor" />
                    <path
                      fill-rule="evenodd"
                      clip-rule="evenodd"
                      d="M12 1.25L11.9426 1.25C9.63423 1.24999 7.82519 1.24998 6.41371 1.43975C4.96897 1.63399 3.82895 2.03933 2.93414 2.93414C2.03933 3.82895 1.63399 4.96897 1.43975 6.41371C1.24998 7.82519 1.24999 9.63423 1.25 11.9426V12.0574C1.24999 14.3658 1.24998 16.1748 1.43975 17.5863C1.63399 19.031 2.03933 20.1711 2.93414 21.0659C3.82895 21.9607 4.96897 22.366 6.41371 22.5603C7.82519 22.75 9.63423 22.75 11.9426 22.75H12.0574C14.3658 22.75 16.1748 22.75 17.5863 22.5603C19.031 22.366 20.1711 21.9607 21.0659 21.0659C21.9607 20.1711 22.366 19.031 22.5603 17.5863C22.75 16.1748 22.75 14.3658 22.75 12.0574V12C22.75 11.5858 22.4142 11.25 22 11.25C21.5858 11.25 21.25 11.5858 21.25 12C21.25 14.3782 21.2484 16.0864 21.0736 17.3864C21.0667 17.4377 21.0596 17.4882 21.0522 17.5378L18.2782 15.0412C16.9788 13.8718 15.0437 13.7553 13.6134 14.7605L13.3152 14.9701C12.8182 15.3193 12.1421 15.2608 11.7125 14.8313L7.42282 10.5415C6.28741 9.40612 4.46613 9.34547 3.25771 10.4028L2.75098 10.8462C2.75552 9.05395 2.78124 7.69302 2.92637 6.61358C3.09825 5.33517 3.42514 4.56445 3.9948 3.9948C4.56445 3.42514 5.33517 3.09825 6.61358 2.92637C7.91356 2.75159 9.62178 2.75 12 2.75C12.4142 2.75 12.75 2.41421 12.75 2C12.75 1.58579 12.4142 1.25 12 1.25ZM2.92637 17.3864C3.09825 18.6648 3.42514 19.4355 3.9948 20.0052C4.56445 20.5749 5.33517 20.9018 6.61358 21.0736C7.91356 21.2484 9.62178 21.25 12 21.25C14.3782 21.25 16.0864 21.2484 17.3864 21.0736C18.6648 20.9018 19.4355 20.5749 20.0052 20.0052C20.2487 19.7617 20.4479 19.4814 20.6096 19.1404C20.5707 19.1166 20.5334 19.089 20.4983 19.0574L17.2747 16.1562C16.4951 15.4545 15.334 15.3846 14.4758 15.9877L14.1776 16.1973C13.0843 16.9657 11.5968 16.8369 10.6519 15.8919L6.36216 11.6022C5.78515 11.0252 4.85958 10.9944 4.24546 11.5317L2.75038 12.8399C2.75296 14.7884 2.77289 16.2448 2.92637 17.3864Z"
                      fill="currentColor"
                    />
                  </svg>
                </button>
                <pre>Picture</pre>
              </group>
            </div>
          </content>
        </nav>
      </footer>
      <Show when={showSelection()}>
        <Suspense>
          <CompareVerse />
        </Suspense>
      </Show>

      <Show when={showUniCtrl()}>
        <Suspense>
          <UniVerse />
        </Suspense>
      </Show>
      <ToastStack expandedCtl={expandedCtl} />
    </>
  );
}
