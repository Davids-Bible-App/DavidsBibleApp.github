import { createEffect, createResource, createSignal, onMount, For, Show, Suspense } from "solid-js";
import { createStore } from "solid-js/store";
import { setExpandedCtl, setShowSelection, selection } from "../State/globalSignals.js";
import { Portal } from "solid-js/web";
import { Transition } from "solid-transition-group";
import Editions from "./Editions.jsx";

import { invoke } from "@tauri-apps/api/core";
import "./CSS/CompareVerse.css";

const [bookId, setbookId] = createSignal("JHN");
const [chapterNumber, setChapterNumber] = createSignal(1);
const [verseNumber, setVerseNumber] = createSignal(1);
const [verseNumbers, setVerseNumbers] = createSignal("1");
const [files, setFiles] = createStore([]);

const loadFiles = async () => {
  try {
    const result = await invoke("get_available_translations");
    const formattedFiles = result.map((fileName) => ({
      edition: fileName.replace(/\.dba$/, ""),
      isActive: false,
    }));
    setFiles(formattedFiles);
  } catch (e) {
    console.error("Error listing files:", e);
  }
};

export default function CompareVerse(props) {
  const [edition, setEdition] = createSignal("eng_kjv"); // Default Bible Version
  const [numberOfVerses, setNumberOfVerses] = createSignal(1);
  const [activeTab, setActiveTab] = createSignal(true);

  onMount(() => {
    loadFiles();
    setEdition(selection()[0]?.tr);
    setbookId(selection()[0]?.bk);
    setChapterNumber(parseInt(selection()[0]?.ch));
    setVerseNumber(parseInt(selection()[0]?.vs));
    setVerseNumbers([...new Set(selection()?.map((v) => parseInt(v.vs)))]);
  });

  const [verseOne] = createResource(
    () =>
      invoke("get_verse", {
        t: `${edition()}.dba`,
        b: bookId(),
        c: chapterNumber(),
        v: verseNumber(),
      }),
    (res) => Promise.resolve(res),
  );

  createEffect(() => {
    if (verseOne.state === "ready") {
      setNumberOfVerses(verseOne()?.total_verses);
    }
  });

  const pager = (direction) => {
    if (direction === 1) {
      //* >>> next
      verseNumber() < numberOfVerses() && setVerseNumber((v) => (v += 1));
    } else {
      //* <<< prev
      verseNumber() > 1 && setVerseNumber((v) => (v -= 1));
    }
  };

  return (
    <>
      <Portal>
        <Transition name="compare" appear>
          <div class="CompareVerse-compare-stack">
            <div class="CompareVerse-topWrap">
              <Editions mountVer={selection()[0]?.tr} files={files} setFiles={setFiles} />
              <div class="CompareVerse-btnWrap">
                <button class="CompareVerse-mode" onClick={() => setActiveTab(!activeTab())}>
                  Mode
                </button>
              </div>
              <div class="CompareVerse-btnWrap">
                <button
                  class="CompareVerse-close"
                  onClick={() => {
                    setShowSelection(false);
                    setExpandedCtl(0);
                  }}
                >
                  Close
                </button>
              </div>
            </div>
            <div>
              <div>
                <div class="CompareVerse-btnWrap">
                  <Show when={!activeTab()}>
                    <button class="CompareVerse-prev" onClick={() => pager(-1)}>
                      Prev
                    </button>
                    <button class="CompareVerse-next" onClick={() => pager(1)}>
                      Next
                    </button>
                  </Show>
                </div>
              </div>
              <div class="CompareVerse-bkchvs">
                <span>{verseOne()?.BeName}&nbsp;</span>
                {activeTab() && <span> Chapter </span>}
                <span>{verseOne()?.chapterNumber}</span>
                {!activeTab() && <span>:{verseOne()?.number}</span>}
              </div>
            </div>
            <div class="CompareVerse-tabWrap">
              <Switch>
                <Match when={!activeTab()}>
                  <div class="CompareVerse-compared-wrap">
                    <Suspense>
                      <For each={files}>
                        {(f) => (
                          <Show when={f?.isActive}>
                            <Verse edition={f?.edition} />
                          </Show>
                        )}
                      </For>
                    </Suspense>
                  </div>
                </Match>
                <Match when={activeTab()}>
                  <div class="CompareVerse-compared-wrap">
                    <Suspense>
                      <For each={files}>
                        {(f) => (
                          <Show when={f.isActive}>
                            <Verses edition={f.edition} selection={selection} />
                          </Show>
                        )}
                      </For>
                    </Suspense>
                  </div>
                </Match>
              </Switch>
            </div>
          </div>
        </Transition>
      </Portal>
    </>
  );
}

const Verse = (props) => {
  const [edition, setEdition] = createSignal("eng_kjv");

  const [verseOne] = createResource(
    () =>
      invoke("get_verse", {
        t: `${edition()}.dba`,
        b: bookId(),
        c: chapterNumber(),
        v: verseNumber(),
      }),
    (res) => Promise.resolve(res),
  );

  createEffect(() => {
    if (verseOne.state === "ready") {
      setEdition(props.edition);
    }
  });

  return (
    <>
      <Show when={verseOne.state === "ready" && verseOne()}>
        <div class="CompareVerse-item">
          <h5 style={"color:var(--verseNo);"}>
            {verseOne()?.name} ({verseOne()?.shortName})
          </h5>
          <span>{verseOne()?.text}</span>
        </div>
      </Show>
    </>
  );
};

const Verses = (props) => {
  const [edition, setEdition] = createSignal("eng_kjv");

  const [verseMany] = createResource(
    () =>
      invoke("get_verses", {
        t: `${edition()}.dba`,
        b: bookId(),
        c: chapterNumber(),
        vs: verseNumbers(),
      }),
    (res) => Promise.resolve(res),
  );

  createEffect(() => {
    if (verseMany.state === "ready") {
      setEdition(props.edition);
    }
  });

  return (
    <>
      <Show when={verseMany.state === "ready" && verseMany()[0]}>
        <div class="CompareVerse-item" style={`--row-count: calc(${selection().length} + 1);`}>
          <h5 style={"color:var(--verseNo);"}>
            {verseMany()?.[0].name} ({verseMany()?.[0].shortName})
          </h5>
          <For each={verseMany()}>
            {(v) => {
              return (
                <span>
                  <small style={"color:var(--verseNo); font-weight: var(--verseNoEm);"}>{v.number}.</small>
                  {v.text}
                </span>
              );
            }}
          </For>
        </div>
      </Show>
    </>
  );
};
