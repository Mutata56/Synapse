import { useCallback, useLayoutEffect, useRef, useState, type UIEvent } from "react";
import { windowRange } from "../lib/tagExplorer";

export function useWindowedRows(count: number, rowHeight: number, resetKey: string, leadingHeight = 0) {
  const ref = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const [viewport, setViewport] = useState({ top: 0, height: 600 });
  const measure = useCallback(() => {
    const element = ref.current; if (!element) return;
    const top = element.scrollTop; const height = Math.max(0, element.clientHeight - leadingHeight);
    setViewport((previous) => previous.top === top && previous.height === height ? previous : { top, height });
  }, [leadingHeight]);
  useLayoutEffect(() => {
    const element = ref.current; if (!element) return;
    measure();
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => { observer.disconnect(); cancelAnimationFrame(frame.current); frame.current = 0; };
  }, [measure]);
  useLayoutEffect(() => { if (ref.current) ref.current.scrollTop = 0; measure(); }, [resetKey, measure]);
  useLayoutEffect(() => { measure(); }, [count, measure]);
  const onScroll = useCallback((_event: UIEvent<HTMLDivElement>) => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => { frame.current = 0; measure(); });
  }, [measure]);
  const reveal = useCallback((index: number) => {
    const element = ref.current; if (!element) return;
    const top = index * rowHeight; const bottom = top + rowHeight + leadingHeight;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (bottom > element.scrollTop + element.clientHeight) element.scrollTop = bottom - element.clientHeight;
    measure();
  }, [rowHeight, leadingHeight, measure]);
  return { ref, onScroll, reveal, height: viewport.height, ...windowRange(count, viewport.top, viewport.height, rowHeight) };
}
