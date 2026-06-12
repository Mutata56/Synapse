/**
 * Минимальный ZIP-райтер без зависимостей, только "stored" (без сжатия) записи.
 *
 * Раскладку байтов (local file headers, central directory, EOCD) собираем
 * руками по APPNOTE.TXT. Stored-архивы это валидные ZIP, их откроет любой инструмент
 * (проводник Windows, 7-Zip, `unzip`); для бэкапа из мелких текстовых файлов
 * отсутствие сжатия роли не играет, зато не тянем zip-библиотеку.
 */

export type ZipEntry = { name: string; data: Uint8Array };

const encoder = new TextEncoder();

// Бит 11 general-purpose-флага: имена файлов в UTF-8 (нужно для кириллицы).
const FLAG_UTF8 = 0x0800;
// Валидные DOS-дата/время (1980-01-01 00:00), mtime мы тут не сохраняем.
const DOS_DATE = 0x21;
const DOS_TIME = 0;

// ─── CRC-32 (IEEE) ───────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Собирает stored ZIP-архив из `entries`. Возвращает сырые байты. */
export function createZip(entries: ZipEntry[]): Uint8Array {
  type Meta = { nameBytes: Uint8Array; size: number; crc: number; offset: number };
  const metas: Meta[] = [];
  const localChunks: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const header = new Uint8Array(30 + nameBytes.length);
    const dv = new DataView(header.buffer);
    dv.setUint32(0, 0x04034b50, true); // сигнатура local file header
    dv.setUint16(4, 20, true); // нужная версия для распаковки (2.0)
    dv.setUint16(6, FLAG_UTF8, true);
    dv.setUint16(8, 0, true); // метод сжатия: 0 = stored
    dv.setUint16(10, DOS_TIME, true);
    dv.setUint16(12, DOS_DATE, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, entry.data.length, true); // сжатый размер
    dv.setUint32(22, entry.data.length, true); // несжатый размер
    dv.setUint16(26, nameBytes.length, true);
    dv.setUint16(28, 0, true); // длина extra-поля
    header.set(nameBytes, 30);

    localChunks.push(header, entry.data);
    metas.push({ nameBytes, size: entry.data.length, crc, offset });
    offset += header.length + entry.data.length;
  }

  const centralChunks: Uint8Array[] = [];
  let centralSize = 0;
  for (const m of metas) {
    const rec = new Uint8Array(46 + m.nameBytes.length);
    const dv = new DataView(rec.buffer);
    dv.setUint32(0, 0x02014b50, true); // сигнатура central directory
    dv.setUint16(4, 20, true); // версия создателя
    dv.setUint16(6, 20, true); // нужная версия
    dv.setUint16(8, FLAG_UTF8, true);
    dv.setUint16(10, 0, true); // метод
    dv.setUint16(12, DOS_TIME, true);
    dv.setUint16(14, DOS_DATE, true);
    dv.setUint32(16, m.crc, true);
    dv.setUint32(20, m.size, true);
    dv.setUint32(24, m.size, true);
    dv.setUint16(28, m.nameBytes.length, true);
    dv.setUint16(30, 0, true); // extra
    dv.setUint16(32, 0, true); // комментарий
    dv.setUint16(34, 0, true); // номер диска начала
    dv.setUint16(36, 0, true); // внутренние атрибуты
    dv.setUint32(38, 0, true); // внешние атрибуты
    dv.setUint32(42, m.offset, true); // смещение local header
    rec.set(m.nameBytes, 46);
    centralChunks.push(rec);
    centralSize += rec.length;
  }
  const centralOffset = offset;

  const eocd = new Uint8Array(22);
  const edv = new DataView(eocd.buffer);
  edv.setUint32(0, 0x06054b50, true); // сигнатура end of central directory
  edv.setUint16(4, 0, true); // номер диска
  edv.setUint16(6, 0, true); // диск с central directory
  edv.setUint16(8, metas.length, true); // записей на этом диске
  edv.setUint16(10, metas.length, true); // всего записей
  edv.setUint32(12, centralSize, true);
  edv.setUint32(16, centralOffset, true);
  edv.setUint16(20, 0, true); // длина комментария

  const out = new Uint8Array(offset + centralSize + eocd.length);
  let pos = 0;
  for (const chunk of localChunks) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  for (const chunk of centralChunks) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  out.set(eocd, pos);
  return out;
}

