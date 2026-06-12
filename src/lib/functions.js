import { invoke } from "@tauri-apps/api/core";
import { onCleanup } from "solid-js";
import { vibrate, impactFeedback } from "@tauri-apps/plugin-haptics";
import { books } from "../State/globalResource.js";

/**
 * Sorts, groups, and formats verse data into a plain text string.
 * @param {Array} entries - The array of verse objects.
 * @returns {String} - The formatted plain text.
 */
export function groupConsecutiveVerses(entries = [], wrap = false, returnAsArray = false, disableGrouping = false, shouldSort = true) {
  if (!entries || !entries.length) return returnAsArray ? [] : "";

  // If returning an array and grouping is disabled, map each entry to its own group
  if (returnAsArray && disableGrouping) return entries.map((e) => [e]);

  // 1. Map keys to handle data from both components
  const getBk = (v) => v.Bname || getBook(v.book_id) || getBook(v.bk);
  const getCh = (v) => Number(v.chapterNumber) || Number(v.chapter) || Number(v.ch);
  const getVs = (v) => Number(v.number) || Number(v.verse_id) || Number(v.verse) || Number(v.vs);
  const getTr = (v) => v.translation_id || v.translation || v.tr;
  const getEd = (v) => v.shortName || abbreviator(v.translation_id) || abbreviator(v.translation) || v.ed;
  const getText = (v) => v.text || v.tx;

  // 2. Conditionally Sort the entries
  // Turn off sorting, if drag and drop custom order is needed
  let sorted = [...entries];
  if (shouldSort) {
    sorted.sort((a, b) => {
      if (getTr(a) !== getTr(b)) return getTr(a).localeCompare(getTr(b));
      if (getBk(a) !== getBk(b)) return getBk(a).localeCompare(getBk(b));
      if (getCh(a) !== getCh(b)) return getCh(a) - getCh(b);
      return getVs(a) - getVs(b);
    });
  }

  // 3. Group consecutive verses
  const groups = [];
  let currentGroup = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];

    const sameRef = getTr(prev) === getTr(curr) && getBk(prev) === getBk(curr) && getCh(prev) === getCh(curr);

    // Check if verses are sequential
    const isConsecutive = sameRef && getVs(curr) === getVs(prev) + 1;

    if (isConsecutive) {
      currentGroup.push(curr);
    } else {
      groups.push(currentGroup);
      currentGroup = [curr];
    }
  }
  groups.push(currentGroup);

  // If the component requested raw array data (like Gallery.jsx), return it here
  if (returnAsArray) {
    return groups;
  }

  // 4. Format into plain text (for components that expect strings)
  const formattedGroups = groups.map((group) => {
    const first = group[0];
    const last = group[group.length - 1];
    const isSingleVerse = group.length === 1;

    // Format Header
    const refLabel = getVs(first) === getVs(last) ? `${getBk(first)} ${getCh(first)}:${getVs(first)}` : `${getBk(first)} ${getCh(first)}:${getVs(first)}-${getVs(last)}`;

    const translationStr = getEd(first);
    const header = `${refLabel}  (${translationStr})`;

    // Format Verses
    const toWrap = wrap ? " " : "\n";
    const versesText = group
      .map((v) => {
        return isSingleVerse ? getText(v) : `${getVs(v)}. ${getText(v)}`;
      })
      .join(toWrap);

    // Combine Header and Verses
    return `${header}\n${versesText}`;
  });

  // 5. Join different groups
  return formattedGroups.join("\n\n");
}

// book_id to english_name, JAS to James
export const getBook = (bookId) => {
  const match = books()?.find((b) => b.id === bookId);

  if (match) return match.english_name;
};

export const dbaExists = async (exist) => {
  const result = await invoke("get_available_translations");
  return result.includes(exist);
};

export const dbExists = async (exist) => {
  const result = await invoke("get_db_exts");
  // const exists = result.some((d) => d === exist);
  return result.includes(exist);
};

export const triggerHaptic = async (style = "light") => {
  try {
    await impactFeedback(style);
  } catch (error) {
    console.error("Haptics not supported or failed:", error);
  }
};

export function clickOutside(el, accessor) {
  const onClick = (e) => !el.contains(e.target) && accessor()?.();
  document.body.addEventListener("click", onClick);
  onCleanup(() => document.body.removeEventListener("click", onClick));
}

export function abbreviator(v) {
  if (v)
    return v
      .replace(/\.dba$/i, "")
      .replace(/^[a-z]{3}_/i, "")
      .toUpperCase();
}
