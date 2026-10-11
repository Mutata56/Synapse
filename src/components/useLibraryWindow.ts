import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { libraryColumns, libraryWindow, type LibraryLayout } from "../lib/noteLibrary";
function contentWidth(element: HTMLDivElement): number {
    const canvas = element.querySelector<HTMLElement>(".library-canvas");
    if (canvas) return canvas.clientWidth;
    const style = getComputedStyle(element);
    return element.clientWidth - parseFloat(style.paddingLeft || "0") - parseFloat(style.paddingRight || "0");
}
export function useLibraryWindow(layout: LibraryLayout, resetKey: string, initialTop = 0, columns = 3, compact = false) {
    const ref = useRef<HTMLDivElement>(null), frame = useRef(0);
    const [viewport, setViewport] = useState({ top: initialTop, height: 600, width: 1000 });
    const restored = useRef(false), initialKey = useRef(resetKey), previousKey = useRef(resetKey);
    const measure = useCallback(() => {
        const element = ref.current;
        if (!element)
            return;
        const next = { top: element.scrollTop, height: element.clientHeight, width: contentWidth(element) };
        setViewport(previous => previous.top === next.top && previous.height === next.height && previous.width === next.width ? previous : next);
    }, []);
    useLayoutEffect(() => {
        const element = ref.current;
        if (!element)
            return;
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => { observer.disconnect(); cancelAnimationFrame(frame.current); frame.current = 0; };
    }, [measure]);
    useLayoutEffect(() => {
        const element = ref.current;
        if (!element) return;
        if (libraryColumns(contentWidth(element), compact) !== columns) { measure(); return; }
        if (!restored.current && (layout.rows.length || resetKey !== initialKey.current)) {
            element.scrollTop = resetKey === initialKey.current ? initialTop : 0;
            restored.current = true;
        } else if (resetKey !== previousKey.current) element.scrollTop = 0;
        previousKey.current = resetKey;
        measure();
    }, [resetKey, layout, initialTop, columns, compact, measure]);
    const onScroll = useCallback(() => {
        if (frame.current)
            return;
        frame.current = requestAnimationFrame(() => { frame.current = 0; measure(); });
    }, [measure]);
    return { ref, onScroll, viewport, ...libraryWindow(layout, viewport.top, viewport.height) };
}