// ─── Чтение архива ───────────────────────────────────────────────────────────
//
// Зеркало createZip: ТОЛЬКО STORED (метод 0). Оба конца наши, каждый zip, что мы
// читаем, сделан createZip выше, так что громко отказывать на других методах
// сжатия это правильно (чужой архив скорее ошибка, чем реальный бэкап для
// восстановления). Ридер тут минимальный, лишь под флоу "восстановить из бэкапа":
//   1. Находим EOCD, сканируя от конца файла назад.
//   2. Идём по central directory по тому смещению, на которое он указывает.
//   3. Для каждой записи прыгаем к её local file header и режем payload.
//
// Защитные проверки: отвергаем method != 0, абсолютные пути и пути с выходом
// вверх (..\, /etc/...), битые смещения.

const decoder = new TextDecoder("utf-8");

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
/** EOCD переменной длины, до 22 + 65535 байт (максимальный комментарий). */
const MAX_EOCD_SEARCH = 22 + 65535;

function findEocdOffset(view: DataView): number {
  const max = Math.min(view.byteLength, MAX_EOCD_SEARCH);
  for (let i = view.byteLength - 22; i >= view.byteLength - max && i >= 0; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) return i;
  }
  return -1;
}

function isUnsafePath(p: string): boolean {
  // Запрещаем абсолютные пути И любой сегмент `..`, чтобы вредоносный zip не
  // записал что-то вне стейджинговой папки. Сначала нормализуем разделители.
  const norm = p.replace(/\\/g, "/");
  if (norm.startsWith("/") || /^[A-Za-z]:/.test(norm)) return true;
  for (const seg of norm.split("/")) {
    if (seg === "..") return true;
  }
  return false;
}

/**
 * Читает STORED zip, сделанный `createZip`. Кидает ошибку на любом другом
 * формате (сжатые записи, нет EOCD, опасные пути), молча неполный результат не
 * отдаёт.
 */
export function unzipStored(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdAt = findEocdOffset(view);
  if (eocdAt < 0) {
    throw new Error("Файл не похож на ZIP (EOCD не найдено)");
  }
  const entryCount = view.getUint16(eocdAt + 10, true);
  const centralSize = view.getUint32(eocdAt + 12, true);
  const centralOffset = view.getUint32(eocdAt + 16, true);
  if (centralOffset + centralSize > bytes.byteLength) {
    throw new Error("ZIP повреждён (некорректное смещение центрального каталога)");
  }

  const out: ZipEntry[] = [];
  let p = centralOffset;
  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(p, true) !== SIG_CENTRAL) {
      throw new Error("ZIP повреждён (битая запись каталога #" + i + ")");
    }
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const uncompSize = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);

    if (method !== 0) {
      throw new Error(
        "Неподдерживаемое сжатие в архиве, пересоздайте бэкап в этом приложении",
      );
    }
    if (compSize !== uncompSize) {
      throw new Error("ZIP повреждён (compSize != uncompSize для stored-entry)");
    }

    const nameBytes = new Uint8Array(bytes.buffer, bytes.byteOffset + p + 46, nameLen);
    const name = decoder.decode(nameBytes);
    if (isUnsafePath(name)) {
      throw new Error("Опасный путь в архиве: " + name);
    }

    // Прыгаем к local header, чтобы учесть его (возможно другую) длину extra-поля.
    if (view.getUint32(localOffset, true) !== SIG_LOCAL) {
      throw new Error("ZIP повреждён (битый local-header для " + name + ")");
    }
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    if (dataStart + uncompSize > bytes.byteLength) {
      throw new Error("ZIP повреждён (запись " + name + " выходит за пределы файла)");
    }

    // Slice даёт вью, который ссылается на входной буфер, поэтому копируем,
    // чтобы вызывающий мог спокойно пережить исходный буфер.
    const data = new Uint8Array(uncompSize);
    data.set(
      new Uint8Array(bytes.buffer, bytes.byteOffset + dataStart, uncompSize),
    );
    out.push({ name, data });

    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
