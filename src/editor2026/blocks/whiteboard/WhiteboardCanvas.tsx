// src/editor2026/blocks/whiteboard/WhiteboardCanvas.tsx
//
// React-обёртка над vanilla WhiteboardEngine. React тут делает только:
//   1. маунтит один <canvas> и передаёт его в WhiteboardEngine через ref,
//   2. держит backing store canvas в размер CSS-бокса * devicePixelRatio
//      (ResizeObserver + listener на смену DPR),
//   3. хостит плавающий <Toolbox> (управляется из движка императивно),
//   4. хостит text-edit <textarea> overlay, позиционируемый engine.onTextEdit.
//
// React НИКОГДА не рисует. Движок владеет шейпами, камерой, rAF-циклом
// и dirty-флагом, живёт целиком вне React state. Мы перерисовываем React
// только чтобы (а) переместить/показать textarea и (б) дернуть `tick`
// чтобы Toolbox перечитал геттеры движка (tool/color/zoom/undo) после
// коммита. См. `onState`.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { WhiteboardEngine } from "./engine";
import type { Board } from "./model";
import Toolbox from "./Toolbox";
import NodeOverlay, { type NodeOverlayState } from "./NodeOverlay";
import BoardContextMenu, {
  type ContextMenuState,
  type StylePatch,
} from "./BoardContextMenu";
import { exportBoardPng } from "./exportImage";
import { useToastStore } from "../../../store/toasts";

export type TextEditReq = {
  id: string;
  screenX: number;
  screenY: number;
  value: string;
  fontPx: number;
  color: string;
  /** Редактор edge-label (центрированный opaque chip, в отличие от
   *  прозрачного in-place редактора для canvas text shapes). */
  chip?: boolean;
};

export type WhiteboardCanvasProps = {
  board: Board;
  onChange: (b: Board) => void;
};

