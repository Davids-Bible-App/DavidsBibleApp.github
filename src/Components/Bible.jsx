import { createSignal, createResource, createEffect, createMemo, Match, on, For, onCleanup } from "solid-js";
import { settings, registerRefetchers } from "../State/settingsStore.js";
import { updateAndLogScripture } from "../State/historyStore";
import { invoke } from "@tauri-apps/api/core";
import { toggleSheet } from "../State/sheetStore";
import "./CSS/Bible.css";
import { expandedCtl, setExpandedCtl, setActiveCrossRef, isDarkMode } from "../State/globalSignals.js";
import { setBibleVersion, book, chapterNo, targetVerse, targetVerses, setTargetVerses, bookBtn, activePaper, isSecondaryVisible, setActiveNoteVerse } from "../State/globalSignals.js";

function NoteTooltip(props) {
  const note = () => {
    const notes = typeof props.footnotes === "function" ? props.footnotes() : props.footnotes;
    return notes?.find((f) => f.noteId === props.id);
  };

  const popoverId = `note-popover-${props.id}`;
  const anchorName = `--note-anchor-${props.id}`;

  return (
    <>
      <button class="VerseParts-summary" popovertarget={popoverId} style={`anchor-name: ${anchorName};font-size:0.7em;`}>
        &nbsp;{props.id}
      </button>

      <div class="noteId-pop" id={popoverId} popover="auto" style={`position-anchor: ${anchorName};`}>
        {note() ? note().text : `Footnote ${props.id}`}
      </div>
    </>
  );
}

