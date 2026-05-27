import { createSignal, createMemo, createEffect, on, onMount, onCleanup, For, Index, Show, batch } from "solid-js";
import SelectBox from "./Selectbox.jsx";
import { injectedVerse } from "../State/globalSignals.js";
import { clickOutside } from "../lib/functions.js"; // use: prevents showing in-use: KEEP Export Div
import { snapdom } from "@zumer/snapdom";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import { save, ask, message } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import "./CSS/MemeMaker.css";

let fileInput;

const PRESET_IMAGES = ["https://images.pexels.com/photos/459037/pexels-photo-459037.jpeg", "https://images.pexels.com/photos/326055/pexels-photo-326055.jpeg", "https://images.pexels.com/photos/417074/pexels-photo-417074.jpeg", "https://images.pexels.com/photos/355465/pexels-photo-355465.jpeg", "https://images.pexels.com/photos/1323550/pexels-photo-1323550.jpeg", "https://images.pexels.com/photos/12600615/pexels-photo-12600615.jpeg", "https://images.pexels.com/photos/9400206/pexels-photo-9400206.jpeg", "https://images.pexels.com/photos/2649403/pexels-photo-2649403.jpeg"];

const FONTS = [
  // --- LOCAL FONTS (Support Bold/Italic) ---
  { label: "Brush Script", value: "'Brush Script MT', cursive", hasBold: true },
  { label: "Arial", value: "Arial, Helvetica, sans-serif", hasBold: true },
  { label: "Verdana", value: "Verdana, Helvetica, sans-serif", hasBold: true },
  { label: "Georgia", value: "Georgia, serif", hasBold: true },
  { label: "Times New Roman", value: "'Times New Roman', serif", hasBold: true },

  // --- ONLINE FONTS (Decorative/Single Style) ---
  { label: "Bangers (Comic)", value: "'Bangers', system-ui", hasBold: false },
  { label: "Marker", value: "'Permanent Marker', cursive", hasBold: false },
  { label: "Playball (Script)", value: "'Playball', cursive", hasBold: false },
  { label: "Playwrite", value: "'Playwrite US Trad', cursive", hasBold: false },
  { label: "Caveat Brush", value: "'Caveat Brush', cursive", hasBold: false },
  { label: "Coiny", value: "'Coiny', system-ui", hasBold: false },
  { label: "DynaPuff", value: "'DynaPuff', system-ui", hasBold: false },
  { label: "Finger Paint", value: "'Finger Paint', cursive", hasBold: false },
  { label: "Gabriela", value: "'Gabriela', serif", hasBold: false },
  { label: "Kablammo", value: "'Kablammo', display", hasBold: false },
  { label: "Kavoon", value: "'Kavoon', serif", hasBold: false },
  { label: "Mystery Quest", value: "'Mystery Quest', display", hasBold: false },
  { label: "Ranchers", value: "'Ranchers', display", hasBold: false },
];

const uid = (p = "") => `${p}${Math.random().toString(36).slice(2, 9)}`;
const STORAGE_KEY = "MemeMakerProject_v1";

