/**
 * Крошечный diff текста без зависимостей, нужен экрану "Изменения" в истории
 * версий, чтобы показать, что поменялось между снимком и текущей заметкой.
 *
 * Работает в два прохода:
 *   1. Построчный diff (LCS) делит тексты на равные / удалённые / добавленные
 *      строки, та же модель, что показывает `git diff`.
 *   2. Строки, которые *заменили* (удалённая в паре с добавленной), уточняем
 *      вторым LCS, уже на уровне слов, чтобы UI подсветил ровно изменившиеся
 *      слова, а не красил строку целиком.
 *
 * LCS (наибольшая общая подпоследовательность) это стандартная основа diff-ов:
 * чем длиннее общую подпоследовательность удаётся выровнять, тем меньше всего
 * приходится звать "изменённым". Стоит это O(n*m) по времени и памяти на двух
 * списках токенов, что для текста размером с заметку несущественно.
 */

/** Кусок текста внутри строки, помеченный как изменённый или нет. */
export type InlinePart = { text: string; changed: boolean };

/** Одна строка отрисованного diff. `parts` это разбивка по словам:
 *  - у строк "equal" один неизменённый кусок,
 *  - у целиком добавленных/удалённых один изменённый кусок,
 *  - у заменённых смесь, чтобы загорелись только отличающиеся слова. */
export type DiffLine = {
  type: "equal" | "add" | "remove";
  parts: InlinePart[];
};

// ─── Общий LCS-diff ──────────────────────────────────────────────────────────

type Op<T> = { type: "equal" | "remove" | "add"; value: T };

/**
 * Сравнивает две последовательности через LCS и возвращает edit-скрипт в
 * исходном порядке. При равенстве предпочитаем "remove" перед "add", чтобы
 * замена выходила сначала удалёнными, потом добавленными элементами, на это
 * опирается построчный проход.
 */
function lcsDiff<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): Op<T>[] {
  const m = a.length;
  const n = b.length;

  // dp[i][j] = длина LCS для a[i..] и b[j..]. Заполняем с нижне-правого угла,
  // чтобы потом идти вперёд от (0,0) и выдавать ops в порядке чтения.
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = eq(a[i], b[j])
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops: Op<T>[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (eq(a[i], b[j])) {
      ops.push({ type: "equal", value: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: "remove", value: a[i] });
      i++;
    } else {
      ops.push({ type: "add", value: b[j] });
      j++;
    }
  }
  while (i < m) ops.push({ type: "remove", value: a[i++] });
  while (j < n) ops.push({ type: "add", value: b[j++] });
  return ops;
}

// ─── Построчный diff с уточнением по словам ──────────────────────────────────────────

/**
 * Сравнивает `oldText` (снимок) с `newText` (текущая заметка) и возвращает по
 * одной `DiffLine` на каждую выходную строку, по порядку.
 */
export function diffText(oldText: string, newText: string): DiffLine[] {
  const lineOps = lcsDiff(oldText.split("\n"), newText.split("\n"), strEq);
  const out: DiffLine[] = [];

  let k = 0;
  while (k < lineOps.length) {
    if (lineOps[k].type === "equal") {
      out.push({ type: "equal", parts: [{ text: lineOps[k].value, changed: false }] });
      k++;
      continue;
    }

    // Собираем подряд идущий блок удалений, за которым идут добавления. Спарив их,
    // можно сделать пословный diff "заменённой" строки с её заменой.
    const removes: string[] = [];
    const adds: string[] = [];
    while (k < lineOps.length && lineOps[k].type === "remove") removes.push(lineOps[k++].value);
    while (k < lineOps.length && lineOps[k].type === "add") adds.push(lineOps[k++].value);

    const paired = Math.min(removes.length, adds.length);
    for (let p = 0; p < paired; p++) {
      const [removed, added] = refineLine(removes[p], adds[p]);
      out.push({ type: "remove", parts: removed });
      out.push({ type: "add", parts: added });
    }
    // У оставшихся строк нет пары, значит изменение это вся строка целиком.
    for (let p = paired; p < removes.length; p++)
      out.push({ type: "remove", parts: [{ text: removes[p], changed: true }] });
    for (let p = paired; p < adds.length; p++)
      out.push({ type: "add", parts: [{ text: adds[p], changed: true }] });
  }

  return out;
}

/**
 * Пословный diff одной удалённой строки против одной добавленной. Возвращает
 * inline-куски для каждой стороны: общие слова не помечены, остальные помечены.
 */
function refineLine(oldLine: string, newLine: string): [InlinePart[], InlinePart[]] {
  const ops = lcsDiff(tokenize(oldLine), tokenize(newLine), strEq);
  const removed: InlinePart[] = [];
  const added: InlinePart[] = [];
  for (const op of ops) {
    if (op.type === "equal") {
      pushPart(removed, op.value, false);
      pushPart(added, op.value, false);
    } else if (op.type === "remove") {
      pushPart(removed, op.value, true);
    } else {
      pushPart(added, op.value, true);
    }
  }
  return [removed, added];
}

function strEq(a: string, b: string): boolean {
  return a === b;
}

/** Режет строку на слова и пробелы между ними, и то и другое держим как токены,
 *  чтобы строку можно было собрать обратно ровно из этих кусков. */
function tokenize(line: string): string[] {
  return line.split(/(\s+)/).filter((t) => t.length > 0);
}

/** Дописывает `text` в `parts`, сливая с предыдущим куском, если флаг changed
 *  совпадает. Так число отрисованных span остаётся небольшим. */
function pushPart(parts: InlinePart[], text: string, changed: boolean): void {
  const last = parts[parts.length - 1];
  if (last && last.changed === changed) last.text += text;
  else parts.push({ text, changed });
}
