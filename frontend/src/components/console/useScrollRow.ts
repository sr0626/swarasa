"use client";

// Shared behaviour of the phone's contained horizontal pill rows: track which
// edges still have hidden content (for the edge fades) and bring the marked
// pill into view when `resetKey` changes (instantly on first paint, smoothly
// afterwards unless the user prefers reduced motion).
import { useCallback, useEffect, useRef, useState } from "react";
import { centerScrollLeft, scrollEdges, type ScrollEdges } from "@/lib/ui/horizontalScroll";

export function useScrollRow<T extends HTMLElement>(resetKey: string, markerSelector: string) {
  const ref = useRef<T>(null);
  const firstRunRef = useRef(true);
  const [edges, setEdges] = useState<ScrollEdges>({ left: false, right: false });

  const measureEdges = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const next = scrollEdges(el.scrollLeft, el.clientWidth, el.scrollWidth);
    setEdges((prev) => (prev.left === next.left && prev.right === next.right ? prev : next));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const marked = el.querySelector<HTMLElement>(markerSelector);
    if (marked && el.scrollWidth > el.clientWidth) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollTo({
        left: centerScrollLeft(marked.offsetLeft, marked.offsetWidth, el.clientWidth, el.scrollWidth),
        behavior: firstRunRef.current || reduce ? "auto" : "smooth",
      });
    } else if (!marked && el.scrollLeft !== 0) {
      el.scrollTo({ left: 0, behavior: "auto" });
    }
    firstRunRef.current = false;
    measureEdges();
    window.addEventListener("resize", measureEdges);
    return () => window.removeEventListener("resize", measureEdges);
  }, [resetKey, markerSelector, measureEdges]);

  return { ref, edges, onScroll: measureEdges };
}
