// src/State/modalStore.js

import { createSignal, createResource, createRoot, onCleanup } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { registerRefetchers } from "../State/settingsStore.js";
import { selectedTopic } from "./globalSignals.js";

// verses: the full selectedObj array  e.g. [{tr,bk,ch,vs,ed}, ...]
const [bookmarkTarget, setBookmarkTarget] = createSignal(null);
export const openBookmarkModal = (verses) => setBookmarkTarget(verses);
export const closeBookmarkModal = () => setBookmarkTarget(null);
export { bookmarkTarget };

// We execute createRoot and immediately export the returned resources
export const { bms, refetchBookmarks, mutateVerses } = createRoot(() => {
  // 1. Define the fetcher function
  const fetchBookmarks = async () => {
    try {
      return await invoke("get_bookmarks");
    } catch (e) {
      console.error("get_bookmarks error:", e);
      return []; // Fallback value
    }
  };

  // 2. Pass the fetcher to createResource
  const [bmsResource, { refetch, mutate }] = createResource(fetchBookmarks);

  const cleanup = registerRefetchers({ refetchBookmarks: refetch });
  onCleanup(() => cleanup());

  // 3. Return everything you want to export
  return {
    bms: bmsResource,
    refetchBookmarks: refetch,
    mutateVerses: mutate,
  };
});

const [topicTarget, setTopicTarget] = createSignal(null);
export const openTopicModal = (verses) => setTopicTarget(verses);
export const closeTopicModal = () => setTopicTarget(null);
export { topicTarget };

export const { topicVerses, refetchTopicVerses, mutateTopicVerses, topicMetadata, refetchTopicMetadata, mutateTopics } = createRoot(() => {
  const [topicalResource, { refetch: refetchVerses, mutate: mutateVerses }] = createResource(
    () => ({ name: selectedTopic(), reset: false }),
    async ({ name, reset }) => {
      if (!name) return [];
      return await invoke("get_global_gallery", {
        filterType: "topic",
        filterTopic: name,
        resetSort: reset,
      });
    },
  );

  const [metadataResource, { refetch: refetchMeta, mutate: mutateMeta }] = createResource(async () => await invoke("get_topics_metadata"));

  const cleanup = registerRefetchers({
    refetchTopicVerses: refetchVerses,
    refetchTopicMetadata: refetchMeta,
  });
  onCleanup(() => cleanup());

  return {
    topicVerses: topicalResource,
    refetchTopicVerses: refetchVerses,
    mutateTopicVerses: mutateVerses,
    topicMetadata: metadataResource,
    refetchTopicMetadata: refetchMeta,
    mutateTopics: mutateMeta,
  };
});
