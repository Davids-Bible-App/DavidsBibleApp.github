import { createSignal, onMount, Show } from "solid-js";
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
 * Much more reliable than a chain of regexes on raw HTML strings because it
 * handles nesting, inline styles, and mixed content naturally.
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
  const [history, setHistory] = createSignal([]);
  const [historyIndex, setHistoryIndex] = createSignal(-1);
  const [saveStatus, setSaveStatus] = createSignal(""); // "Saved ✓" flash message

  // -------------------------------------------------------------------------
  // History / draft persistence
  // -------------------------------------------------------------------------

  const saveState = () => {
    if (!editorRef) return;
    const content = editorRef.innerHTML;

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
      if (topicMeta.description) headerText += `<p><small><u><b>Topic Description</b></u> : <em>${topicMeta.description}</em></small></p>`;
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

  const getHTML = () => (editorRef ? editorRef.innerHTML : "");

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

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div class="Editor-Container">
      {/* ── Toolbar ── */}
      <div class="Editor-Toolbar">
        {/* Text style */}
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

        {/* Alignment */}
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

        {/* Block format */}
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

        {/* Insert */}
        <button onClick={insertLink} title="Insert Link">
          🔗
        </button>
        <button onClick={insertImage} title="Insert Image">
          🖼
        </button>

        <div class="divider" />

        {/* History */}
        <button onClick={undo} disabled={historyIndex() <= 0} title="Undo (Ctrl+Z)">
          ↩
        </button>
        <button onClick={redo} disabled={historyIndex() >= history().length - 1} title="Redo (Ctrl+Y)">
          ↪
        </button>

        {/* Pending verses */}
        <Show when={pendingVerses().length > 0}>
          <div class="divider" />
          <button onClick={insertPendingVerses} class="btn-accent">
            + {pendingVerses().length} Verses
          </button>
        </Show>
      </div>

      {/* ── Content ── */}
      <div ref={editorRef} class="Editor-Content scroll_Win" contenteditable="true" onInput={handleInput} onKeyDown={handleKeyDown} onPaste={handlePaste} placeholder="Start writing or insert verses…" />

      {/* ── Footer ── */}
      <div class="Editor-Footer">
        {/* Save to file */}
        <div class="footer-group">
          <span class="footer-label">Save</span>
          <button onClick={saveMD} title="Save as Markdown file">
            ↓ .md
          </button>
          <button onClick={saveHTML} title="Save as HTML file">
            ↓ .html
          </button>
        </div>

        {/* Copy to clipboard */}
        <div class="footer-group">
          <span class="footer-label">Copy</span>
          <button onClick={copyMDToClipboard} title="Copy Markdown to clipboard">
            ⎘ MD
          </button>
          <button onClick={copyHTMLToClipboard} title="Copy HTML to clipboard">
            ⎘ HTML
          </button>
        </div>

        {/* Status flash */}
        <Show when={saveStatus()}>
          <span class="save-status">{saveStatus()}</span>
        </Show>

        <button class="btn-danger" onClick={clearEditor}>
          Clear
        </button>
      </div>
    </div>
  );
}
