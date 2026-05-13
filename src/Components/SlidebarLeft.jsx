import { createSignal, createEffect, onMount, createMemo, on, For } from "solid-js";
import { updateAndLogScripture } from "../State/historyStore";
import { bible1, book, setBook, bookBtn, setBookBtn, chapterBtn, setChapterBtn, setChapterNo, numberOfChapters, setNumberOfChapters, testamentBtn, setTestamentBtn, trigger, setTrigger } from "../State/globalSignals.js";
import "./CSS/SlidebarLeft.css";

// Defaults
const [preSelectBook, setPreSelectBook] = createSignal("JHN");

// -----------------------------
// DUMB COMPONENTS (No Effects, Just UI)
// -----------------------------
export const BooksBtn = (props) => (
  <button id={`book-btn-${props.bookOf}`} class="BooksBtn-btn btn" classList={{ active: props.isActive }} onClick={() => props.setBookBtn(props.bookOf)}>
    {props.bookOf}
  </button>
);

export const ChaptersBtn = (props) => {
  function chapterLoad(chapterNumber) {
    setChapterBtn(chapterNumber);
    setBook(preSelectBook());
    props.psr()?.scrollTo({ top: 0 });
    props.ssr()?.scrollTo({ top: 0 });
    setTrigger("");

    updateAndLogScripture({
      translation_id: bible1(),
      book_id: preSelectBook(),
      chapter: chapterNumber,
      verse_id: 1,
    });
  }

  return (
    <button id={`chap-btn-${props.chapterNumber}`} class="ChaptersBtn-btn btn" classList={{ active: props.isActive }} onClick={() => chapterLoad(props.chapterNumber)}>
      {props.chapterNumber}
    </button>
  );
};

// -----------------------------
// MAIN SIDEBAR
// -----------------------------
export default function SlidebarLeft(props) {
  // 1. Defer rendering to prevent main-thread blocking on startup
  const [isReadyForHeavyDOM, setIsReadyForHeavyDOM] = createSignal(false);

  onMount(() => {
    // A safe wrapper for requestIdleCallback (since older iOS WebViews might lack it)
    const requestIdle = window.requestIdleCallback || ((cb) => setTimeout(cb, 200));

    // The browser will wait until the main UI is fully painted and the CPU is quiet,
    // THEN it will flip this signal, quietly rendering the lists off-screen.
    requestIdle(() => {
      setIsReadyForHeavyDOM(true);
    });
  });

  const filteredBooks = createMemo(() => {
    if (props.books.state !== "ready") return [];
    const books = props.books();
    const testament = testamentBtn();
    return testament === "ot" ? books.filter((b) => b.order <= 39) : testament === "nt" ? books.filter((b) => b.order >= 40) : [];
  });

  const chapterList = createMemo(() => Array.from({ length: numberOfChapters() }, (_, i) => i + 1));

  // State Management Effects
  createEffect(
    on(bookBtn, (bookName) => {
      if (props.books.state !== "ready") return;
      const match = props.books().find((b) => b.english_name === bookName);
      if (match) {
        setNumberOfChapters(match.chapter_count);
        setPreSelectBook(match.id);
      }
    }),
  );

  createEffect(on(chapterBtn, (chapter) => setChapterNo(chapter)));

  createEffect(
    on(book, (bookId) => {
      const match = props.books()?.find((b) => b.id === bookId);
      if (match) setBookBtn(match.english_name);
    }),
  );

  // 2. Centralized Scroll Manager
  // Instead of 100+ effects checking state, ONE effect handles DOM scrolling
  createEffect(() => {
    if (!isReadyForHeavyDOM()) return; // wait for the lists to exist

    const currentBook = bookBtn();
    const currentChap = chapterBtn();

    requestAnimationFrame(() => {
      if (currentBook) {
        document.getElementById(`book-btn-${currentBook}`)?.scrollIntoView({ behavior: "auto", block: "nearest" });
      }
      if (currentChap) {
        document.getElementById(`chap-btn-${currentChap}`)?.scrollIntoView({ behavior: "auto", block: "nearest" });
      }
    });
  });

  // 3. Return pure JSX directly (No createMemo wrap)
  return (
    <aside class="SlidebarLeft-aside" ref={props.ref}>
      <div class="SlidebarLeft-SBcontentWrap">
        <div class="SlidebarLeft-votd">
          <img src="/votd.webp" loading="lazy" /* Switch from eager to lazy if off-screen initially */ decoding="async" alt="Verse of the day background" class="SlidebarLeft-stackImg" classList={{ "SlidebarLeft-animate-image": trigger() === "left" }} />
          <div class="SlidebarLeft-stackText">All things were made by him; and without him was not any thing made that was made.</div>
        </div>

        <div class="SlidebarLeft-selections">
          <div class="SlidebarLeft-col SlidebarLeft-dataBook">
            {isReadyForHeavyDOM() && (
              <For each={filteredBooks()} fallback={<div>No items</div>}>
                {(item) => <BooksBtn setBookBtn={setBookBtn} isActive={bookBtn() === item.english_name} bookOf={item.english_name} />}
              </For>
            )}
          </div>

          <div class="SlidebarLeft-col SlidebarLeft-dataChapter">{isReadyForHeavyDOM() && <For each={chapterList()}>{(n) => <ChaptersBtn chapterNumber={n} isActive={chapterBtn() === n} psr={props.psr} ssr={props.ssr} />}</For>}</div>
        </div>

        <div class="SlidebarLeft-btnBox">
          <button class="SlidebarLeft-btn btn" classList={{ active: testamentBtn() === "ot" }} onClick={() => setTestamentBtn("ot")}>
            Old Testament
          </button>
          <button class="SlidebarLeft-btn btn" classList={{ active: testamentBtn() === "nt" }} onClick={() => setTestamentBtn("nt")}>
            New Testament
          </button>
        </div>
      </div>
      <div class="SlidebarLeft-topShadow"></div>
    </aside>
  );
}
