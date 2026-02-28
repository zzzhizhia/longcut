"use client";

import { useState, useEffect, useCallback } from "react";
import type { TopicGenerationMode } from "@/lib/types";
import { isGrokProviderOnClient } from "@/lib/ai-providers/client-config";

const STORAGE_KEY = "tldw-mode-preference";
const FORCE_SMART_MODE = isGrokProviderOnClient();
const DEFAULT_MODE: TopicGenerationMode = FORCE_SMART_MODE ? "smart" : "fast";

export function useModePreference() {
  const [mode, setMode] = useState<TopicGenerationMode>(DEFAULT_MODE);
  const [isLoading, setIsLoading] = useState(!FORCE_SMART_MODE);

  useEffect(() => {
    if (FORCE_SMART_MODE) {
      setMode("smart");
      setIsLoading(false);
      return;
    }

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "fast" || stored === "smart") {
        setMode(stored);
      }
    } catch (error) {
      console.error("Failed to load mode preference from localStorage:", error);
    }
    setIsLoading(false);
  }, []);

  const updateMode = useCallback(
    (newMode: TopicGenerationMode) => {
      if (FORCE_SMART_MODE) {
        setMode("smart");
        return;
      }

      setMode(newMode);

      try {
        localStorage.setItem(STORAGE_KEY, newMode);
      } catch (error) {
        console.error("Failed to save mode preference to localStorage:", error);
      }
    },
    []
  );

  return {
    mode,
    setMode: updateMode,
    isLoading
  };
}