export default function Bible(props) {
  //* For Layout Adjustments - Versioning between BSB & the rest
  const [ver, setVer] = createSignal(false);
  const [verses, setVerses] = createSignal();
  const [footNotes, setFootNotes] = createSignal();

  const [chapters, { refetch: refetchChapters, mutate: mutateChapters }] = createResource(
    () => {
      return {
        translationFile: `${props.bible()}.dba`,
        book: book(),
        chapter: chapterNo(),
      };
    },
    (source) => invoke("get_chapter_data", source),
  );
  registerRefetchers?.({ refetchChapters });

  const [books] = createResource(
    () => invoke("get_books", { translationFile: `${props.bible()}.dba` }),
    (res) => Promise.resolve(res),
  );
  const [translations] = createResource(
    () => invoke("get_translations", { translationFile: `${props.bible()}.dba` }),
    (res) => Promise.resolve(res),
  );

  const activeVersion = createMemo(() => {
    const translation = translations()?.find((t) => t.id === props.bible());
    const bk = books()?.find((b) => b.id === book());
    return { translation, bk };
  });

  const [availableRefs] = createResource(
    () => ({ book: activeVersion()?.bk?.id, chapter: chapterNo() }),
    async ({ book, chapter }) => {
      if (!book || !chapter) return [];
      return await invoke("get_chapter_refs_availability", { bookId: book, chapter });
    },
  );

  const cleanup = registerRefetchers({
    refetchChapters: () => refetchChapters(),
  });

  onCleanup(() => cleanup());

  const handleRefClick = async (verseNumber) => {
    const bookId = activeVersion()?.bk?.id;
    const chapter = chapterNo();
    const verseKey = `${bookId}.${chapter}.${verseNumber}`;

    try {
      const refs = await invoke("get_refs_for_verse", { verseKey });
      if (refs && refs.length > 0) {
        setActiveCrossRef({
          source: `${activeVersion()?.bk?.title} ${chapter}:${verseNumber}`,
          refs: refs,
        });
        toggleSheet("crossref", "Mid");

        updateAndLogScripture({
          translation_id: props.bible(),
          book_id: bookId,
          chapter: chapter,
          verse_id: verseNumber,
        });
      }
    } catch (err) {
      console.error(err);
    }
  };

  // (A) Clear the underlines whenever the user navigates to a different chapter.
  //     { defer: true } means it won't fire on the initial read — only on changes.
  createEffect(
    on(
      chapterNo,
      (ch, prev) => {
        if (prev !== undefined) setTargetVerses(null);
      },
      { defer: true },
    ),
  );

  createEffect(() => {
    if (chapters.state === "ready") {
      setVerses(chapters().content);
      setFootNotes(chapters().footnotes);
    }
    setExpandedCtl(0);
  });

  const [verHeight, setVerHeight] = createSignal();
  const [verLeft, setVerLeft] = createSignal();
  createEffect(() => {
    //* CSS Layout Adjustments - Versioning between BSB & the rest
    setVerHeight(ver() ? -0.6 : 0.5);
    setVerLeft(ver() ? 1 : 0);
  });

  let wasHeading = false;
  return (
    <>
      <div class="paper" classList={{ paperOverlay: activePaper() }}>
        {/* --- NEW SHOW WRAPPER --- */}
        <Show
          when={activeVersion()?.bk}
          fallback={
            <div class="Bible-fallback">
              <h3>This Translation</h3>
              <h3>({activeVersion()?.translation?.english_name})</h3>
              <h4>Does not contain the requested Book ({bookBtn()}).</h4>
            </div>
          }
        >
          {/* --- ORIGINAL BIBLE CONTENT --- */}
          <container
            class="Bible-container"
            style={{
              "font-size": `${settings.fontSize / 2}rem`, // Use the dynamic font size
              "line-height": `${settings.fontSize / 1.3}rem`, // Use the dynamic font size
            }}
          >
            <chapter>
              <div style={!isSecondaryVisible() && settings.titleView && "position: sticky;"} class="Bible-header paper" classList={{ paperOverlay: activePaper() }}>
                <Show
                  when={chapterNo() === 1}
                  fallback={
                    <>
                      <h4>
                        {activeVersion()?.bk?.english_name} - chapter {chapterNo()}
                      </h4>
                    </>
                  }
                >
                  <h4>
                    <em>{activeVersion()?.bk?.title}</em>
                  </h4>
                </Show>
              </div>
              <div class="VerseParts-list-wrap">
                <For each={verses()}>
                  {(verse) => (
                    <Switch fallback={<h3 style="color: tomato;">Oops...Seems Like An Unhandled Error..!</h3>}>
                      <Match when={verse.type === "error"}>
                        <center>
                          <h4 style="color: tomato">{verse.error}</h4>
                        </center>
                      </Match>
                      <Match when={verse.type === "heading"}>
                        <heading>
                          <div class="Bible-headings">
                            <For each={verse.content}>
                              {(part) => (
                                <Switch fallback={part}>
                                  <Match when={typeof part === "string"}>{part}</Match>
                                  <Match when={part.noteId !== undefined}>
                                    <NoteTooltip id={part.noteId} footnotes={footNotes} />
                                    &nbsp;
                                  </Match>
                                  <Match when={part.lineBreak}>
                                    <br />
                                  </Match>
                                </Switch>
                              )}
                            </For>
                          </div>
                        </heading>
                        {(wasHeading = true)}
                      </Match>
                      <Match when={verse.type === "hebrew_subtitle"}>
                        <heading>
                          <center>
                            <h6 style="color: CornflowerBlue">
                              <For each={verse.content}>
                                {(part) => (
                                  <Switch fallback={part}>
                                    <Match when={typeof part === "string"}>{part}</Match>
                                    <Match when={part.noteId !== undefined}>
                                      <NoteTooltip id={part.noteId} footnotes={footNotes} />
                                      &nbsp;
                                    </Match>
                                    <Match when={part.lineBreak}>
                                      <br />
                                    </Match>
                                  </Switch>
                                )}
                              </For>
                            </h6>
                          </center>
                        </heading>
                        {(wasHeading = true)}
                      </Match>
                      <Match when={verse.type === "line_break"}>
                        {!wasHeading && <br />}
                        {(wasHeading = false)}
                      </Match>
                      <Match when={verse.type === "verse"}>{<VerseParts activeVersion={activeVersion()} verse={verse} footNotes={footNotes} itemNo={verse.number} ver={ver} setVer={setVer} availableRefs={availableRefs} onRefClick={handleRefClick} />}</Match>
                    </Switch>
                  )}
                </For>
              </div>
            </chapter>
          </container>
        </Show>
      </div>
      <style>{`
        .Bible-container h4 + br + heading:first-of-type .Bible-headings,
        .Bible-container h4 + heading:first-of-type .Bible-headings {
          margin-left: ${settings.fontSize * verLeft() + "rem"};
          margin-bottom: ${settings.fontSize * verHeight() + "rem"};
        }

        .Bible-container heading + heading .Bible-headings {
          margin-left: ${settings.fontSize * verLeft() + "rem"};
          margin-top: ${settings.fontSize * -0.7 + "rem"};
          margin-bottom: ${settings.fontSize * verHeight() + "rem"};
        }
      `}</style>
    </>
  );
}

