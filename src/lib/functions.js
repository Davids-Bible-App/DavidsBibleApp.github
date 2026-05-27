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

// Adds a global event listener to elements matching the selector
// export function addGlobalEventListener(type, selector, callback, parent = document) {
//   parent.addEventListener(type, (e) => {
//     if (e.target.matches(selector)) {
//       callback(e);
//     }
//   });
// }
/*
  * Usage:
  addGlobalEventListener("click", ".box", (e) => {
    e.target.classList.toggle("clicked");
  }, document);

*/

// NOT IN USE
// // 1. Get the current state immediately
// export const isDarkMode = window.matchMedia("(prefers-color-scheme: dark)").matches;
// // console.log(isDarkMode ? "Dark Mode" : "Light Mode");

// // 2. A helper function to return the string
// export function getSystemTheme() {
//   return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
// }

// // 3. Listen for OS changes in real-time
// window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
//   const newTheme = e.matches ? "dark" : "light";
//   console.log(`System theme changed to: ${newTheme}`);

//   // You can trigger your wallpaper logic or store updates here
//   // e.g., setSettings("systemGeneratedTheme", newTheme);
// });

// window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
//   return e === "dark" ? true : false;
// });

/*
const ver = "eng_kjv.dba";
if (ver.startsWith("eng_kjv.dba")) console.log("true");

// Function to show user browser version
export const showUserAgent = () => {
  console.log("User Agent:", navigator.userAgent);
};

// Function to copy text to clipboard
export const copyToClipboard = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    console.log("Text copied to clipboard:", text);
  } catch (err) {
    console.error("Failed to copy text: ", err);
  }
};

// Function to format a date to a readable string
export const formatDate = (date) => {
  const options = { year: "numeric", month: "long", day: "numeric" };
  return new Date(date).toLocaleDateString(undefined, options);
};

// Function to debounce another function
export const debounce = (func, wait) => {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
};

// Function to throttle another function
export const throttle = (func, limit) => {
  let inThrottle;
  return function (...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
};

// Function to generate a random integer between min and max
export const getRandomInt = (min, max) => {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min)) + min; // The maximum is exclusive and the minimum is inclusive
};

// Function to shuffle an array
export const shuffleArray = (array) => {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
};

// Function to capitalize the first letter of a string
export const capitalizeFirstLetter = (string) => {
  return string.charAt(0).toUpperCase() + string.slice(1);
};

// Function to truncate a string to a specified length
export const truncateString = (str, num) => {
  if (str.length <= num) {
    return str;
  }
  return str.slice(0, num) + "...";
};

// Function to convert a string to Title Case
export const toTitleCase = (str) => {
  return str
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

// Function to validate email format
export const validateEmail = (email) => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(String(email).toLowerCase());
};

// Function to validate URL format
export const validateURL = (url) => {
  const pattern = new RegExp(
    "^(https?:\\/\\/)?" + // protocol
      "((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|" + // domain name
      "((\\d{1,3}\\.){3}\\d{1,3}))" + // OR ip (v4) address
      "(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*" + // port and path
      "(\\?[;&a-z\\d%_.~+=-]*)?" + // query string
      "(\\#[-a-z\\d_]*)?$", // fragment locator
    "i",
  );
  return !!pattern.test(url);
};

// Function to get query parameters from URL
export const getQueryParams = (url) => {
  const params = {};
  const parser = new URL(url);
  for (let [key, value] of parser.searchParams.entries()) {
    params[key] = value;
  }
  return params;
};

// Function to serialize an object into a query string
export const serializeQueryParams = (params) => {
  const query = Object.keys(params)
    .map((key) => encodeURIComponent(key) + "=" + encodeURIComponent(params[key]))
    .join("&");
  return query;
};

// Function to deserialize a query string into an object
export const deserializeQueryParams = (queryString) => {
  const params = {};
  const pairs = queryString.split("&");
  for (let pair of pairs) {
    const [key, value] = pair.split("=");
    params[decodeURIComponent(key)] = decodeURIComponent(value || "");
  }
  return params;
};

// Function to format bytes into human-readable format
export const formatBytes = (bytes, decimals = 2) => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
};

// Function to parse JSON safely
export const safeJSONParse = (str, defaultValue = null) => {
  try {
    return JSON.parse(str);
  } catch (e) {
    return defaultValue;
  }
};

// Function to stringify JSON safely
export const safeJSONStringify = (obj, defaultValue = "") => {
  try {
    return JSON.stringify(obj);
  } catch (e) {
    return defaultValue;
  }
};

// Function to delay execution for a specified time
export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Usage: await delay(1000); // delays for 1 second

// Function to get a cookie by name
export const getCookie = (name) => {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(";").shift();
};

// Function to set a cookie
export const setCookie = (name, value, days) => {
  let expires = "";
  if (days) {
    const date = new Date();
    date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
    expires = "; expires=" + date.toUTCString();
  }
  document.cookie = name + "=" + (value || "") + expires + "; path=/";
};

// Function to delete a cookie
export const deleteCookie = (name) => {
  document.cookie = name + "=; Max-Age=-99999999;";
};

// Function to throttle execution of a function
export const throttleFunction = (func, limit) => {
  let lastFunc;
  let lastRan;
  return function (...args) {
    if (!lastRan) {
      func.apply(this, args);
      lastRan = Date.now();
    } else {
      clearTimeout(lastFunc);
      lastFunc = setTimeout(
        () => {
          if (Date.now() - lastRan >= limit) {
            func.apply(this, args);
            lastRan = Date.now();
          }
        },
        limit - (Date.now() - lastRan),
      );
    }
  };
};

// Function to generate a UUID v4
export const generateUUID = () => {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0,
      v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

// Function to validate if a string is a valid JSON
export const isValidJSON = (str) => {
  try {
    JSON.parse(str);
    return true;
  } catch (e) {
    return false;
  }
};

// Function to deep clone an object
export const deepClone = (obj) => {
  return JSON.parse(JSON.stringify(obj));
};

// Function to merge two objects deeply
export const deepMerge = (target, source) => {
  for (const key of Object.keys(source)) {
    if (source[key] instanceof Object) {
      if (!target[key]) Object.assign(target, { [key]: {} });
      deepMerge(target[key], source[key]);
    } else {
      Object.assign(target, { [key]: source[key] });
    }
  }
  return target;
};

// Function to flatten a nested object
export const flattenObject = (obj, parent = "", res = {}) => {
  for (let key in obj) {
    let propName = parent ? parent + "." + key : key;
    if (typeof obj[key] == "object") {
      flattenObject(obj[key], propName, res);
    } else {
      res[propName] = obj[key];
    }
  }
  return res;
};

// Function to unflatten an object
export const unflattenObject = (obj) => {
  const result = {};
  for (let i in obj) {
    const keys = i.split(".");
    keys.reduce((r, e, j) => {
      return r[e] || (r[e] = isNaN(Number(keys[j + 1])) ? (keys.length - 1 === j ? obj[i] : {}) : []);
    }, result);
  }
  return result;
};

// Function to capitalize each word in a string
export const capitalizeWords = (str) => {
  return str.replace(/\b\w/g, (char) => char.toUpperCase());
};

// Function to check if an object is empty
export const isEmptyObject = (obj) => {
  return Object.keys(obj).length === 0 && obj.constructor === Object;
};

// Function to check if two arrays are equal
export const arraysEqual = (arr1, arr2) => {
  if (arr1.length !== arr2.length) return false;
  for (let i = 0; i < arr1.length; i++) {
    if (arr1[i] !== arr2[i]) return false;
  }
  return true;
};

// Function to search deep nested array objects
export const deepSearch = (arr, key, value) => {
  for (let obj of arr) {
    if (obj[key] === value) return obj;
    for (let k in obj) {
      if (typeof obj[k] === "object") {
        const result = deepSearch([obj[k]], key, value);
        if (result) return result;
      }
    }
  }
  return null;
};

// Function to group array of objects by a key
export const groupBy = (arr, key) => {
  return arr.reduce((result, currentValue) => {
    (result[currentValue[key]] = result[currentValue[key]] || []).push(currentValue);
    return result;
  }, {});
};

// Function to sort array of objects by a key
export const sortByKey = (arr, key, ascending = true) => {
  return arr.sort((a, b) => {
    if (a[key] < b[key]) return ascending ? -1 : 1;
    if (a[key] > b[key]) return ascending ? 1 : -1;
    return 0;
  });
};

// Function to paginate an array
export const paginate = (arr, pageSize, pageNumber) => {
  return arr.slice((pageNumber - 1) * pageSize, pageNumber * pageSize);
};
// Usage: const pageItems = paginate(itemsArray, 10, 2); // gets items for page 2 with page size 10

// Function
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Usage: await sleep(2000); // sleeps for 2 seconds

// Function to merge two arrays and remove duplicates
export const mergeUniqueArrays = (arr1, arr2) => {
  return Array.from(new Set([...arr1, ...arr2]));
};
// Usage: const mergedArray = mergeUniqueArrays(array1, array2);

// Function to get current timestamp
export const getCurrentTimestamp = () => {
  return Math.floor(Date.now() / 1000);
};

*/
