import { createSignal, onMount, Show } from "solid-js";
import { pendingVerses, setPendingVerses } from "../State/editorStore";
import { abbreviator, getBook, groupConsecutiveVerses } from "../lib/functions";
import { onSheetClose } from "../State/sheetStore";
import { ask } from "@tauri-apps/plugin-dialog";
import "./CSS/Editor.css";

export default function Editor(props) {
  let editorRef;
  const [history, setHistory] = createSignal([]);
  const [historyIndex, setHistoryIndex] = createSignal(-1);

  onMount(() => {
    // Load local storage draft if needed
    const savedDraft = localStorage.getItem("md-editor-draft");
    if (savedDraft && editorRef) {
      editorRef.innerHTML = savedDraft;
    }
    saveState(); // Initialize history
  });

  onSheetClose("editor", () => {
    editorRef.blur();
  });

  const saveState = () => {
    if (!editorRef) return;
    const content = editorRef.innerHTML;

    // Don't save if it's the exact same as current state
    if (historyIndex() >= 0 && history()[historyIndex()] === content) return;

    const newHistory = history().slice(0, historyIndex() + 1);
    newHistory.push(content);

    // Keep last 50 states
    if (newHistory.length > 50) newHistory.shift();

    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    localStorage.setItem("md-editor-draft", content);
  };

  const handleInput = () => saveState();

  const handleKeyDown = (e) => {
    // 1. Keep your existing Undo/Redo logic
    if (e.ctrlKey || e.metaKey) {
      if (e.key === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
        return;
      }
    }

    // 2. Double-Enter to exit Blockquote
    if (e.key === "Enter" && !e.shiftKey) {
      const selection = window.getSelection();
      if (!selection.rangeCount) return;

      let node = selection.anchorNode;
      let isInsideQuote = false;

      // Walk up to find if the cursor is inside a blockquote
      while (node && node !== editorRef) {
        if (node.nodeName === "BLOCKQUOTE") {
          isInsideQuote = true;
          break;
        }
        node = node.parentNode;
      }

      if (isInsideQuote) {
        // If the current line's text is empty, this is the 'Double Enter'
        // Browsers often put a zero-width space or nothing in an empty line
        const text = selection.anchorNode.textContent.trim();

        if (text === "") {
          e.preventDefault(); // Stop the browser from adding another line inside the quote

          // 'outdent' is the magic command that breaks a line out of a quote/list
          document.execCommand("outdent", false, null);

          // Ensure the new line is a standard paragraph
          document.execCommand("formatBlock", false, "P");

          saveState();
        }
      }
    }
  };

  const undo = () => {
    if (historyIndex() > 0) {
      const newIndex = historyIndex() - 1;
      setHistoryIndex(newIndex);
      editorRef.innerHTML = history()[newIndex];
      localStorage.setItem("md-editor-draft", history()[newIndex]);
    }
  };

  const redo = () => {
    if (historyIndex() < history().length - 1) {
      const newIndex = historyIndex() + 1;
      setHistoryIndex(newIndex);
      editorRef.innerHTML = history()[newIndex];
      localStorage.setItem("md-editor-draft", history()[newIndex]);
    }
  };

  const buildVerseTemplate = (inputData = []) => {
    if (!inputData.length) return "";

    // 1. Clone the array so we don't mutate the original dataset
    const entries = [...inputData];
    let topicMeta = null;

    // 2. Check if the first item is the topic/description object
    // We identify it by checking for the 'topic' key or the absence of a 'book_id'
    if (entries[0] && (entries[0].topic !== undefined || entries[0].description !== undefined)) {
      topicMeta = entries.shift(); // Removes the first item from 'entries' and stores it
    }

    // 3. Process the remaining verses as normal
    let versesHtml = "";
    if (entries.length > 0) {
      const groups = groupConsecutiveVerses(entries, false, true);

      versesHtml = groups
        .map((group) => {
          const first = group[0];
          const last = group[group.length - 1];
          const trans = abbreviator(first.translation);

          // Create Header: "MAT 3:4" or "MAT 3:13-15"
          const range = group.length > 1 ? `${first.verse}-${last.verse}` : `${first.verse}`;
          const header = `<strong>${getBook(first.book_id)} ${first.chapter}:${range} (${trans})</strong>`;

          // Create Body: Add numbers if it's a group, otherwise just text
          let bodyText = "";
          if (group.length > 1) {
            bodyText = group
              .map((v) => `<span style="color:var(--verseNo)">${v.verse}.</span> ${v.text.trim()}`)
              .join("<br/>");
          } else {
            bodyText = first.text ? first.text.trim() : "";
          }

          return `
            <hr/>
            <p>${header}</p>
            <p>${bodyText}</p>
          `;
        })
        .join("");
    }

    // 4. Construct the final output combining Topic and Verses
    let finalHtml = "";

    if (topicMeta) {
      let headerText = "";
      if (topicMeta.topic) headerText += `<h3>Topic : ${topicMeta.topic}</h3>`;
      if (topicMeta.description)
        headerText += `<p><small><u><b>Topic Description</b></u> : <em>${topicMeta.description}</em></small></p>`;

      finalHtml += `
      <p class="editor-topic-block">
        ${headerText}
      </p>
    `;
    }

    let beforeInsert = ``;
    let afterInsert = `<br/><br/>`;

    beforeInsert += finalHtml += versesHtml += afterInsert;

    return finalHtml;
  };

  const insertPendingVerses = () => {
    if (!editorRef || pendingVerses().length === 0) return;

    const htmlToInsert = buildVerseTemplate(pendingVerses());

    editorRef.focus();

    // This is the cleanest way to insert HTML at the cursor
    // without breaking the browser's undo/redo stack
    document.execCommand("insertHTML", false, htmlToInsert);

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

    // Walk up the DOM tree to see if we are inside this specific heading
    while (node && node !== editorRef) {
      if (node.nodeName === targetNodeName) {
        isAlreadyHeading = true;
        break;
      }
      node = node.parentNode;
    }

    if (isAlreadyHeading) {
      // If inside the heading, convert it back to a normal paragraph
      document.execCommand("formatBlock", false, "P");
    } else {
      // Otherwise, turn it into the requested heading
      document.execCommand("formatBlock", false, targetNodeName);
    }

    editorRef.focus();
    saveState();
  };

  const insertHR = () => {
    format("insertHorizontalRule");
  };

  // Basic HTML to Markdown parser
  const exportToMD = () => {
    if (!editorRef) return;

    let html = editorRef.innerHTML;

    let md = html
      // 1. Convert breaks and block elements to handle spacing
      .replace(/<br\s*[\/]?>/gi, "\n")
      .replace(/<p([\s\S]*?)>([\s\S]*?)<\/p>/gi, "\n$2\n")
      .replace(/<div([\s\S]*?)>([\s\S]*?)<\/div>/gi, "\n$2\n")

      // 2. Headings
      .replace(/<h1>([\s\S]*?)<\/h1>/gi, "\n# $1\n")
      .replace(/<h2>([\s\S]*?)<\/h2>/gi, "\n## $1\n")
      .replace(/<h3>([\s\S]*?)<\/h3>/gi, "\n### $1\n")

      // 3. Bold/Strong & Italics
      .replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, "**$2**")
      .replace(/<(em|i)>([\s\S]*?)<\/\1>/gi, "*$2*")

      // 4. Horizontal Rule: Add TWO newlines BEFORE and AFTER
      // This ensures a blank line exists between the previous verse and the line
      .replace(/<hr\s*[\/]?>/gi, "\n\n---\n\n")

      // 5. Blockquotes (Ensure no leading spaces inside the quote)
      .replace(/<blockquote>([\s\S]*?)<\/blockquote>/gi, (_, content) => {
        const cleanContent = content.replace(/<\/?[^>]+(>|$)/g, "").trim();
        return "\n> " + cleanContent + "\n";
      })

      // 6. Paragraphs: Ensure every paragraph ends with two newlines
      // This creates the "Presentation" spacing you're looking for
      .replace(/<p([\s\S]*?)>([\s\S]*?)<\/p>/gi, "$2\n\n")

      // 7. Strip all remaining HTML tags
      .replace(/<\/?[^>]+(>|$)/g, "");

    // 8. THE FIX: Trim every single line and clean up whitespace
    const finalMd = md
      .split("\n")
      .map((line) => line.trim()) // This removes that leading whitespace from Image 1
      .join("\n")
      .replace(/\n{3,}/g, "\n\n"); // Keep it to max 2 newlines

    console.log("Exported MD:\n", finalMd.trim());
    return finalMd.trim();
  };

  const exportToHTML = () => {
    console.log("Exported HTML:\n", editorRef.innerHTML);
    return editorRef.innerHTML;
  };

  const clearEditor = async () => {
    const confirmed = await ask(`Clearing the editor, cannot be undone!`, {
      title: "Clean Slate?",
      kind: "warning",
    });
    if (!confirmed) return;

    // Provide a default empty paragraph structural baseline
    editorRef.innerHTML = "<p><br></p>";
    saveState(); // Don't forget to save this to history/localstorage!
  };

  const toggleBlockquote = () => {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    let node = selection.anchorNode;
    let isAlreadyQuote = false;

    // Walk up the DOM tree to see if we are inside a blockquote
    while (node && node !== editorRef) {
      if (node.nodeName === "BLOCKQUOTE") {
        isAlreadyQuote = true;
        break;
      }
      node = node.parentNode;
    }

    if (isAlreadyQuote) {
      // If inside a quote, convert it back to a normal paragraph
      document.execCommand("formatBlock", false, "P");
    } else {
      // Otherwise, turn it into a quote
      document.execCommand("formatBlock", false, "BLOCKQUOTE");
    }

    saveState();
  };

  return (
    <div class="Editor-Container">
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
        <button onClick={() => format("strikeThrough")} title="Strikeout">
          <s>S</s>
        </button>

        <div class="divider"></div>

        <button onClick={() => format("justifyLeft")} title="Align Left">
          ↤
        </button>
        <button onClick={() => format("justifyCenter")} title="Align Center">
          ↔
        </button>
        <button onClick={() => format("justifyRight")} title="Align Right">
          ↦
        </button>

        <div class="divider"></div>

        <button onClick={() => toggleHeading(1)}>H1</button>
        <button onClick={() => toggleHeading(2)}>H2</button>
        <button onClick={() => toggleHeading(3)}>H3</button>
        <button onClick={toggleBlockquote} title="Quote">
          Quote
        </button>

        <div class="divider"></div>

        <button onClick={insertLink}>Link</button>
        <button onClick={insertImage}>Image</button>
        <button onClick={insertHR}>HR</button>

        <div class="divider"></div>

        <button onClick={undo} disabled={historyIndex() <= 0}>
          Undo
        </button>
        <button onClick={redo} disabled={historyIndex() >= history().length - 1}>
          Redo
        </button>

        <Show when={pendingVerses().length > 0}>
          <div class="divider"></div>
          <button
            onClick={insertPendingVerses}
            style="background-color: var(--ThemeAccent1); color: white; font-weight: bold; border-radius: 4px;"
          >
            + Insert {pendingVerses().length} Verses
          </button>
        </Show>
      </div>

      <div
        ref={editorRef}
        class="Editor-Content scroll_Win"
        contenteditable="true"
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        placeholder="Start writing or insert verses..."
      ></div>

      <div class="Editor-Footer">
        <div>
          <button onClick={exportToMD}>Log MD</button>
          <button onClick={exportToHTML}>Log HTML</button>
        </div>
        <button onClick={clearEditor}>Clear Editor</button>
      </div>
    </div>
  );
}