export default function WhiteboardCanvas({ board, onChange }: WhiteboardCanvasProps) {
  // Два стаканных canvas (слоёная архитектура рендера):
  //   * `worldCanvasRef` (нижний слой, pointer-events:none): сетка + edges +
  //     спрайты нод. Перерисовывается ТОЛЬКО при структурном изменении/зуме/
  //     ресайзе; при чистом пане движок просто CSS-транслирует элемент (без
  //     пиксельной работы). Увеличен на WORLD_PAD по каждой стороне, чтобы
  //     маленькие паны не обнажали пустоту на краю viewport.
  //   * `canvasRef` (верхний слой): выделение / маркиз / черновик / link UI /
  //     направляющие / бейджи локов. Перерисовывается каждый кадр (дёшево,
  //     почти всегда пусто). Принимает все pointer-события, проводка
  //     event-ов движка осталась тут без изменений.
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldCanvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<WhiteboardEngine | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // `tick` -- дешёвый триггер перерисовки, чтобы Toolbox перечитывал геттеры
  // движка после отчёта о смене состояния. Данные по-прежнему от движка.
  const [, setTick] = useState(0);
  const [textEdit, setTextEdit] = useState<TextEditReq | null>(null);
  const [nodeOverlay, setNodeOverlay] = useState<NodeOverlayState | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Последний onChange в ref, чтобы движок (созданный один раз) всегда вызывал
  // актуальный хендлер, не пересоздаваясь при смене проп-идентичности.
  const onChangeRef = useRef(onChange);
  useLayoutEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // ── жизненный цикл движка (создаём один раз при маунте) ─────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const worldCanvas = worldCanvasRef.current;
    if (!canvas || !worldCanvas) return;

    const engine = new WhiteboardEngine(canvas, worldCanvas, {
      board,
      onChange: (b) => onChangeRef.current(b),
      onState: () => setTick((t) => (t + 1) & 0xffff),
    });
    engineRef.current = engine;

    // Хэндшейк текстового редактора: движок просит показать/спрятать/переместить textarea.
    engine.onTextEdit = (req) => setTextEdit(req);
    // Хэндшейк нод-оверлея: движок просит открыть SQL / action / note
    // редактор для ноды flowchart (данные, которые canvas намеренно не рисует).
    engine.onNodeActivate = (req) => setNodeOverlay(req);
    // Хэндшейк контекстного меню. Говорим движку когда меню открыто, чтобы
    // его Escape-обработчик уступал панели/пикеру вместо сброса выделения.
    engine.onContextRequest = (req) => {
      engine.setMenuOpen(req !== null);
      setContextMenu(req);
    };

    // Начальный resize перед первым кадром (engine.resize читает CSS-бокс canvas).
    engine.resize();

    return () => {
      engine.onTextEdit = undefined;
      engine.onNodeActivate = undefined;
      engine.onContextRequest = undefined;
      engine.destroy();
      engineRef.current = null;
    };
    // Намеренно mount-once: `board` это НАЧАЛЬНЫЙ документ. Живые правки
    // идут через onChange, движок становится source of truth.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── держим canvas в размер CSS-бокса * DPR ─────────────────────────────
  useEffect(() => {
    const wrap = wrapRef.current;
    const engine = engineRef.current;
    if (!wrap || !engine) return;

    const ro = new ResizeObserver(() => engine.resize());
    ro.observe(wrap);

    // devicePixelRatio может смениться при перемещении окна между мониторами
    // или при смене системного зума; matchMedia на текущий dpr срабатывает
    // один раз при изменении.
    let mql: MediaQueryList | null = null;
    const onDpr = () => {
      engine.resize();
      attachDprListener();
    };
    const attachDprListener = () => {
      if (mql) mql.removeEventListener("change", onDpr);
      mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      mql.addEventListener("change", onDpr);
    };
    attachDprListener();

    return () => {
      ro.disconnect();
      if (mql) mql.removeEventListener("change", onDpr);
    };
  }, []);

  // ── текстовый оверлей: фокус + autosize при поступлении запроса ──────────
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta || !textEdit) return;
    autosize(ta);
    // Откладываем фокус чтобы элемент успел отрисоваться; select-all для
    // быстрой замены.
    const raf = requestAnimationFrame(() => {
      ta.focus();
      ta.select();
    });
    return () => cancelAnimationFrame(raf);
    // Ключ по IDENTITY оверлея (id), а не по всему объекту: движок
    // перевыпускает textEdit со свежими координатами каждый кадр пана/зума,
    // чтобы textarea СЛЕДОВАЛА за шейпом. Но эти перемещения НЕ должны
    // рефокусить или ре-выделять пока юзер печатает. Новый id (другой шейп)
    // -- да.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textEdit?.id]);

  const commitTextEdit = useCallback(() => {
    const req = textEdit;
    const ta = textareaRef.current;
    const engine = engineRef.current;
    if (!req || !engine) return;
    engine.commitText(req.id, ta ? ta.value : req.value);
    setTextEdit(null);
  }, [textEdit]);

  const commitNodeOverlay = useCallback(
    (id: string, patch: { title?: string; query?: string; label?: string; text?: string }) => {
      engineRef.current?.updateNodeData(id, patch);
      engineRef.current?.clearNodeOverlay();
      setNodeOverlay(null);
    },
    [],
  );
  const closeNodeOverlay = useCallback(() => {
    engineRef.current?.clearNodeOverlay();
    setNodeOverlay(null);
  }, []);

  const closeContext = useCallback(() => {
    engineRef.current?.setMenuOpen(false);
    setContextMenu(null);
  }, []);
  const ctxStyle = useCallback(
    (patch: StylePatch) => engineRef.current?.setSelectionStyle(patch),
    [],
  );
  const ctxZFront = useCallback(
    () => engineRef.current?.bringSelectionToFront(),
    [],
  );
  const ctxZBack = useCallback(() => engineRef.current?.sendSelectionToBack(), []);
  const ctxDuplicate = useCallback(
    () => engineRef.current?.duplicateSelection(),
    [],
  );
  const ctxToggleLock = useCallback(
    () => engineRef.current?.toggleLockSelection(),
    [],
  );
  const ctxDelete = useCallback(() => engineRef.current?.deleteSelection(), []);

  const onExport = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;
    const push = useToastStore.getState().push;
    try {
      const saved = await exportBoardPng(engine.getBoard());
      // null = юзер отменил OS-диалог сохранения, молчим.
      if (!saved) return;
      push(`Сохранено: ${saved}`, "success");
    } catch (e) {
      push(
        `Экспорт не удался: ${(e as Error)?.message ?? String(e)}`,
        "error",
      );
    }
  }, []);

  const onTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Оверлей поверх canvas внутри ProseMirror; останавливаем всплытие,
    // чтобы редактор не видел эти клавиши.
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      commitTextEdit();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      commitTextEdit();
    }
  };

  // Перечитываем через onState tick движка (уже подключён). Дешёвые
  // синхронные чтения длины массива шейпов -- просто `.length`, без клонов.
  const shapeCount = engineRef.current?.getShapesReadonly().length ?? 0;
  const isEmpty = shapeCount === 0;

  return (
    <div className="e26-wb__stage" ref={wrapRef}>
      {/* World-слой ПЕРВЫЙ в DOM, чтобы оверлей рисовался поверх. */}
      <canvas ref={worldCanvasRef} className="e26-wb__cv e26-wb__cv--world" />
      <canvas ref={canvasRef} className="e26-wb__cv e26-wb__cv--overlay" />

      {engineRef.current && (
        <Toolbox
          engine={engineRef.current}
          onExport={onExport}
          canExport={!isEmpty}
        />
      )}

      {isEmpty && (
        // Центрированная подсказка для пустой доски. pointer-events:none
        // чтобы не перехватывать клики (юзер кликает СКВОЗЬ чтобы начать
        // рисовать). Прячется как только появляется первый шейп: shapeCount > 0
        // перерисовывает без неё.
        <div className="e26-wb__empty-hint" aria-hidden>
          <div className="e26-wb__empty-hint__title">
            Доска пустая
          </div>
          <div className="e26-wb__empty-hint__body">
            Выберите инструмент сверху или нажмите:
            <br />
            <kbd>R</kbd> -- прямоугольник, <kbd>O</kbd> -- эллипс, <kbd>T</kbd> -- текст
            <br />
            <kbd>B</kbd> -- БД, <kbd>N</kbd> -- заметка, <kbd>A</kbd> -- стрелка, <kbd>P</kbd> -- карандаш
          </div>
        </div>
      )}

      <NodeOverlay
        state={nodeOverlay}
        onCommit={commitNodeOverlay}
        onClose={closeNodeOverlay}
      />

      <BoardContextMenu
        state={contextMenu}
        onStyle={ctxStyle}
        onZFront={ctxZFront}
        onZBack={ctxZBack}
        onDuplicate={ctxDuplicate}
        onToggleLock={ctxToggleLock}
        onDelete={ctxDelete}
        onClose={closeContext}
      />

      {textEdit && (
        <textarea
          ref={textareaRef}
          className={
            "e26-wb__textedit" + (textEdit.chip ? " e26-wb__textedit--chip" : "")
          }
          defaultValue={textEdit.value}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          onInput={(e) => autosize(e.currentTarget)}
          onKeyDown={onTextareaKeyDown}
          onPointerDown={(e) => e.stopPropagation()}
          onBlur={commitTextEdit}
          style={{
            left: `${textEdit.screenX}px`,
            top: `${textEdit.screenY}px`,
            fontSize: `${textEdit.fontPx}px`,
            lineHeight: 1.25,
            color: textEdit.color,
            // Edge-label chip центрируется по точке лейбла.
            ...(textEdit.chip ? { transform: "translate(-50%, -50%)" } : null),
          }}
        />
      )}
    </div>
  );
}

/** Растягивает textarea под контент (scrollHeight как единственный источник истины). */
function autosize(ta: HTMLTextAreaElement): void {
  ta.style.height = "auto";
  ta.style.height = `${ta.scrollHeight}px`;
  ta.style.width = "auto";
  // +2px защита от обрезки последнего глифа при субпиксельном округлении.
  ta.style.width = `${ta.scrollWidth + 2}px`;
}