export default function MemeMaker() {
  const [images, setImages] = createSignal(PRESET_IMAGES);
  const [selectedImage, setSelectedImage] = createSignal(PRESET_IMAGES[0]);
  const [layerToggle, setLayerToggle] = createSignal(false);
  const [bgSize, setBgSize] = createSignal("cover");
  const [bgColor, setBgColor] = createSignal("#7e3e3e");
  const [flipH, setFlipH] = createSignal(false);
  const [flipV, setFlipV] = createSignal(false);
  const [aspectRatio, setAspectRatio] = createSignal("1 / 1");
  const [isHdLoaded, setIsHdLoaded] = createSignal(false);
  const [cornerStyle, setCornerStyle] = createSignal("squircle");
  const [cornerSize, setCornerSize] = createSignal(24);
  const [bgPos, setBgPos] = createSignal({ x: 50, y: 50 });
  const [templates, setTemplates] = createSignal([]);
  const [currentTemplateId, setCurrentTemplateId] = createSignal(null);
  const [exportFormat, setExportFormat] = createSignal("WEBP");
  const [exportSize, setExportSize] = createSignal(350);
  const [showExportMenu, setShowExportMenu] = createSignal(false);
  const [offlineImages, setOfflineImages] = createSignal(new Set());
  const [localMemeDir, setLocalMemeDir] = createSignal("");

  // 1. Create a Signal to hold the verified fonts.
  // We initialize it with the local fonts, as those are built into the OS and never fail.
  const [verifiedFonts, setVerifiedFonts] = createSignal(FONTS.filter((f) => f.hasBold));

  onMount(() => {
    const fontsId = "meme-maker-fonts";

    // 1. Check if we already injected the fonts (prevents duplicate injections on re-mounts)
    if (!document.getElementById(fontsId)) {
      const link = document.createElement("link");
      link.id = fontsId;
      link.rel = "stylesheet";
      // Combine your Google Fonts and CDN fonts if needed, or use two link tags.
      link.href = "https://fonts.googleapis.com/css2?family=Playball&family=Playwrite+US+Trad:wght@400&family=Caveat+Brush&family=Coiny&family=DynaPuff&family=Finger+Paint&family=Gabriela&family=Kablammo&family=Kavoon&family=Mystery+Quest&family=Bangers&family=Ranchers&family=Oswald:wght@700&family=Permanent+Marker&display=swap";

      document.head.appendChild(link);

      // 2. Wait for the CSS to actually download before verifying
      link.onload = () => verifyAndSetFonts();
    } else {
      // If it's already in the head, just verify immediately
      verifyAndSetFonts();
    }
  });

  // Extract your verification logic into a helper function
  async function verifyAndSetFonts() {
    const onlineFonts = FONTS.filter((f) => !f.hasBold);
    const validOnlineFonts = [];

    for (const font of onlineFonts) {
      try {
        const fontName = font.value.split(",")[0].replace(/['"]/g, "").trim();
        const loadedFonts = await document.fonts.load(`16px "${fontName}"`);

        if (loadedFonts.length > 0) {
          validOnlineFonts.push(font);
        } else {
          console.warn(`Font unavailable: ${font.label}`);
        }
      } catch (error) {
        console.warn(`Font error: ${font.label}`, error);
      }
    }

    setVerifiedFonts([...FONTS.filter((f) => f.hasBold), ...validOnlineFonts]);
  }

  // onMount(async () => {
  //   const onlineFonts = FONTS.filter((f) => !f.hasBold);
  //   const validOnlineFonts = [];

  //   // 2. Test each online font
  //   for (const font of onlineFonts) {
  //     try {
  //       // Extract just the font name (e.g., "'Permanent Marker', cursive" -> "Permanent Marker")
  //       const fontName = font.value.split(",")[0].replace(/['"]/g, "").trim();

  //       // Attempt to load a sample size of the font
  //       const loadedFonts = await document.fonts.load(`16px "${fontName}"`);

  //       if (loadedFonts.length > 0) {
  //         validOnlineFonts.push(font); // It works! Keep it.
  //       } else {
  //         console.warn(`Font unavailable, removing from list: ${font.label}`);
  //       }
  //     } catch (error) {
  //       console.warn(`Font error: ${font.label}`, error);
  //     }
  //   }

  //   // 3. Combine the local fonts with the successfully loaded online fonts
  //   setVerifiedFonts([...FONTS.filter((f) => f.hasBold), ...validOnlineFonts]);
  // });

  /* layers */
  const [layers, setLayers] = createSignal([
    {
      id: uid("l_"),
      type: "text",
      content: "Your verse text",
      x: 50,
      y: 20,
      fontFamily: FONTS[0].value,
      textWrap: false,
      wrapWidth: 100,
      bold: true,
      italic: false,
      color: "#eb8875",
      strokeColor: "#005876",
      strokeWidth: 0.3,
      shadow: true,
      shadowX: 4,
      shadowY: 6,
      shadowBlur: 4,
      shadowIntensity: 0.7,
      textBlockIntensity: 0,
      textBlockWidth: 0,
      scale: 1,
      selected: true,
      lineHeight: 1.2,
      letterSpacing: 0,
    },
  ]);

  const [selectedLayerId, setSelectedLayerId] = createSignal(layers()[0].id);
  let imageContainerRef = null;

  /* history */
  const [history, setHistory] = createSignal([]);
  const [future, setFuture] = createSignal([]);

  function pushHistory() {
    const snap = {
      images: images().slice(),
      selectedImage: selectedImage(),
      layers: JSON.parse(JSON.stringify(layers())),
      bgSize: bgSize(),
      bgColor: bgColor(),
      cornerStyle: cornerStyle(),
      bgPos: bgPos(),
      flipH: flipH(),
      flipV: flipV(),
      aspectRatio: aspectRatio(),
      exportFormat: exportFormat(),
      exportSize: exportSize(),
    };
    setHistory((h) => [...h, snap].slice(-60));
    setFuture([]);
  }

  /* load saved project */
  onMount(async () => {
    try {
      // Setup the base path for local images
      const baseDir = await appDataDir();
      const memeDir = await join(baseDir, "memes");
      setLocalMemeDir(memeDir);
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        batch(() => {
          if (parsed && parsed.layers) {
            setImages(parsed.images || PRESET_IMAGES);
            setSelectedImage(parsed.selectedImage !== undefined ? parsed.selectedImage : PRESET_IMAGES[0]);
            setLayers(parsed.layers);
            setSelectedLayerId(parsed.layers[0]?.id || null);
          }
          if (parsed.bgSize) setBgSize(parsed.bgSize);
          if (parsed.bgPos) setBgPos(parsed.bgPos);
          if (parsed.bgColor) setBgColor(parsed.bgColor);
          if (parsed.cornerStyle) setCornerStyle(parsed.cornerStyle);
          if (parsed.flipH !== undefined) setFlipH(parsed.flipH);
          if (parsed.flipV !== undefined) setFlipV(parsed.flipV);
          if (parsed.aspectRatio) setAspectRatio(parsed.aspectRatio);
          if (parsed.exportFormat) setExportFormat(parsed.exportFormat);
          if (parsed.exportSize) setExportSize(parsed.exportSize);
        });
        layers()[0]?.id ? selectLayer(layers()[0]?.id) : selectLayer("background");
      }
    } catch (e) {
      console.warn("load project failed", e);
    }
    window.addEventListener("pointerup", onPointerUpGlobal);
    window.addEventListener("pointercancel", onPointerUpGlobal);
  });

  onCleanup(() => {
    window.removeEventListener("pointerup", onPointerUpGlobal);
    window.removeEventListener("pointercancel", onPointerUpGlobal);
  });

  // Load templates on mount
  onMount(async () => {
    try {
      const loadedTemplates = await invoke("get_templates");
      setTemplates(loadedTemplates);
    } catch (e) {
      console.error("Failed to load templates:", e);
    }
  });

  const formatCitation = (parsedVerses) => {
    if (parsedVerses.length === 0) return "";

    const book = parsedVerses[0].book;
    const chapter = parsedVerses[0].chapter;
    const version = parsedVerses[0].version;

    // Sort and unique verse numbers
    const nums = [...new Set(parsedVerses.map((v) => parseInt(v.verse)))].sort((a, b) => a - b);

    // Logic to build ranges (e.g., 1-3, 5)
    let ranges = [];
    let start = nums[0];
    let end = start;

    for (let i = 1; i <= nums.length; i++) {
      if (i < nums.length && nums[i] === end + 1) {
        end = nums[i];
      } else {
        ranges.push(start === end ? `${start}` : `${start}-${end}`);
        if (i < nums.length) {
          start = nums[i];
          end = start;
        }
      }
    }

    return `(${version}) ${book} ${chapter}:${ranges.join(", ")}`;
  };

  const parseVerseData = (rawStrings) => {
    // Regex looks for: (Version) BOOK Chapter:Verse at the end of string
    const regex = /(.*?)\s*\((.*?)\)\s+(.*?)\s+(\d+):(\d+)$/;

    const texts = [];
    const meta = [];

    rawStrings.forEach((str) => {
      const match = str.match(regex);
      if (match) {
        texts.push(match[1].trim());
        meta.push({
          version: match[2],
          book: match[3],
          chapter: match[4],
          verse: match[5],
        });
      } else {
        texts.push(str); // Fallback if regex fails
      }
    });

    return {
      combinedText: texts.join("\n\n"),
      citation: formatCitation(meta),
    };
  };

  // Listen for the external verse signal changing
  createEffect(
    on(
      () => injectedVerse(), // if
      () => injectVerseAsLayer(injectedVerse()), // do
      { defer: true }, //Not on first load
    ),
  );

  function injectVerseAsLayer(verseText) {
    pushHistory();

    // Auto-Scaling Logic
    const charCount = verseText.length;
    // Assume scale 1 looks good for ~30 characters.
    // If it's longer, we shrink the scale down (but cap it at 0.4 so it's not microscopic).
    const calculatedScale = charCount <= 30 ? 1 : Math.max(0.4, 30 / charCount);

    const newLayer = {
      id: uid("l_"),
      type: "text",
      content: verseText,
      x: 50, // Center X
      y: 50, // Center Y
      fontFamily: FONTS[1].value,
      textWrap: true,
      wrapWidth: 250,
      bold: false,
      italic: true,
      color: "#ffffff", // Standard meme white
      strokeColor: "#000000", // Standard meme black outline
      strokeWidth: 0.3,
      shadow: false,
      shadowX: 4,
      shadowY: 6,
      shadowBlur: 4,
      shadowIntensity: 0.7,
      textBlockIntensity: 0,
      textBlockWidth: 0,
      scale: calculatedScale, // Inject the dynamic scale here
      selected: true,
      lineHeight: 1.2,
      letterSpacing: 0,
    };

    setLayers((prev) => prev.map((p) => ({ ...p, selected: false })).concat(newLayer));
    setSelectedLayerId(newLayer.id);
  }

  // Helper to ensure template titles are unique
  function getUniqueTitle(desiredTitle) {
    // 1. If the exact title doesn't exist yet, it's safe to use!
    if (!templates().some((t) => t.title === desiredTitle)) {
      return desiredTitle;
    }

    // 2. If it DOES exist, start counting until we find an open slot
    let counter = 1;
    let newTitle = `${desiredTitle}-${counter}`;

    // Keep bumping the counter as long as the new title is also taken
    while (templates().some((t) => t.title === newTitle)) {
      counter++;
      newTitle = `${desiredTitle}-${counter}`;
    }

    return newTitle;
  }

  async function handleSaveTemplate(existingId = null) {
    if (!imageContainerRef) return;

    let title = "Template";
    if (existingId) {
      const existing = templates().find((t) => t.id === existingId);
      if (existing) title = existing.title;
    } else {
      let userTitle = prompt("Enter a title for this template:", title);
      if (userTitle === null) return;

      if (userTitle.trim() === "") {
        userTitle = title;
      }
      title = getUniqueTitle(userTitle);
    }

    try {
      // 1. Generate the thumbnail using SnapDOM
      const thumbCapture = await snapdom(imageContainerRef, { scale: 0.4, embedFonts: true });
      const thumbImgElement = await thumbCapture.toWebp();

      // 2. Convert the Base64 result into raw bytes
      const thumbBytes = Array.from(base64ToUint8Array(thumbImgElement.src));

      // 3. Create a unique filename for the template thumbnail and save to disk
      const thumbFilename = `template_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.webp`;
      await invoke("save_meme_image", { bytes: thumbBytes, filename: thumbFilename });

      // 4. Create payload (Notice selectedImage is passed directly now!)
      const payloadObj = {
        selectedImage: selectedImage(),
        layers: layers(),
        bgSize: bgSize(),
        bgPos: bgPos(),
        bgColor: bgColor(),
        cornerStyle: cornerStyle(),
        flipH: flipH(),
        flipV: flipV(),
        aspectRatio: aspectRatio(),
        exportFormat: exportFormat(),
        exportSize: exportSize(),
      };

      // 5. Send to Rust database (passing the filename, NOT the base64 string)
      const savedId = await invoke("save_template", {
        title: title,
        thumbnail: thumbFilename,
        payload: JSON.stringify(payloadObj),
        id: existingId,
      });

      setCurrentTemplateId(savedId);
      const updatedTemplates = await invoke("get_templates");
      setTemplates(updatedTemplates);
    } catch (err) {
      console.error("Failed to save template:", err);
    }
  }

  function handleApplyTemplate(template) {
    try {
      const parsed = JSON.parse(template.payload);
      if (parsed) {
        // Track that we are currently editing this template
        setCurrentTemplateId(template.id);

        // if (parsed.images) setImages(parsed.images);
        if (parsed.selectedImage !== undefined) setSelectedImage(parsed.selectedImage);
        if (parsed.layers) setLayers(parsed.layers);
        if (parsed.bgSize) setBgSize(parsed.bgSize);
        if (parsed.bgPos) setBgPos(parsed.bgPos);
        if (parsed.bgColor) setBgColor(parsed.bgColor);
        if (parsed.cornerStyle) setCornerStyle(parsed.cornerStyle);
        if (parsed.flipH !== undefined) setFlipH(parsed.flipH);
        if (parsed.flipV !== undefined) setFlipV(parsed.flipV);
        if (parsed.aspectRatio) setAspectRatio(parsed.aspectRatio);
        layers()[0]?.id ? selectLayer(layers()[0]?.id) : selectLayer("background");

        saveToLocal();
      }
    } catch (e) {
      console.error("Failed to apply template:", e);
    }
  }

  // Delete a template
  async function handleDeleteTemplate(e, id) {
    e.stopPropagation();
    const confirmed = await ask("Are you sure you want to delete this Template?", {
      title: "Delete Template Image",
      kind: "warning",
      okLabel: "Delete",
      cancelLabel: "Cancel",
    });

    if (!confirmed) return;

    try {
      // Find the template before we delete it so we know the thumbnail filename
      const templateToDelete = templates().find((t) => t.id === id);

      // Delete from DB
      await invoke("delete_template", { id });

      // Delete the thumbnail file from disk (ignoring any legacy data: strings)
      if (templateToDelete && templateToDelete.thumbnail && !templateToDelete.thumbnail.startsWith("data:")) {
        await invoke("delete_meme_image", { filename: templateToDelete.thumbnail });
      }

      setTemplates(templates().filter((t) => t.id !== id));
    } catch (err) {
      console.error("Failed to delete template:", err);
    }
  }

  function handleAddFromUrl() {
    let url = prompt("Paste the image URL here:", "https://...");

    if (!url) return; // User canceled

    try {
      // 1. PEXELS CONVERTER
      // Captures the ID from: https://www.pexels.com/photo/name-12345/
      const pexelsRegex = /pexels\.com\/photo\/.*[/-](\d+)\/?$/i;
      const pexelsMatch = url.match(pexelsRegex);
      if (pexelsMatch) {
        const id = pexelsMatch[1];
        url = `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg`;
      }

      // 2. UNSPLASH CONVERTER
      // Captures the ID from: https://unsplash.com/photos/name-abc123XYZ
      const unsplashRegex = /unsplash\.com\/photos\/.*-?([a-zA-Z0-9_-]{11})\/?$/i;
      const unsplashMatch = url.match(unsplashRegex);
      if (unsplashMatch) {
        const id = unsplashMatch[1];
        // We add auto=format and q=80 to ensure a high-quality, web-ready version
        url = `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&q=80&w=1200`;
      }

      // 3. PINTEREST NOTE
      // Pinterest obscures their image paths. A Pin ID (e.g., /pin/123/)
      // does NOT match the image filename (e.g., i.pinimg.com/originals/abc.jpg).
      if (url.includes("pinterest.com/pin/")) {
        alert("Pinterest links require the direct image address. Right-click the image on Pinterest and select 'Copy Image Address' instead.");
        return;
      }

      // 4. Final Validation & Application
      if (url.startsWith("http://") || url.startsWith("https://")) {
        setImages([url, ...images()]);
        setSelectedImage(url);
      } else {
        alert("Please enter a valid HTTP or HTTPS link.");
      }
    } catch (e) {
      console.error("URL transformation failed:", e);
    }
  }

  function saveToLocal() {
    const payload = {
      images: images(),
      selectedImage: selectedImage(),
      layers: layers(),
      bgSize: bgSize(),
      bgPos: bgPos(),
      bgColor: bgColor(),
      cornerStyle: cornerStyle(),
      flipH: flipH(),
      flipV: flipV(),
      aspectRatio: aspectRatio(),
      exportFormat: exportFormat(),
      exportSize: exportSize(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }

  /* undo / redo */
  function undo() {
    const h = history();
    if (!h.length) return;
    const last = h[h.length - 1];

    batch(() => {
      setHistory((prev) => prev.slice(0, -1));
      setFuture((f) => [
        ...f,
        {
          images: images().slice(),
          selectedImage: selectedImage(),
          layers: JSON.parse(JSON.stringify(layers())),
          bgSize: bgSize(),
          bgColor: bgColor(),
          cornerStyle: cornerStyle(),
          bgPos: bgPos(),
          flipH: flipH(),
          flipV: flipV(),
          aspectRatio: aspectRatio(),
          exportFormat: exportFormat(),
          exportSize: exportSize(),
        },
      ]);

      setImages(last.images || PRESET_IMAGES);
      setSelectedImage(last.selectedImage !== undefined ? last.selectedImage : PRESET_IMAGES[0]);
      setLayers(last.layers || []);
      setSelectedLayerId(last.layers?.length ? last.layers[0].id : null);

      if (last.bgSize !== undefined) setBgSize(last.bgSize);
      if (last.bgColor !== undefined) setBgColor(last.bgColor);
      if (last.cornerStyle !== undefined) setCornerStyle(last.cornerStyle);
      if (last.bgPos !== undefined) setBgPos(last.bgPos);
      if (last.flipH !== undefined) setFlipH(last.flipH);
      if (last.flipV !== undefined) setFlipV(last.flipV);
      if (last.aspectRatio !== undefined) setAspectRatio(last.aspectRatio);
      if (last.exportFormat !== undefined) setExportFormat(last.exportFormat);
      if (last.exportSize !== undefined) setExportSize(last.exportSize);
    });
  }

  function redo() {
    const f = future();
    if (!f.length) return;

    const next = f[f.length - 1];
    batch(() => {
      // 1. Remove the next state from future
      setFuture((prev) => prev.slice(0, -1));

      // 2. Save the COMPLETE current state back to history
      setHistory((h) => [
        ...h,
        {
          images: images().slice(),
          selectedImage: selectedImage(),
          layers: JSON.parse(JSON.stringify(layers())),
          bgSize: bgSize(),
          bgColor: bgColor(),
          cornerStyle: cornerStyle(),
          bgPos: bgPos(),
          flipH: flipH(),
          flipV: flipV(),
          aspectRatio: aspectRatio(),
          exportFormat: exportFormat(),
          exportSize: exportSize(),
        },
      ]);

      // 3. Restore the COMPLETE next state
      setImages(next.images || PRESET_IMAGES);
      setSelectedImage(next.selectedImage !== undefined ? next.selectedImage : PRESET_IMAGES[0]);
      setLayers(next.layers || []);
      setSelectedLayerId(next.layers?.length ? next.layers[0].id : null);

      if (next.bgSize !== undefined) setBgSize(next.bgSize);
      if (next.bgColor !== undefined) setBgColor(next.bgColor);
      if (next.cornerStyle !== undefined) setCornerStyle(next.cornerStyle);
      if (next.bgPos !== undefined) setBgPos(next.bgPos);
      if (next.flipH !== undefined) setFlipH(next.flipH);
      if (next.flipV !== undefined) setFlipV(next.flipV);
      if (next.aspectRatio !== undefined) setAspectRatio(next.aspectRatio);
      if (next.exportFormat !== undefined) setExportFormat(next.exportFormat);
      if (next.exportSize !== undefined) setExportSize(next.exportSize);
    });
  }

  /* layer helpers */
  function addTextLayer() {
    pushHistory();
    const newLayer = {
      id: uid("l_"),
      type: "text",
      content: "New text",
      x: 50,
      y: 20,
      fontFamily: FONTS[0].value,
      textWrap: false,
      wrapWidth: 100,
      bold: true,
      italic: false,
      color: "#eb8875",
      strokeColor: "#005876",
      strokeWidth: 0.3,
      shadow: false,
      shadowX: 4,
      shadowY: 6,
      shadowBlur: 4,
      shadowIntensity: 0.7,
      textBlockIntensity: 0,
      textBlockWidth: 0,
      scale: 1,
      selected: true,
      lineHeight: 1.2,
      letterSpacing: 0,
    };
    setLayers((prev) => prev.map((p) => ({ ...p, selected: false })).concat(newLayer));
    setSelectedLayerId(newLayer.id);
  }

  function deleteLayer(id) {
    pushHistory();
    setLayers((prev) => prev.filter((l) => l.id !== id));
    const remaining = layers().filter((l) => l.id !== id);
    setSelectedLayerId(remaining[0]?.id || null);
  }

  function selectLayer(id) {
    setLayers((prev) => prev.map((l) => ({ ...l, selected: l.id === id })));
    setSelectedLayerId(id);
  }

  // Add this variable near your autosave timer at the top level of your file
  let historyBatchTimer = null;

  function updateLayer(id, patch) {
    // 1. If we are NOT already in the middle of a rapid edit,
    // push the history NOW (capturing the state BEFORE this new change happens).
    if (!historyBatchTimer) {
      pushHistory();
    }

    // 2. Apply the actual update to the layer
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));

    // 3. Reset the cooldown timer.
    // If 500ms passes without updateLayer being called again, the timer clears,
    // meaning the next change will trigger a fresh history push.
    clearTimeout(historyBatchTimer);
    historyBatchTimer = setTimeout(() => {
      historyBatchTimer = null;
    }, 500);
  }

  /* dragging state */
  let dragging = false;
  let dragState = null;

  // 1. Text Layer Pointer Down
  function onLayerPointerDown(e, layer) {
    e.stopPropagation(); // CRITICAL: This stops the click from reaching the background
    if (!imageContainerRef) return;
    const rect = imageContainerRef.getBoundingClientRect();
    const startX = ((e.clientX - rect.left) / rect.width) * 100;
    const startY = ((e.clientY - rect.top) / rect.height) * 100;

    dragging = true;
    dragState = { startX, startY, layerX: layer.x, layerY: layer.y, id: layer.id };
    selectLayer(layer.id);
  }

  // 2. Background Pointer Down
  function onBackgroundPointerDown(e) {
    if (!imageContainerRef) return;
    const rect = imageContainerRef.getBoundingClientRect();
    const startX = ((e.clientX - rect.left) / rect.width) * 100;
    const startY = ((e.clientY - rect.top) / rect.height) * 100;

    dragging = true;

    dragState = {
      startX,
      startY,
      layerX: bgPos().x,
      layerY: bgPos().y,
      id: "background", // Reserved ID
    };
    selectLayer("background");
  }

  function onPointerMove(e) {
    if (!dragging || !dragState || !imageContainerRef) return;

    const rect = imageContainerRef.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    let dx = x - dragState.startX;
    let dy = y - dragState.startY;

    if (dragState.id === "background") {
      // 1. COVER MODE INVERSION
      // Because 'cover' makes the image larger than the container,
      // increasing the % moves the image visually left/up. We invert to match the mouse.
      if (bgSize() === "cover") {
        dx *= -1;
        dy *= -1;
      }

      // 2. FLIP INVERSIONS (Your existing logic)
      if (flipH()) dx *= -1;
      if (flipV()) dy *= -1;

      const newX = Math.min(100, Math.max(0, dragState.layerX + dx));
      const newY = Math.min(100, Math.max(0, dragState.layerY + dy));

      setBgPos({ x: newX, y: newY });
    } else {
      // Standard Text Layer Drag
      const newX = Math.min(100, Math.max(0, dragState.layerX + dx));
      const newY = Math.min(100, Math.max(0, dragState.layerY + dy));

      updateLayer(dragState.id, { x: newX, y: newY });
    }
  }

  // 4. Pointer Up Global
  function onPointerUpGlobal() {
    if (dragging) {
      dragging = false;
      dragState = null;
      pushHistory(); // This now automatically captures background moves!
    }
  }

  // createEffect(() => {
  //   images();
  //   selectedImage();
  //   saveToLocal();
  // });

  // Helper to resize and convert to WebP

  // Helper to resize and return a WebP blob

  const createResizedBlob = (img, maxDim) => {
    return new Promise((resolve) => {
      let { width, height } = img;

      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob((blob) => resolve(blob), "image/webp", 0.9);
    });
  };

  const processUploadedImage = (file) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = async () => {
        // Generate BOTH sizes simultaneously
        const hdBlob = await createResizedBlob(img, 1200);
        const thumbBlob = await createResizedBlob(img, 72);
        const previewBlob = await createResizedBlob(img, 500);

        URL.revokeObjectURL(img.src);
        resolve({ hdBlob, thumbBlob, previewBlob });
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  };

  async function handleImageUpload(e) {
    const files = e.currentTarget.files;
    if (!files || !files.length) return;

    try {
      const newFilenames = await Promise.all(
        Array.from(files).map(async (file) => {
          // 1. Get both WebP Blobs
          const { hdBlob, thumbBlob, previewBlob } = await processUploadedImage(file);

          // 2. Generate the base unique filename
          const baseName = `upload_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
          const hdFilename = `${baseName}.webp`;
          const thumbFilename = `${baseName}_thumb.webp`;
          const previewFilename = `${baseName}_preview.webp`;

          // 3. Convert both to bytes and save to Rust
          const hdBuffer = await hdBlob.arrayBuffer();
          const thumbBuffer = await thumbBlob.arrayBuffer();
          const previewBuffer = await previewBlob.arrayBuffer();

          await invoke("save_meme_image", { bytes: Array.from(new Uint8Array(hdBuffer)), filename: hdFilename });
          await invoke("save_meme_image", { bytes: Array.from(new Uint8Array(thumbBuffer)), filename: thumbFilename });
          await invoke("save_meme_image", {
            bytes: Array.from(new Uint8Array(previewBuffer)),
            filename: previewFilename,
          });

          // 4. Return ONLY the HD filename to be saved in your app's state
          return hdFilename;
        }),
      );

      pushHistory();
      setImages((prev) => [...prev, ...newFilenames]);
      setSelectedImage(newFilenames[0]);
      saveToLocal();
    } catch (error) {
      console.error("Failed to upload and process image:", error);
    }

    e.target.value = "";
  }

  const removeImage = async (src) => {
    // 1. THE SHIELD: Check if any template relies on this image
    const isProtected = templates().some((t) => {
      try {
        const payload = JSON.parse(t.payload);
        return payload.selectedImage === src;
      } catch {
        return false;
      }
    });

    if (isProtected) {
      await message("This image is currently used by a saved template. You cannot delete it.", {
        title: "Image in Use",
        kind: "warning",
        okLabel: "Close",
      });
      return; // Abort the deletion process
    }

    // 2. Normal deletion logic proceeds if it's not protected
    const confirmed = await ask("Are you sure you want to delete this thumbnail?", {
      title: "Delete Thumbnail Image",
      kind: "warning",
      okLabel: "Delete",
      cancelLabel: "Cancel",
    });

    if (!confirmed) return;
    pushHistory();

    // --- THE FIX: Clear preview if the active image is being deleted ---
    const nextImages = images().filter((img) => img !== src);
    setImages(nextImages);

    if (selectedImage() === src) {
      // Pick the first remaining image, or null if the strip is completely empty
      setSelectedImage(nextImages.length > 0 ? nextImages[0] : null);
    }

    if (!src.startsWith("http")) {
      try {
        await invoke("delete_meme_image", { filename: src });
        await invoke("delete_meme_image", { filename: src.replace(".webp", "_thumb.webp") });
        await invoke("delete_meme_image", { filename: src.replace(".webp", "_preview.webp") });
        // setSelectedImage(null);
      } catch (e) {
        console.error("Failed to delete local file:", e);
      }
    }

    setTimeout(saveToLocal, 0);
  };

  const resetApp = async () => {
    const confirmed = await ask("Will remove uploaded images and restore Preset Images! Templates will not be lost.", {
      title: "Fresh Start?",
      kind: "warning",
      okLabel: "Reset Presets",
      cancelLabel: "Cancel",
    });

    if (confirmed) {
      // 1. Gather every image currently required by templates
      const templateImages = templates()
        .map((t) => {
          try {
            const payload = JSON.parse(t.payload);
            return payload.selectedImage;
          } catch {
            return null;
          }
        })
        .filter(Boolean); // removes nulls

      // Deduplicate the list just in case multiple templates use the same image
      const uniqueTemplateImages = [...new Set(templateImages)];

      // 2. Find and delete orphaned uploads from the hard drive
      const uploadsToDelete = images().filter((img) => img.startsWith("upload_") && !uniqueTemplateImages.includes(img));

      for (const filename of uploadsToDelete) {
        try {
          await invoke("delete_meme_image", { filename });
          await invoke("delete_meme_image", { filename: filename.replace(".webp", "_thumb.webp") });
          await invoke("delete_meme_image", { filename: filename.replace(".webp", "_preview.webp") });
        } catch (e) {
          console.error(`Failed to delete orphaned file ${filename}:`, e);
        }
      }

      // 3. Nuke local storage
      localStorage.clear();

      // 4. THE RESTORATION: Pre-seed localStorage before the reload!
      // Merge your default images with the rescued template images.
      const restoredImages = [...new Set([...PRESET_IMAGES, ...uniqueTemplateImages])];

      const payload = {
        images: setImages(restoredImages),
        selectedImage: setSelectedImage(null),
        layers: layers(),
        bgSize: bgSize(),
        bgPos: bgPos(),
        bgColor: bgColor(),
        cornerStyle: cornerStyle(),
        flipH: flipH(),
        flipV: flipV(),
        aspectRatio: aspectRatio(),
        exportFormat: exportFormat(),
        exportSize: exportSize(),
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));

      // 5. Start fresh
      setCurrentTemplateId(null);
      window.location.reload();
    }
  };

  /* selected layer memo */
  const selectedLayer = createMemo(() => layers().find((l) => l.id === selectedLayerId()));

  /* autosave */
  let saveTimer;
  createEffect(() => {
    JSON.stringify(layers());
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveToLocal(), 700);
  });

  /* reorder */
  function moveLayer(id, dir) {
    pushHistory();
    const arr = layers().slice();
    const idx = arr.findIndex((l) => l.id === id);
    if (idx < 0) return;
    const newIdx = dir === "up" ? Math.max(0, idx - 1) : Math.min(arr.length - 1, idx + 1);
    const item = arr.splice(idx, 1)[0];
    arr.splice(newIdx, 0, item);
    setLayers(arr);
  }

  // Helper function to convert base64 image data to a byte array for Tauri
  function base64ToUint8Array(base64) {
    const binaryString = atob(base64.split(",")[1]);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }

  const getOptimizedUrl = (url, mode = "auto") => {
    // 1. Handle empties or raw data
    if (!url) return "";
    if (url.startsWith("blob:") || url.startsWith("data:")) return url;

    // 2. Handle Local Files (Filenames don't start with HTTP)
    if (!url.startsWith("http")) {
      if (!localMemeDir()) return ""; // Safeguard if directory hasn't loaded yet

      let targetFilename = url; // Default is the HD version (.webp)

      // Only swap to a smaller version if we are NOT in HD mode
      if (!isHdLoaded() && mode !== "hd") {
        if (mode === "thumb") {
          targetFilename = url.replace(".webp", "_thumb.webp");
        } else if (mode === "preview") {
          targetFilename = url.replace(".webp", "_preview.webp");
        }
      }

      // Construct the path manually to avoid using an async function
      const separator = localMemeDir().includes("\\") ? "\\" : "/";
      const hasTrailing = localMemeDir().endsWith("\\") || localMemeDir().endsWith("/");
      const fullPath = localMemeDir() + (hasTrailing ? "" : separator) + targetFilename;

      return convertFileSrc(fullPath);
    }

    // 3. Handle Web URLs (Pexels)
    const baseParams = "auto=compress&cs=tinysrgb";
    if (mode === "thumb") {
      return `${url}?${baseParams}&dpr=1&fit=crop&h=52&w=72`;
    }
    if (mode === "hd" || isHdLoaded()) {
      return `${url}?${baseParams}&fit=max&w=1200&h=1200`;
    }
    if (mode === "preview") {
      return `${url}?${baseParams}&fit=max&w=500&h=500`;
    }
    return `${url}?${baseParams}&fit=max&w=250&h=250`;
  };

  async function handleExport() {
    if (!imageContainerRef) return;
    setShowExportMenu(false);

    try {
      const hdUrl = getOptimizedUrl(selectedImage(), "hd");

      // PRE-CACHE: Only download it if it's a web URL.
      if (hdUrl.startsWith("http")) {
        await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = resolve;
          img.onerror = reject;
          img.src = hdUrl;
        });
      }
      setIsHdLoaded(true);

      // Small "tick" to let the SolidJS DOM update its src/background-image
      await new Promise((r) => setTimeout(r, 50));

      const rect = imageContainerRef.getBoundingClientRect();
      const maxDim = Math.max(rect.width, rect.height);
      const dynamicPixelRatio = exportSize() / maxDim;

      const captureResult = await snapdom(imageContainerRef, { scale: dynamicPixelRatio, embedFonts: true });

      // Dynamically call the correct format method
      const format = exportFormat().toLowerCase(); // png, webp, or jpg
      let imgElement;

      if (format === "webp") {
        imgElement = await captureResult.toWebp();
      } else if (format === "jpeg") {
        imgElement = await captureResult.toJpeg(0.95); // 95% quality for JPEG
      } else {
        imgElement = await captureResult.toPng(); // Default to PNG
      }
      const dataUrl = imgElement.src;

      const filePath = await save({
        filters: [{ name: "Image", extensions: [format] }],
        defaultPath: `meme-${Date.now()}.${format}`,
      });

      if (filePath) {
        const imgData = base64ToUint8Array(dataUrl);
        await writeFile(filePath, imgData);
      }
    } catch (err) {
      console.error("Export failed:", err);
    } finally {
      setIsHdLoaded(false);
    }
  }

  // Initialize with ["ControlName", GroupID]
  const [expandedControls, setExpandedControls] = createSignal(new Map([["fonts", 1]]));

  const toggleControl = (controlName, groupId = 0) => {
    setExpandedControls((prev) => {
      const next = new Map(prev);

      // 1. If it's already open, just close it (Standard toggle)
      if (next.has(controlName)) {
        next.delete(controlName);
      }
      // 2. If we are opening it...
      else {
        // If it's a radio group (groupId > 0), find and remove its "roommate"
        if (groupId !== 0) {
          for (const [name, id] of next) {
            if (id === groupId) {
              next.delete(name);
            }
          }
        }
        // Add the new control and remember its group ID
        next.set(controlName, groupId);
      }

      return next;
    });
  };
  return (
    <div class="MemeMaker-root" style={`grid-template-rows: 35vh 1fr;`} onPointerMove={onPointerMove}>
      <div class="MemeMaker-main">
        <div
          class="MemeMaker-workspace-viewport"
          style={{
            "aspect-ratio": aspectRatio() === "auto" || aspectRatio() === "custom" ? "unset" : aspectRatio(),
            // "max-height": "35vh", // CRITICAL: Limits height. - Now Grid handles height.
          }}
        >
          <div
            ref={(el) => (imageContainerRef = el)}
            onPointerDown={onBackgroundPointerDown}
            class="MemeMaker-imageContainer"
            style={{
              "aspect-ratio": aspectRatio() === "auto" || aspectRatio() === "custom" ? "unset" : aspectRatio(),
              "background-color": bgColor() === "transparent" ? "transparent" : bgColor(),

              // Styling
              "border-radius": cornerStyle() === "round" ? `${cornerSize()}px` : "0",

              // Apply dynamic clip-path for Bevel
              "clip-path":
                cornerStyle() === "bevel"
                  ? `polygon(${cornerSize()}px 0%, calc(100% - ${cornerSize()}px) 0%, 100% ${cornerSize()}px, 100% calc(100% - ${cornerSize()}px), calc(100% - ${cornerSize()}px) 100%, ${cornerSize()}px 100%, 0% calc(100% - ${cornerSize()}px), 0% ${cornerSize()}px)`
                  : cornerStyle() === "squircle"
                    ? // Fixed squircle mask (slider won't affect squircle shape easily, so it acts as a fixed premium style)
                      `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'%3E%3Cpath d='M0,100 C0,15 15,0 100,0 C185,0 200,15 200,100 C200,185 185,200 100,200 C15,200 0,185 0,100' fill='black'/%3E%3C/svg%3E")`
                    : "none",

              ...(cornerStyle() === "squircle"
                ? {
                    "mask-image": `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'%3E%3Cpath d='M0,100 C0,15 15,0 100,0 C185,0 200,15 200,100 C200,185 185,200 100,200 C15,200 0,185 0,100' fill='black'/%3E%3C/svg%3E")`,
                    "mask-size": "100% 100%",
                    "mask-repeat": "no-repeat",
                  }
                : {}),
            }}
          >
            {/* Background Layer */}
            <div
              class="MemeMaker-backgroundLayer"
              style={{
                "background-image": selectedImage() ? `url(${getOptimizedUrl(selectedImage(), "preview")})` : "none",
                "background-position": `${bgPos().x}% ${bgPos().y}%`,
                "background-size": bgSize(),
                transform: `scale(${flipH() ? -1 : 1}, ${flipV() ? -1 : 1})`,
              }}
            />

            <Show when={selectedImage()}>
              <img
                src={getOptimizedUrl(selectedImage())}
                loading="lazy"
                decoding="async"
                alt="spacer"
                crossOrigin="anonymous"
                style={{
                  width: "auto",
                  height: "100%",
                  visibility: "hidden",
                  display: aspectRatio() === "auto" ? "block" : "none",
                  "pointer-events": "none",
                }}
              />
            </Show>

            <Index each={layers()}>
              {(layer) => (
                <div
                  class="MemeMaker-layer"
                  classList={{ "MemeMaker-layer--selected": layer().selected }}
                  data-layer-id={layer().id}
                  style={{
                    left: `${layer().x}%`,
                    top: `${layer().y}%`,
                  }}
                  onPointerDown={(e) => onLayerPointerDown(e, layer())}
                >
                  <div
                    class="MemeMaker-textLayer"
                    style={{
                      "--textLayer-shadow-intensity": `rgb(0 0 0 / ${layer().shadow && layer().textBlockIntensity})`,
                      color: layer().color,
                      "font-family": layer().fontFamily,
                      "font-weight": layer().bold ? 700 : 400,
                      "font-style": layer().italic ? "italic" : "normal",
                      "font-size": `${Math.max(5, 28 * layer().scale)}px`,
                      "-webkit-text-stroke": `${layer().strokeWidth}px ${layer().strokeColor}`,
                      "white-space": layer().textWrap ? "pre-wrap" : "pre",
                      width: layer().textWrap ? `${layer().wrapWidth}px` : "auto",
                      "line-height": layer()?.lineHeight,
                      "letter-spacing": `${layer()?.letterSpacing}px`,
                      "text-shadow": layer().shadow ? `${layer().shadowX}px ${layer().shadowY}px ${layer().shadowBlur}px rgb(0 0 0 / ${layer().shadowIntensity})` : "none",
                      "background-color": "var(--textLayer-shadow-intensity)",
                      "border-radius": "8px",
                      "padding-block": "10px",
                      "padding-inline": `${layer().shadow && layer().textBlockWidth}px`,
                    }}
                  >
                    {layer().content}
                  </div>
                </div>
              )}
            </Index>
          </div>
        </div>
      </div>
      <div class="MemeMaker-controlWrapper scroll_Win">
        <div class="MemeMaker-imageStrip" style="scrollbar-width:none;">
          <div style={{ display: "grid", gap: "4px", "align-items": "center" }}>
            {/* Existing Local Upload */}
            <button type="button" class="MemeMaker-uploadButton" onClick={() => fileInput.click()}>
              + Upload BG
            </button>
            <input ref={fileInput} type="file" accept="image/*" style={{ display: "none" }} multiple onChange={handleImageUpload} />

            {/* New URL Upload */}
            <button class="MemeMaker-AddFromUrl" onClick={handleAddFromUrl}>
              🔗 From URL
            </button>
          </div>
          <div class="MemeMaker-imageList">
            <div class="MemeMaker-thumbWrapper">
              <button
                style={{ background: bgColor() }}
                class={`MemeMaker-thumbButton ${selectedImage() === null ? "MemeMaker-thumbButton--active" : ""}`}
                onClick={() => {
                  aspectRatio() === "auto" && setAspectRatio("1 / 1");
                  setSelectedImage(null);
                  setSelectedLayerId("background");
                  saveToLocal();
                }}
              >
                <span
                  class="MemeMaker-thumbImage bgOnly"
                  style={{
                    "--dynamic-bg": bgColor(),
                    "background-color": "var(--dynamic-bg)",
                  }}
                >
                  BG Color ONLY
                </span>
              </button>
            </div>
            <For each={images().filter((src) => !offlineImages().has(src))}>
              {(src) => (
                /* This div is the anchor! */
                <div class="MemeMaker-thumbWrapper">
                  <button class={`MemeMaker-thumbButton ${selectedImage() === src ? "MemeMaker-thumbButton--active" : ""}`} onClick={() => setSelectedImage(src)}>
                    <img
                      src={getOptimizedUrl(src, "thumb")}
                      class="MemeMaker-thumbImage"
                      alt="bg-thumb"
                      loading="lazy"
                      decoding="async"
                      onError={() => {
                        console.warn("Image unavailable, hiding temporarily:", src);
                        setOfflineImages((prev) => {
                          const next = new Set(prev);
                          next.add(src);
                          return next;
                        });
                      }}
                    />
                  </button>

                  <button
                    class="MemeMaker-deleteThumb"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeImage(src);
                    }}
                  >
                    ×
                  </button>
                </div>
              )}
            </For>
          </div>
        </div>
        <div class="MemeMaker-layerList" classList={{ layerToggle: layerToggle() }}>
          <div class="MemeMaker-layerListHeader">
            <button class="MemeMaker-small" onClick={() => setLayerToggle(!layerToggle())}>
              Layers
            </button>
            <div class="MemeMaker-labelHeader">
              {!layerToggle() && "Selected:"}
              <span class="MemeMaker-layerName">{!layerToggle() && selectedLayer() ? selectedLayer()?.content?.slice(0, 10) + " ..." : !layerToggle() && "Background"}</span>
            </div>
            <div class="MemeMaker-layerActions">
              <button class="MemeMaker-small" onClick={addTextLayer}>
                + Text
              </button>
              <button
                class="MemeMaker-small"
                onClick={() => {
                  pushHistory();
                  setLayers([]);
                }}
              >
                Clear
              </button>
            </div>
          </div>

          <div class="MemeMaker-layerRows scroll_Win">
            {/* THE BACKGROUND "LAYER" ROW */}
            <div
              class={`MemeMaker-layerRow ${selectedLayerId() === "background" ? "MemeMaker-layerRow--active" : ""}`}
              onClick={() => {
                pushHistory();
                selectLayer("background");
              }}
            >
              <div class="MemeMaker-layerRowMain" style="align-items:center;">
                <div class="MemeMaker-layerThumb">BG</div>
                <span class="MemeMaker-layerName">Background Layer</span>
                <div class="MemeMaker-field">
                  <div class="MemeMaker-colorPickerRow" style={{ "--dynamic-bg": bgColor() }}>
                    <input
                      type="color"
                      value={bgColor()}
                      onInput={(e) => {
                        setBgColor(e.target.value);
                        saveToLocal();
                      }}
                      class="MemeMaker-colorInput"
                    />
                    <span class="MemeMaker-colorValue">{bgColor()}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* TEXT LAYERS LOOP */}
            <Index each={layers()}>
              {(layer) => (
                <div class={`MemeMaker-layerRow ${layer().selected ? "MemeMaker-layerRow--active" : ""}`}>
                  <div
                    class="MemeMaker-layerRowMain"
                    onClick={() => {
                      pushHistory();
                      selectLayer(layer().id);
                    }}
                  >
                    <div class="MemeMaker-layerThumb">T</div>
                    <textarea class="MemeMaker-input MemeMaker-layerInput" value={layer().content} rows="1" onInput={(e) => updateLayer(layer().id, { content: e.currentTarget.value })} />
                  </div>

                  <div class="MemeMaker-layerRowRight">
                    <div class="MemeMaker-layerRowControls">
                      <div class="MemeMaker-layerMeta">
                        x:{Math.round(layer().x)} y:{Math.round(layer().y)}
                      </div>
                      <button class="MemeMaker-small" onClick={() => moveLayer(layer().id, "up")}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" style="margin-bottom: -4px;" fill="currentColor" class="bi bi-caret-up" viewBox="0 0 16 16">
                          <path d="M3.204 11h9.592L8 5.519zm-.753-.659 4.796-5.48a1 1 0 0 1 1.506 0l4.796 5.48c.566.647.106 1.659-.753 1.659H3.204a1 1 0 0 1-.753-1.659" />
                        </svg>
                      </button>
                      <button class="MemeMaker-small" onClick={() => moveLayer(layer().id, "down")}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" style="margin-bottom: -4px;" fill="currentColor" class="bi bi-caret-down" viewBox="0 0 16 16">
                          <path d="M3.204 5h9.592L8 10.481zm-.753.659 4.796 5.48a1 1 0 0 0 1.506 0l4.796-5.48c.566-.647.106-1.659-.753-1.659H3.204a1 1 0 0 0-.753 1.659" />
                        </svg>
                      </button>
                      <button
                        class="MemeMaker-small"
                        onClick={() => {
                          pushHistory();
                          deleteLayer(layer().id);
                        }}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" style="margin-bottom: -4px;" fill="currentColor" class="bi bi-trash" viewBox="0 0 16 16">
                          <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z" />
                          <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </Index>
          </div>
        </div>

        <div class="MemeMaker-controls">
          <div class="MemeMaker-controlRow between">
            <group>
              <div class="MemeMaker-splitButtonContainer" use:clickOutside={() => setShowExportMenu(false)}>
                <div class="MemeMaker-splitButtonGroup">
                  <button class="MemeMaker-splitButton main" onClick={handleExport}>
                    Export {exportFormat()} ({exportSize()}px)
                  </button>
                  <button class="MemeMaker-splitButton arrow" onClick={() => setShowExportMenu(!showExportMenu())}>
                    {showExportMenu() ? "▾" : "▴"}
                  </button>
                </div>

                <Show when={showExportMenu()}>
                  <div class="MemeMaker-exportDropdown">
                    <div class="MemeMaker-dropdownColumn">
                      <label>Format</label>
                      <For each={["PNG", "WEBP", "JPEG"]}>
                        {(f) => (
                          <button class={exportFormat() === f ? "active" : ""} onClick={() => setExportFormat(f)}>
                            {f}
                          </button>
                        )}
                      </For>
                    </div>
                    <div class="MemeMaker-dropdownColumn">
                      <label>Size</label>
                      <For each={[350, 700, 1200]}>
                        {(s) => (
                          <button class={exportSize() === s ? "active" : ""} onClick={() => setExportSize(s)}>
                            {s}px
                          </button>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>
              </div>
              &emsp;
              <button
                class="MemeMaker-toggleButton extended"
                onClick={() => {
                  pushHistory();
                  saveToLocal();
                }}
              >
                Save
              </button>
            </group>
            <group>
              <button class="MemeMaker-small" onClick={undo}>
                Undo
              </button>
              <button class="MemeMaker-small" onClick={redo}>
                Redo
              </button>
            </group>
          </div>
          <Show when={selectedLayer()}>
            {(layer) => (
              <>
                <div class="MemeMaker-controlGroup">
                  <div class="MemeMaker-controlRow">
                    <group Radio>
                      <button class={`MemeMaker-toggleButton extended ${expandedControls().has("fonts") ? "MemeMaker-toggleButton--active" : ""}`} onClick={() => toggleControl("fonts", 1)}>
                        FONTS
                      </button>
                      &nbsp;
                      <button class={`MemeMaker-toggleButton extended ${expandedControls().has("textFlow") ? "MemeMaker-toggleButton--active" : ""}`} onClick={() => toggleControl("textFlow", 1)}>
                        TEXT FLOW
                      </button>
                      &nbsp;
                      <button class={`MemeMaker-toggleButton extended ${expandedControls().has("textShadow") ? "MemeMaker-toggleButton--active" : ""}`} onClick={() => toggleControl("textShadow", 1)}>
                        TEXT SHADOW
                      </button>
                    </group>
                  </div>
                </div>
                <Show when={expandedControls().has("fonts")}>
                  <div class="MemeMaker-controlGroup">
                    <div class="MemeMaker-controlRow">
                      <SelectBox
                        direction="up"
                        options={FONTS}
                        value={layer()?.fontFamily}
                        displayValue={layer()?.fontFamily}
                        // filterKey="label" // Search looks at the 'label' property
                        onSelect={(val) => updateLayer(layer()?.id, { fontFamily: val })}
                      >
                        {(items, select) => (
                          <>
                            <div class="SelectBox-group-label">Local Fonts</div>
                            <For each={verifiedFonts().filter((f) => f.hasBold)}>
                              {(f) => (
                                <div class="SelectBox-option-item" style={{ "font-family": f.value }} onClick={() => select(f.value)}>
                                  {f.label}
                                </div>
                              )}
                            </For>

                            <div class="SelectBox-group-label">Online Fonts</div>
                            <For each={verifiedFonts().filter((f) => !f.hasBold)}>
                              {(f) => (
                                <div class="SelectBox-option-item" style={{ "font-family": f.value }} onClick={() => select(f.value)}>
                                  {f.label}
                                </div>
                              )}
                            </For>
                          </>
                        )}
                      </SelectBox>

                      {/* Only show buttons if the current font is marked as 'hasBold' */}
                      {FONTS.find((f) => f.value === layer()?.fontFamily)?.hasBold && (
                        <>
                          <button title="Text Bold" class={`MemeMaker-toggleButton ${layer()?.bold ? "MemeMaker-toggleButton--active" : ""}`} onClick={() => updateLayer(layer()?.id, { bold: !layer()?.bold })}>
                            B
                          </button>
                          <button title="Text Italic" class={`MemeMaker-toggleButton ${layer()?.italic ? "MemeMaker-toggleButton--active" : ""}`} onClick={() => updateLayer(layer()?.id, { italic: !layer()?.italic })}>
                            I
                          </button>
                        </>
                      )}
                      <group>
                        {/* <div class="MemeMaker-labelText">Fill/Stroke</div> */}
                        <input type="color" class="MemeMaker-colorInput" value={layer()?.color} onInput={(e) => updateLayer(layer()?.id, { color: e.currentTarget.value })} />
                        <input type="color" class="MemeMaker-colorInput" value={layer()?.strokeColor} onInput={(e) => updateLayer(layer()?.id, { strokeColor: e.currentTarget.value })} />
                      </group>
                    </div>
                    <div class="MemeMaker-controlRow">
                      <group>
                        <div class="MemeMaker-labelText">Font Size ({layer()?.scale}rem)</div>
                        <input type="range" min="0.2" max="2" step="0.01" value={layer()?.scale} onInput={(e) => updateLayer(layer()?.id, { scale: Number(e.currentTarget.value) })} />
                      </group>
                      <group>
                        <div class="MemeMaker-labelText">Stroke Width ({layer()?.strokeWidth}px)</div>
                        <input type="range" min="0" max="3" step="0.01" value={layer()?.strokeWidth} onInput={(e) => updateLayer(layer()?.id, { strokeWidth: Number(e.currentTarget.value) })} />
                      </group>
                    </div>
                  </div>
                </Show>
                <Show when={expandedControls().has("textFlow")}>
                  <div class="MemeMaker-controlGroup">
                    <div class="MemeMaker-controlRow">
                      <group>
                        <button title="Text Wrap" class={`MemeMaker-toggleButton extended ${layer()?.textWrap ? "MemeMaker-toggleButton--active" : ""}`} onClick={() => updateLayer(layer()?.id, { textWrap: !layer()?.textWrap })}>
                          Text Wrap
                        </button>
                        &emsp; <span style="font-size:0.75rem">Center-X</span> &nbsp;
                        <button title="Center Text" class={`MemeMaker-toggleButton extended`} onClick={() => updateLayer(layer()?.id, { x: 50 })}>
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" style="margin-block-end: -3px;" class="bi bi-arrows-collapse-vertical" viewBox="0 0 16 16">
                            <path d="M8 15a.5.5 0 0 1-.5-.5v-13a.5.5 0 0 1 1 0v13a.5.5 0 0 1-.5.5M0 8a.5.5 0 0 1 .5-.5h3.793L3.146 6.354a.5.5 0 1 1 .708-.708l2 2a.5.5 0 0 1 0 .708l-2 2a.5.5 0 0 1-.708-.708L4.293 8.5H.5A.5.5 0 0 1 0 8m11.707.5 1.147 1.146a.5.5 0 0 1-.708.708l-2-2a.5.5 0 0 1 0-.708l2-2a.5.5 0 0 1 .708.708L11.707 7.5H15.5a.5.5 0 0 1 0 1z" />
                          </svg>
                        </button>
                        &nbsp; <span style="font-size:0.75rem">Center-Y</span> &nbsp;
                        <button title="Center Text" class={`MemeMaker-toggleButton extended`} onClick={() => updateLayer(layer()?.id, { y: 50 })}>
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" style="margin-block-end: -3px;" class="bi bi-arrows-collapse" viewBox="0 0 16 16">
                            <path fill-rule="evenodd" d="M1 8a.5.5 0 0 1 .5-.5h13a.5.5 0 0 1 0 1h-13A.5.5 0 0 1 1 8m7-8a.5.5 0 0 1 .5.5v3.793l1.146-1.147a.5.5 0 0 1 .708.708l-2 2a.5.5 0 0 1-.708 0l-2-2a.5.5 0 1 1 .708-.708L7.5 4.293V.5A.5.5 0 0 1 8 0m-.5 11.707-1.146 1.147a.5.5 0 0 1-.708-.708l2-2a.5.5 0 0 1 .708 0l2 2a.5.5 0 0 1-.708.708L8.5 11.707V15.5a.5.5 0 0 1-1 0z" />
                          </svg>
                        </button>
                      </group>
                    </div>
                    <div class="MemeMaker-controlRow">
                      <group>
                        <div class="MemeMaker-labelText">Text Wrap ({layer()?.wrapWidth}px)</div>
                        <input type="range" min="100" max="600" step="1" value={layer()?.wrapWidth} onInput={(e) => updateLayer(layer()?.id, { wrapWidth: Number(e.currentTarget.value) })} />
                      </group>
                      <group>
                        <div class="MemeMaker-labelText">
                          Line Height ({layer()?.lineHeight}) &emsp;
                          <button onClick={() => updateLayer(layer()?.id, { lineHeight: 1.2 })}>reset</button>
                        </div>
                        <input type="range" min="0.8" max="2" step="0.01" value={layer()?.lineHeight} onInput={(e) => updateLayer(layer()?.id, { lineHeight: Number(e.currentTarget.value) })} />
                      </group>
                      <group>
                        <div class="MemeMaker-labelText">
                          Letter Spacing ({layer()?.letterSpacing}px) &emsp;
                          <button onClick={() => updateLayer(layer()?.id, { letterSpacing: 0 })}>reset</button>
                        </div>
                        <input type="range" min="-2" max="8" step="0.1" value={layer()?.letterSpacing} onInput={(e) => updateLayer(layer()?.id, { letterSpacing: Number(e.currentTarget.value) })} />
                      </group>
                    </div>
                  </div>
                </Show>
                <Show when={expandedControls().has("textShadow")}>
                  <div class="MemeMaker-controlGroup">
                    <div class="MemeMaker-controlRow">
                      <group>
                        <button title="Text Shadow" class={`MemeMaker-toggleButton extended ${layer()?.shadow ? "MemeMaker-toggleButton--active" : ""}`} onClick={() => updateLayer(layer()?.id, { shadow: !layer()?.shadow })}>
                          Text Shadow
                        </button>
                      </group>
                    </div>
                    <div class="MemeMaker-controlRow">
                      <group>
                        <div class="MemeMaker-labelText">Shadow X ({layer()?.shadowX}px)</div>
                        <input type="range" min="-20" max="20" value={layer()?.shadowX} onInput={(e) => updateLayer(layer()?.id, { shadowX: Number(e.currentTarget.value) })} />
                      </group>
                      <group>
                        <div class="MemeMaker-labelText">Shadow Y ({layer()?.shadowY}px)</div>
                        <input type="range" min="-20" max="20" value={layer()?.shadowY} onInput={(e) => updateLayer(layer()?.id, { shadowY: Number(e.currentTarget.value) })} />
                      </group>
                      <group>
                        <div class="MemeMaker-labelText">Shadow Blur ({layer()?.shadowBlur}px)</div>
                        <input type="range" min="0" max="12" step="0.01" value={layer()?.shadowBlur} onInput={(e) => updateLayer(layer()?.id, { shadowBlur: Number(e.currentTarget.value) })} />
                      </group>
                      <group>
                        <div class="MemeMaker-labelText">Shadow Intensity ({layer()?.shadowIntensity})</div>
                        <input type="range" min="0" max="1" step="0.01" value={layer()?.shadowIntensity} onInput={(e) => updateLayer(layer()?.id, { shadowIntensity: Number(e.currentTarget.value) })} />
                      </group>
                      <group>
                        <div class="MemeMaker-labelText">Text Block Intensity ({layer().textBlockIntensity})</div>
                        <input type="range" min="0" max="1" step="0.01" value={layer().textBlockIntensity} onInput={(e) => updateLayer(layer()?.id, { textBlockIntensity: Number(e.currentTarget.value) })} />
                      </group>
                      <group>
                        <div class="MemeMaker-labelText">Text Block Extend Width ({layer().textBlockWidth}px)</div>
                        <input type="range" min="20" max="400" step="1" value={layer().textBlockWidth} onInput={(e) => updateLayer(layer()?.id, { textBlockWidth: Number(e.currentTarget.value) })} />
                      </group>
                    </div>
                  </div>
                </Show>
              </>
            )}
          </Show>
          <Show when={selectedLayerId() === "background"}>
            <div class="MemeMaker-controlGroup">
              <div class="MemeMaker-controlHeader">Image Display</div>

              <div class="MemeMaker-buttonGroup">
                <button class={`MemeMaker-button--toggle ${bgSize() === "contain" ? "active" : ""}`} onClick={() => setBgSize("contain")}>
                  Contain (Show All)
                </button>
                <button class={`MemeMaker-button--toggle ${bgSize() === "cover" ? "active" : ""}`} onClick={() => setBgSize("cover")}>
                  Cover (Fill Area)
                </button>
                <button class={`MemeMaker-button--toggle ${bgSize() === "100% 100%" ? "active" : ""}`} onClick={() => setBgSize("100% 100%")}>
                  Stretch (Distort)
                </button>
              </div>
            </div>

            <div class="MemeMaker-controlGroup">
              <div class="MemeMaker-controlHeader">Frame Edge</div>

              <div class="MemeMaker-buttonGroup">
                <button class={`MemeMaker-button--toggle ${cornerStyle() === "none" ? "active" : ""}`} onClick={() => setCornerStyle("none")}>
                  Square
                </button>
                <button class={`MemeMaker-button--toggle ${cornerStyle() === "round" ? "active" : ""}`} onClick={() => setCornerStyle("round")}>
                  Round
                </button>
                <button class={`MemeMaker-button--toggle ${cornerStyle() === "bevel" ? "active" : ""}`} onClick={() => setCornerStyle("bevel")}>
                  Bevel
                </button>
                <button
                  class={`MemeMaker-button--toggle ${cornerStyle() === "squircle" ? "active" : ""}`}
                  onClick={() => {
                    setCornerStyle("squircle");
                    setAspectRatio("1 / 1");
                  }}
                >
                  Squircle
                </button>
              </div>

              {/* Only show slider if Round or Bevel is selected */}
              {(cornerStyle() === "round" || cornerStyle() === "bevel") && (
                <div class="MemeMaker-sliderWrapper" style={{ "margin-top": "12px" }}>
                  <div class="MemeMaker-controlLabel">
                    <span>Corner Size</span>
                    <span>{cornerSize()}px</span>
                  </div>
                  <input type="range" min="0" max="100" value={cornerSize()} onInput={(e) => setCornerSize(Number(e.target.value))} class="MemeMaker-range" />
                </div>
              )}
            </div>

            <div class="MemeMaker-controlGroup">
              <div class="MemeMaker-controlHeader">Canvas Format</div>

              <div class="MemeMaker-aspectGrid">
                <button
                  class={`MemeMaker-aspectBtn ${aspectRatio() === "1 / 1" ? "active" : ""}`}
                  onClick={() => {
                    setAspectRatio("1 / 1");
                    saveToLocal();
                  }}
                >
                  <div class="ratio-box square"></div>
                  <span>1:1 Square</span>
                </button>

                <button
                  class={`MemeMaker-aspectBtn ${aspectRatio() === "4 / 5" ? "active" : ""}`}
                  onClick={() => {
                    cornerStyle() === "squircle" && setCornerStyle("none");
                    setAspectRatio("4 / 5");
                    saveToLocal();
                  }}
                >
                  <div class="ratio-box portrait"></div>
                  <span>4:5 Insta</span>
                </button>

                <button
                  class={`MemeMaker-aspectBtn ${aspectRatio() === "16 / 9" ? "active" : ""}`}
                  onClick={() => {
                    cornerStyle() === "squircle" && setCornerStyle("none");
                    setAspectRatio("16 / 9");
                    saveToLocal();
                  }}
                >
                  <div class="ratio-box landscape"></div>
                  <span>16:9 X/YT</span>
                </button>

                <button
                  class={`MemeMaker-aspectBtn ${aspectRatio() === "auto" ? "active" : ""}`}
                  onClick={() => {
                    cornerStyle() === "squircle" && setCornerStyle("none");
                    if (!selectedImage()) return;
                    setAspectRatio("auto");
                    saveToLocal();
                  }}
                >
                  <div class="ratio-box auto"></div>
                  <span>Original</span>
                </button>
              </div>
            </div>

            <div class="MemeMaker-controlGroup">
              <div class="MemeMaker-field">
                <div class="MemeMaker-controlHeader">Transform Image</div>
                <div class="MemeMaker-buttonGroup">
                  <button
                    class={`MemeMaker-button--toggle ${flipH() ? "active" : ""}`}
                    onClick={() => {
                      if (!selectedImage()) return;
                      setFlipH(!flipH());
                      saveToLocal();
                    }}
                  >
                    Flip Horizontal ↔
                  </button>
                  <button
                    class={`MemeMaker-button--toggle ${flipV() ? "active" : ""}`}
                    onClick={() => {
                      if (!selectedImage()) return;
                      setFlipV(!flipV());
                      saveToLocal();
                    }}
                  >
                    Flip Vertical ↕
                  </button>
                </div>
              </div>
            </div>
          </Show>

          <div class="MemeMaker-controlGroup">
            <div class="MemeMaker-utilityRow">
              {/* Reset Button */}
              <button class="MemeMaker-button--danger" onClick={resetApp}>
                Reset
              </button>
            </div>
          </div>
        </div>
        <div class="MemeMaker-templates">
          {/* Create New Template Button */}
          <div class="MemeMaker-saveas" onClick={() => handleSaveTemplate(null)}>
            <span style={{ "font-size": "24px" }}>+</span>
            <span style={{ "font-size": "12px", "margin-top": "8px", "text-align": "center" }}>
              Save as New
              <br />
              Template
            </span>
          </div>

          {/* Update Existing Template Button (Conditional) */}
          <Show when={currentTemplateId() !== null}>
            <div class="MemeMaker-template-id" onClick={() => handleSaveTemplate(currentTemplateId())}>
              <span style={{ "font-size": "24px" }}>💾</span>
              <span style={{ "font-size": "12px", "margin-top": "8px", "text-align": "center" }}>
                Update Current
                <br />
                Template
              </span>
            </div>
          </Show>

          {/* The Saved Templates */}
          <For each={templates()}>
            {(t) => (
              <div
                onClick={() => handleApplyTemplate(t)}
                class="MemeMaker-apply-template"
                style={{
                  border: currentTemplateId() === t.id ? "2px solid #4ade80" : "none",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.05)")}
                onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
              >
                {/* Delete Button */}
                <button class="MemeMaker-delete-template-btn" onClick={(e) => handleDeleteTemplate(e, t.id)}>
                  ✕
                </button>

                <img class="MemeMaker-template-img" src={getOptimizedUrl(t.thumbnail)} alt={t.title} />
                <div class="MemeMaker-apply-template-title">{t.title}</div>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}
