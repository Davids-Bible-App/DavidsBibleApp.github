import { showToast } from "../Components/Toast";
// prettier-ignore
import {
  book, setBook, setChapterNo, setChapterBtn,
  setBookBtn, setTestamentBtn, bookOrderNo, numberOfChapters,
} from "../State/globalSignals.js";
export default function handlePageChange(direction, helpers) {
  const { books, psr, ssr } = helpers;

  if (direction === 0) return;

  setChapterNo((CPTR) => {
    let chapter = CPTR;
    let bookOrd = bookOrderNo(); // current book order (signal getter)
    let bookId = book(); // current book id

    const goToNextBook = () => {
      const next = books().find((b) => b.order === bookOrd + 1);
      if (next) {
        bookOrd = next.order;
        bookId = next.id;
        chapter = 1;
        setChapterBtn(chapter);
        setBookBtn(next.english_name);
      }
    };

    const goToPrevBook = () => {
      const prev = books().find((b) => b.order === bookOrd - 1);
      if (prev) {
        bookOrd = prev.order;
        bookId = prev.id;
        chapter = prev.chapter_count;
        setChapterBtn(chapter);
        setBookBtn(prev.english_name);
      }
    };

    const current = books().find((b) => b.order === bookOrd);

    if (!current) {
      // console.warn("This book is not available in the selected translation.");

      if (showToast) {
        showToast(`This book is not available in the current translation.`, "warning", 3000);
      }

      return CPTR;
    }

    if (direction === 1) {
      // >>> next
      if (chapter < numberOfChapters()) {
        chapter += 1;
        setChapterBtn(chapter);
        setBookBtn(current.english_name);
        bookOrderNo() <= 39 ? setTestamentBtn("ot") : setTestamentBtn("nt");
      } else {
        goToNextBook();
      }
    } else {
      // <<< previous
      if (chapter > 1) {
        chapter -= 1;
        setChapterBtn(chapter);
        setBookBtn(current.english_name);
        bookOrderNo() <= 39 ? setTestamentBtn("ot") : setTestamentBtn("nt");
      } else {
        goToPrevBook();
      }
    }

    // did we change books?
    if (bookId !== book()) {
      setBook(bookId);
      bookOrderNo() <= 39 ? setTestamentBtn("ot") : setTestamentBtn("nt");
    }

    // scroll to top every time we actually change chapter
    psr()?.scrollTo({ top: 0 });
    ssr()?.scrollTo({ top: 0 });

    return chapter;
  });
}
