import { createSignal, onMount, onCleanup, Show } from "solid-js";
import { pendingVerses, setPendingVerses } from "../State/editorStore";
import { abbreviator, getBook, groupConsecutiveVerses } from "../lib/functions";
import { onSheetClose } from "../State/sheetStore";
import { ask, message, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import "./CSS/Editor.css";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Debounce a function by `ms` milliseconds. */
function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/**
 * DOM-walk HTML → Markdown converter.
 */
function domToMarkdown(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    // Collapse whitespace sequences but keep a single space
    return node.textContent.replace(/\s+/g, " ");
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const tag = node.nodeName.toUpperCase();
  const children = () => Array.from(node.childNodes).map(domToMarkdown).join("");

  switch (tag) {
    case "BR":
      return "\n";
    case "HR":
      return "\n\n---\n\n";
    case "H1":
      return `\n# ${children().trim()}\n`;
    case "H2":
      return `\n## ${children().trim()}\n`;
    case "H3":
      return `\n### ${children().trim()}\n`;
    case "H4":
      return `\n#### ${children().trim()}\n`;
    case "H5":
      return `\n##### ${children().trim()}\n`;
    case "H6":
      return `\n###### ${children().trim()}\n`;
    case "P":
    case "DIV":
      return `\n${children()}\n`;
    case "BLOCKQUOTE": {
      const inner = children()
        .trim()
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n");
      return `\n${inner}\n`;
    }
    case "STRONG":
    case "B":
      return `**${children()}**`;
    case "EM":
    case "I":
      return `*${children()}*`;
    case "U":
      return `<u>${children()}</u>`; // MD has no underline; preserve as HTML
    case "S":
    case "STRIKE":
    case "DEL":
      return `~~${children()}~~`;
    case "A": {
      const href = node.getAttribute("href") || "";
      return `[${children()}](${href})`;
    }
    case "IMG": {
      const src = node.getAttribute("src") || "";
      const alt = node.getAttribute("alt") || "";
      return `![${alt}](${src})`;
    }
    case "CODE":
      return `\`${children().trim()}\``;
    case "PRE":
      return `\n\`\`\`\n${children().trim()}\n\`\`\`\n`;
    case "UL":
      return (
        "\n" +
        Array.from(node.children)
          .map((li) => `- ${domToMarkdown(li).trim()}`)
          .join("\n") +
        "\n"
      );
    case "OL":
      return (
        "\n" +
        Array.from(node.children)
          .map((li, i) => `${i + 1}. ${domToMarkdown(li).trim()}`)
          .join("\n") +
        "\n"
      );
    case "LI":
      return children();
    case "SMALL":
      return `<small>${children()}</small>`;
    case "SPAN":
      // Drop colour/style spans (e.g. verse numbers rendered in CSS var colour)
      // but keep their text content
      return children();
    default:
      return children();
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Editor(props) {
  let editorRef;
  let menuRef;

  const [history, setHistory] = createSignal([]);
  const [historyIndex, setHistoryIndex] = createSignal(-1);
  const [saveStatus, setSaveStatus] = createSignal("");
  const [isMenuOpen, setIsMenuOpen] = createSignal(false);
  const [editorText, setEditorText] = createSignal("");

  // Close popup menu when clicking/tapping outside
  const handleClickOutside = (e) => {
    if (menuRef && !menuRef.contains(e.target)) {
      setIsMenuOpen(false);
    }
  };

  onMount(() => {
    document.addEventListener("pointerdown", handleClickOutside);
    const savedDraft = localStorage.getItem("md-editor-draft");
    if (savedDraft && editorRef) {
      editorRef.innerHTML = savedDraft;
    }
    saveState();
  });

  onCleanup(() => {
    document.removeEventListener("pointerdown", handleClickOutside);
  });

  // -------------------------------------------------------------------------
  // History / draft persistence
  // -------------------------------------------------------------------------

  const saveState = () => {
    if (!editorRef) return;
    const content = editorRef.innerHTML;

    setEditorText(editorRef.innerText || "");

    // Skip identical consecutive states
    if (historyIndex() >= 0 && history()[historyIndex()] === content) return;

    const newHistory = history().slice(0, historyIndex() + 1);
    newHistory.push(content);
    if (newHistory.length > 50) newHistory.shift();

    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    localStorage.setItem("md-editor-draft", content);
  };

  // Debounce: record a history snapshot at most once per 600 ms while typing
  const debouncedSave = debounce(saveState, 600);

  const handleInput = () => debouncedSave();

  // -------------------------------------------------------------------------
  // Paste sanitisation — strips inline styles and unwanted wrapper tags
  // -------------------------------------------------------------------------

  const handlePaste = (e) => {
    e.preventDefault();
    const html = e.clipboardData.getData("text/html");
    const text = e.clipboardData.getData("text/plain");

    if (html) {
      // Parse into a temp DOM, strip all style/class attributes, then re-serialise
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");

      // Remove script / style nodes entirely
      doc.querySelectorAll("script, style, meta, link").forEach((n) => n.remove());

      // Strip style, class, id attributes from everything else
      doc.querySelectorAll("*").forEach((el) => {
        el.removeAttribute("style");
        el.removeAttribute("class");
        el.removeAttribute("id");
      });

      // Grab just the body inner HTML
      const clean = doc.body.innerHTML;
      // execCommand is deprecated but remains the correct way to insert at cursor
      // inside a contenteditable without breaking the native undo stack.
      document.execCommand("insertHTML", false, clean);
    } else {
      // Plain text — convert newlines to <br>
      const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
      document.execCommand("insertHTML", false, escaped);
    }

    saveState();
  };

  // -------------------------------------------------------------------------
  // Keyboard shortcuts
  // -------------------------------------------------------------------------

  const handleKeyDown = (e) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
        return;
      }
      if (e.key === "y") {
        e.preventDefault();
        redo();
        return;
      }
    }

    if (e.key === "Tab") {
      e.preventDefault();
      document.execCommand("insertText", false, "  "); // Insert 2 spaces
    }

    // Double-Enter to exit Blockquote
    if (e.key === "Enter" && !e.shiftKey) {
      const selection = window.getSelection();
      if (!selection.rangeCount) return;

      let node = selection.anchorNode;
      let isInsideQuote = false;

      while (node && node !== editorRef) {
        if (node.nodeName === "BLOCKQUOTE") {
          isInsideQuote = true;
          break;
        }
        node = node.parentNode;
      }

      if (isInsideQuote && selection.anchorNode.textContent.trim() === "") {
        e.preventDefault();
        document.execCommand("outdent", false, null);
        document.execCommand("formatBlock", false, "P");
        saveState();
      }
    }
  };

  // -------------------------------------------------------------------------
  // Undo / Redo
  // -------------------------------------------------------------------------

  const undo = () => {
    if (historyIndex() <= 0) return;
    const newIndex = historyIndex() - 1;
    setHistoryIndex(newIndex);
    editorRef.innerHTML = history()[newIndex];
    localStorage.setItem("md-editor-draft", history()[newIndex]);
  };

  const redo = () => {
    if (historyIndex() >= history().length - 1) return;
    const newIndex = historyIndex() + 1;
    setHistoryIndex(newIndex);
    editorRef.innerHTML = history()[newIndex];
    localStorage.setItem("md-editor-draft", history()[newIndex]);
  };

  // -------------------------------------------------------------------------
  // Mount
  // -------------------------------------------------------------------------

  onMount(() => {
    const savedDraft = localStorage.getItem("md-editor-draft");
    if (savedDraft && editorRef) {
      editorRef.innerHTML = savedDraft;
    }
    saveState();
  });

  onSheetClose("editor", () => {
    editorRef.blur();
  });

  // -------------------------------------------------------------------------
  // Verse template builder  (bug fix: removed the broken chain assignment)
  // -------------------------------------------------------------------------

  const buildVerseTemplate = (inputData = []) => {
    if (!inputData.length) return "";

    const entries = [...inputData];
    let topicMeta = null;

    if (entries[0] && (entries[0].topic !== undefined || entries[0].description !== undefined)) {
      topicMeta = entries.shift();
    }

    let versesHtml = "";
    if (entries.length > 0) {
      const groups = groupConsecutiveVerses(entries, false, true);

      versesHtml = groups
        .map((group) => {
          const first = group[0];
          const last = group[group.length - 1];
          const trans = abbreviator(first.translation);
          const range = group.length > 1 ? `${first.verse}-${last.verse}` : `${first.verse}`;
          const header = `<strong>${getBook(first.book_id)} ${first.chapter}:${range} (${trans})</strong>`;

          let bodyText = group.length > 1 ? group.map((v) => `<span style="color:var(--verseNo)">${v.verse}.</span> ${v.text.trim()}`).join("<br/>") : first.text ? first.text.trim() : "";

          return `<hr/><p>${header}</p><p>${bodyText}</p>`;
        })
        .join("");
    }

    let topicHtml = "";
    if (topicMeta) {
      let headerText = "";
      if (topicMeta.topic) headerText += `<h3>Topic : ${topicMeta.topic}</h3>`;
      if (topicMeta.description) {
        const descHtml = topicMeta.description
          .replace(/\r\n/g, "\n") // normalize CRLF
          .replace(/\n/g, "<br/>") // preserve line breaks in HTML
          .trim();
        headerText += `<p><small><u><b>Topic Description</b></u> : <em>${descHtml}</em></small></p>`;
      }
      topicHtml = `<p class="editor-topic-block">${headerText}</p>`;
    }

    return `${topicHtml}${versesHtml}<br/><br/>`;
  };

  // -------------------------------------------------------------------------
  // Formatting helpers
  // -------------------------------------------------------------------------

  const insertPendingVerses = () => {
    if (!editorRef || pendingVerses().length === 0) return;
    editorRef.focus();
    document.execCommand("insertHTML", false, buildVerseTemplate(pendingVerses()));
    setPendingVerses([]);
    saveState();
  };

  const format = (command, value = null) => {
    document.execCommand(command, false, value);
    editorRef.focus();
    saveState();
  };

  const insertLink = () => {
    const url = prompt("Enter URL:");
    if (url) format("createLink", url);
  };

  const insertImage = () => {
    const url = prompt("Enter Image Path or URL:");
    if (url) format("insertImage", url);
  };

  const toggleHeading = (level) => {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    let node = selection.anchorNode;
    let isAlreadyHeading = false;
    const targetNodeName = `H${level}`;

    while (node && node !== editorRef) {
      if (node.nodeName === targetNodeName) {
        isAlreadyHeading = true;
        break;
      }
      node = node.parentNode;
    }

    document.execCommand("formatBlock", false, isAlreadyHeading ? "P" : targetNodeName);
    editorRef.focus();
    saveState();
  };

  const toggleBlockquote = () => {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    let node = selection.anchorNode;
    let isAlreadyQuote = false;

    while (node && node !== editorRef) {
      if (node.nodeName === "BLOCKQUOTE") {
        isAlreadyQuote = true;
        break;
      }
      node = node.parentNode;
    }

    document.execCommand("formatBlock", false, isAlreadyQuote ? "P" : "BLOCKQUOTE");
    saveState();
  };

  // -------------------------------------------------------------------------
  // Export helpers
  // -------------------------------------------------------------------------

  const getMarkdown = () => {
    if (!editorRef) return "";

    const raw = domToMarkdown(editorRef)
      .split("\n")
      .map((l) => l.trimEnd()) // trim trailing spaces per line
      .join("\n")
      .replace(/\n{3,}/g, "\n\n") // max two consecutive blank lines
      .trim();

    return raw;
  };

  const getHTML = () => {
    if (!editorRef) return "";

    const content = editorRef.innerHTML;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Exported Document</title>
  <style>
    :root {
      --ThemeAccent1: #007acc;
      --text-color: #e0e0e0;
      --text-color-dimmed: #aaaaaa;
      --verseNo: #0098ff;
      --bg-color: #1e1e1e;
    }

    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.6;
      color: var(--text-color);
      background-color: var(--bg-color);
      max-width: 800px;
      margin: 2rem auto;
      padding: 0 1rem;
    }

    /* Content Typography */
    h1 {
      font-size: 2em;
      border-bottom: 1px solid #444;
      padding-bottom: 0.3em;
    }
    h2 {
      font-size: 1.5em;
      border-bottom: 1px solid #444;
      padding-bottom: 0.3em;
    }
    h3 {
      font-size: 1.25em;
    }
    blockquote {
      border-left: 4px solid var(--ThemeAccent1);
      margin: 1em 0;
      padding-left: 16px;
      color: var(--text-color-dimmed);
      font-style: italic;
    }
    img {
      max-width: 100%;
      border-radius: 4px;
    }
    hr {
      border: 0;
      height: 1px;
      background: var(--ThemeAccent1);
      margin: 16px 0;
    }
    a {
      color: var(--ThemeAccent1);
    }

    /* Topic Metadata Block */
    .editor-topic-block {
      margin-bottom: 1.5em;
    }
  </style>
</head>
<body>
  ${content}
</body>
</html>`;
  };

  // -------------------------------------------------------------------------
  // Clipboard
  // -------------------------------------------------------------------------

  const flashStatus = (msg) => {
    setSaveStatus(msg);
    setTimeout(() => setSaveStatus(""), 2000);
  };

  const copyMDToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(getMarkdown());
      flashStatus("MD copied ✓");
    } catch {
      flashStatus("Copy failed ✗");
    }
  };

  const copyHTMLToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(getHTML());
      flashStatus("HTML copied ✓");
    } catch {
      flashStatus("Copy failed ✗");
    }
  };

  // -------------------------------------------------------------------------
  // Save to filesystem via Tauri
  // -------------------------------------------------------------------------

  const saveToFilesystem = async (content, ext, filters) => {
    try {
      const filePath = await saveDialog({
        defaultPath: `document.${ext}`,
        filters,
      });

      if (!filePath) return; // user cancelled

      await writeTextFile(filePath, content);
      flashStatus(`Saved as .${ext} ✓`);
    } catch (err) {
      console.error("Save error:", err);
      await message(`Failed to save: ${err}`, { title: "Save Error", kind: "error" });
    }
  };

  const saveMD = () => saveToFilesystem(getMarkdown(), "md", [{ name: "Markdown", extensions: ["md"] }]);

  const saveHTML = () => saveToFilesystem(getHTML(), "html", [{ name: "HTML", extensions: ["html", "htm"] }]);

  // -------------------------------------------------------------------------
  // Clear
  // -------------------------------------------------------------------------

  const clearEditor = async () => {
    const confirmed = await ask("Clearing the editor cannot be undone!", {
      title: "Clean Slate?",
      kind: "warning",
    });
    if (!confirmed) return;
    editorRef.innerHTML = "<p><br></p>";
    saveState();
  };

  const wordCount = () => {
    const text = editorText().trim();
    return text ? text.split(/\s+/).length : 0;
  };

  const charCount = () => editorText().length;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div class="Editor-Container">
      {/* ── Toolbar ── */}
      <div class="Editor-Toolbar">
        <button onClick={() => format("bold")} title="Bold">
          <b>B</b>
        </button>
        <button onClick={() => format("italic")} title="Italic">
          <i>I</i>
        </button>
        <button onClick={() => format("underline")} title="Underline">
          <u>U</u>
        </button>
        <button onClick={() => format("strikeThrough")} title="Strikethrough">
          <s>S</s>
        </button>

        <div class="divider" />

        <button onClick={() => format("justifyLeft")} title="Align Left">
          ↤
        </button>
        <button onClick={() => format("justifyCenter")} title="Align Centre">
          ↔
        </button>
        <button onClick={() => format("justifyRight")} title="Align Right">
          ↦
        </button>

        <div class="divider" />

        <button onClick={() => toggleHeading(1)}>H1</button>
        <button onClick={() => toggleHeading(2)}>H2</button>
        <button onClick={() => toggleHeading(3)}>H3</button>
        <button onClick={toggleBlockquote} title="Blockquote">
          ❝
        </button>
        <button onClick={() => format("insertHorizontalRule")} title="Horizontal Rule">
          HR
        </button>

        <div class="divider" />

        <button onClick={insertLink} title="Insert Link">
          🔗
        </button>
        <button onClick={insertImage} title="Insert Image">
          🖼
        </button>

        <div class="divider" />

        <button onClick={undo} disabled={historyIndex() <= 0} title="Undo">
          ↩
        </button>
        <button onClick={redo} disabled={historyIndex() >= history().length - 1} title="Redo">
          ↪
        </button>

        {/* Status Toast inside Toolbar */}
        <Show when={saveStatus()}>
          <span class="save-status">{saveStatus()}</span>
        </Show>

        {/* More Options Popover Container */}
        <button popovertarget="editor-more-menu" title="More Options" class="menu-btn menu-anchor">
          <svg width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="12" cy="19" r="2" />
          </svg>
        </button>

        <div id="editor-more-menu" popover="auto" class="dropdown-menu">
          <div class="menu-group-label">Save As</div>
          <button
            class="menu-item"
            onClick={() => {
              saveMD();
              document.getElementById("editor-more-menu")?.hidePopover();
            }}
          >
            <span>Markdown</span> <small>.md</small>
          </button>
          <button
            class="menu-item"
            onClick={() => {
              saveHTML();
              document.getElementById("editor-more-menu")?.hidePopover();
            }}
          >
            <span>HTML</span> <small>.html</small>
          </button>

          <div class="menu-divider" />

          <div class="menu-group-label">Copy As</div>
          <button
            class="menu-item"
            onClick={() => {
              copyMDToClipboard();
              document.getElementById("editor-more-menu")?.hidePopover();
            }}
          >
            <span>Markdown</span>
          </button>
          <button
            class="menu-item"
            onClick={() => {
              copyHTMLToClipboard();
              document.getElementById("editor-more-menu")?.hidePopover();
            }}
          >
            <span>HTML</span>
          </button>

          <div class="menu-divider" />

          <button
            class="menu-item btn-danger"
            onClick={() => {
              clearEditor();
              document.getElementById("editor-more-menu")?.hidePopover();
            }}
          >
            Clear Editor
          </button>
        </div>

        {/* Pending Verses Button */}
        <Show when={pendingVerses().length > 0}>
          <div class="divider" />
          <button onClick={insertPendingVerses} class="btn-accent">
            + {pendingVerses().length} Verses
          </button>
        </Show>
      </div>

      {/* ── Content Area ── */}
      <div ref={editorRef} class="Editor-Content scroll_Win" contenteditable="true" onInput={handleInput} onKeyDown={handleKeyDown} onPaste={handlePaste} placeholder="Start writing or insert verses…" />

      {/* ── Bottom Status Bar ── */}
      <div class="Editor-StatusBar">
        <span class="editor-stats">
          <b>{wordCount()}</b> words &nbsp;|&nbsp; <b>{charCount()}</b> chars
        </span>
      </div>
    </div>
  );
}