function VerseParts(props) {
  let wasHeading = false;
  const [infoDrop, setInfoDrop] = createSignal("");
  const [showInfo, setShowInfo] = createSignal(false);

  const [selected, setSelected] = createSignal(false);

  const footnoteHandler = (e) => {
    e.stopPropagation();
    const noteId = e.target.innerText;
    props.footNotes().find((note) => {
      if (note.noteId == noteId) {
        setInfoDrop((prev) => {
          if (prev === note.text && showInfo()) {
            setShowInfo(false);
          } else if (showInfo()) {
            setShowInfo(false);
            setTimeout(() => setShowInfo(true), 100);
          } else {
            setShowInfo(true);
          }
          return note.text;
        });
      }
    });
  };

  const handleSelection = () => {
    const newState = !selected();
    setSelected(newState);

    setExpandedCtl((ex) => (newState ? ex + 1 : Math.max(0, ex - 1)));
  };

  createEffect(() => {
    expandedCtl() === 0 && setSelected(null);
  });

  // 1. Wrap the logic in an arrow function so it becomes a reactive getter
  const isSidelight = () => (isDarkMode() ? settings.sideLightsDark : settings.sideLightsLight);

  return (
    <>
      <list
        classList={{
          select: selected(),
          "highlight-pulse": props.verse.number === targetVerse(),
          "bookmark-underline": targetVerses()?.includes(props.verse.number),
          highlighted: !!props.verse.highlight,
          "use-sidelights": isSidelight(),
          "use-highlights": !isSidelight(),
        }}
        data-clr={props.verse.highlight || "none"}
        onClick={(e) => {
          if (expandedCtl() > 0) {
            e.stopPropagation();
            handleSelection();
          }
        }}
        onDblClick={(e) => {
          e.stopPropagation();
          if (expandedCtl() === 0) {
            handleSelection();
          }
        }}
        on:pager-long-press={(e) => {
          e.stopPropagation();
          if (expandedCtl() === 0 && !selected()) {
            handleSelection();
          }
        }}
        style={`${!props.ver() ? "display: list-item" : "display: contents"};`}
      >
        <verse classList={props.ver() && { select: selected() }} data-ed={props.activeVersion.translation?.short_name} data-tr={props.activeVersion.translation?.id} data-bk={props.activeVersion.bk?.id} data-ch={chapterNo()} data-vs={props.verse.number} data-clr={props.verse.highlight || "none"}>
          <span
            style={!props.ver() && "display: none"}
            // classList={props.ver() && { verseFL: props.verse.number === 1 }}
          >
            <small style={"color:var(--verseNo); font-weight: var(--verseNoEm);"}>{props.verse.number}.</small>
          </span>
          {(wasHeading = true)}
          <Show when={props.verse.content} fallback={<span>{props.verse.text}&nbsp;</span>}>
            <For each={props.verse.content}>
              {(v) => (
                <Switch fallback={typeof v !== "object" && v !== null && <span>{v}&nbsp</span>}>
                  <Match when={v.lineBreak}>
                    {!wasHeading && <br />}
                    {(wasHeading = false)}
                  </Match>
                  <Match when={v.wordsOfJesus}>
                    <span class={"VerseParts-WordsOfJesus"}>{v.text}&nbsp</span>
                  </Match>
                  <Match when={v.text}>
                    <i> {v.text} </i>
                  </Match>
                  <Match when={v.noteId}>
                    <pre class="VerseParts-summary" onClick={(e) => footnoteHandler(e)}>
                      {v.noteId}
                    </pre>
                    &nbsp
                  </Match>
                  <Match when={v.poem}>
                    <i style="color: pink"> Poem: {v.poem} </i>
                  </Match>
                </Switch>
              )}
            </For>
          </Show>
          <Show when={props.availableRefs()?.includes(props.verse.number)}>
            <span
              class="VerseParts-crossref-trigger"
              onClick={(e) => {
                e.stopPropagation();
                props.onRefClick(props.verse.number);
              }}
            >
              ※
            </span>
          </Show>
          <div classList={{ open: showInfo() }} class="VerseParts-detail">
            {infoDrop()}
          </div>
        </verse>
        <Show when={props.verse.note}>
          <span
            class="VerseParts-note-trigger"
            style="display:inline-flex; align-items:center;cursor:default;pointer-events:none;"
            onClick={(e) => {
              e.stopPropagation();
              setBibleVersion(props.activeVersion.translation?.id);
              setActiveNoteVerse(props.itemNo);
            }}
          >
            <span class="VerseParts-inline-icon">
              📄
              <span class="VerseParts-note-abreviation">{props.verse.note}</span>
            </span>
          </span>
        </Show>
      </list>
      <style>{`
        list {
          &:first-of-type::first-letter {
            /* Main Micro-adjustments */
            margin-right: -1.95rem; /* Spacing between 1st & 2nd letter - Counters padding-right */
            padding: 2rem 2rem 0 0; /* Enough room for image */
            padding-left: ${settings.fontSize * 1 - 0.4 + "rem"}; /* DropCap line position */
            background-size: ${settings.fontSize * 30 + "px"}; /* Needs Padding-top-right & indent, to avoid cuts */
            background-position: -0.5rem ${settings.fontSize * -0.85 + 2 + "rem"}; /* X/Y */
          }
        }
      `}</style>
    </>
  );
}
