/**
 * Подобранные id фоток Unsplash, сгруппированные по темам, плюс динамическая
 * категория "Случайные" на picsum.photos (без API-ключа, всегда доступна).
 *
 * У каждой категории есть:
 *   - `thumbs`  это URL заранее обрезанных миниатюр для сетки выбора
 *   - `full(i)` это полноразмерный URL с пропорцией под полосу обложки hero
 *
 * Оба массива URL строим один раз при загрузке модуля, `full(i)` делает O(1)
 * поиск в готовом списке, а не пересоздаёт массив из 16 элементов на каждый
 * вызов.
 *
 * ВНЕШНЯЯ ЗАВИСИМОСТЬ: каждый URL отсюда ведёт на `images.unsplash.com` или
 * `picsum.photos`. Без сети галерея обложек деградирует мягко: каждый потребитель
 * (`NoteCard`, `NoteHero`, `CoverPicker.ThumbButton`) ловит `<img onError>` и
 * показывает заглушку. Но сам выбор обложки без сети смысла не имеет.
 */

// Обложка hero примерно 1000 на 280, пропорция 3.57:1. Просим у Unsplash
// картинку такой же формы, чтобы видимый кроп на готовой обложке был минимальным.
const FULL_W = 1600;
const FULL_H = 480;

// Миниатюры выбора в 2 колонки, высотой около 95 px.
const THUMB_W = 480;
const THUMB_H = 210;

const UNSPLASH_BASE = "https://images.unsplash.com/photo-";
const UNSPLASH_PARAMS = "q=80&auto=format&fit=crop&crop=entropy";

const PICSUM_BASE = "https://picsum.photos/seed";
const RANDOM_CATEGORY_SIZE = 32;
/** Стабильный seed: каждому юзеру достаются одни и те же 32 "случайные" обложки,
 *  так миниатюры кешируются, а не генерятся заново каждую сессию. */
const RANDOM_SEED_PREFIX = "cover";

export type CoverCategory = {
  id: string;
  label: string;
  thumbs: readonly string[];
  /**
   * Возвращает полноразмерный URL в паре с `thumbs[i]`. Звать безопасно только
   * с `i` из `[0, thumbs.length)`: вызывающие всегда итерируют `thumbs.map` и
   * шлют обратно тот же индекс, так что инвариант держится сам собой.
   */
  full: (i: number) => string;
};

// ─── Сборщики URL ──────────────────────────────────────────────────────────

function unsplashList(ids: readonly string[], w: number, h: number): string[] {
  return ids.map(
    (id) => `${UNSPLASH_BASE}${id}?w=${w}&h=${h}&${UNSPLASH_PARAMS}`,
  );
}

function picsumList(count: number, w: number, h: number): string[] {
  return Array.from(
    { length: count },
    (_, i) => `${PICSUM_BASE}/${RANDOM_SEED_PREFIX}-${i}/${w}/${h}`,
  );
}

/**
 * Собирает категорию из фиксированного списка id фоток Unsplash, заранее считая
 * массивы URL для миниатюр и полного размера, чтобы рендеры обходились без
 * аллокаций.
 */
function makeUnsplashCategory(
  id: string,
  label: string,
  photoIds: readonly string[],
): CoverCategory {
  const thumbs = unsplashList(photoIds, THUMB_W, THUMB_H);
  const fullList = unsplashList(photoIds, FULL_W, FULL_H);
  return {
    id,
    label,
    thumbs,
    full: (i) => fullList[i],
  };
}

function makePicsumCategory(
  id: string,
  label: string,
  count: number,
): CoverCategory {
  const thumbs = picsumList(count, THUMB_W, THUMB_H);
  const fullList = picsumList(count, FULL_W, FULL_H);
  return {
    id,
    label,
    thumbs,
    full: (i) => fullList[i],
  };
}

// ─── Id фоток по темам ────────────────────────────────────────────────────

const NATURE = [
  "1469474968028-56623f02e42e", "1426604966848-d7adac402bff", "1441974231531-c6227db76b6e",
  "1470115636492-6d2b56f9146d", "1501785888041-af3ef285b470", "1447752875215-b2761acb3c5d",
  "1500382017468-9049fed747ef", "1490604001847-b712b0c2f967", "1465146344425-f00d5f5c8f07",
  "1518173946687-a4c8892bbd9f", "1500964757637-c85e8a162699", "1444080748397-f442aa95c3e5",
  "1418065460487-3e41a6c84dc5", "1505765050516-f72dcac9c60f", "1502082553048-f009c37129b9",
  "1465056836041-7f43ac27dcb5",
] as const;

const ART = [
  "1547891654-e66ed7ebb968", "1579783902614-a3fb3927b6a5", "1578321272176-b7bbc0679853",
  "1541961017774-22349e4a1262", "1513519245088-0e12902e5a38", "1605721911519-3dfeb3be25e7",
  "1549490349-8643362247b5", "1578926375605-eaf7559b1458", "1574169208507-84376144848b",
  "1551033406-611cf9a28f67", "1561214115-f2f134cc4912", "1531913764164-f85c52e6e654",
  "1554034483-04fda0d3507b", "1547333101-3a4ad0c1e6dd", "1517999144091-3d9dca6d1e43",
  "1604147706283-d7119b5b822c",
] as const;

const SPACE = [
  "1462331940025-496dfbfc7564", "1419242902214-272b3f66ee7a", "1446776877081-d282a0f896e2",
  "1532770724757-d4f87f8aedea", "1543722530-d2c3201371e7", "1502134249126-9f3755a50d78",
  "1454789548928-9efd52dc4031", "1517976547714-720226b864c1", "1465101162946-4377e57745c3",
  "1494332843049-9c4f4f9d9b3a", "1572294437555-65a5e3a89c50", "1444703686981-a3abbc4d4fe3",
  "1502776165354-3a08bb6a5dac", "1564324738080-bbbf8d6b4887", "1451187580459-43490279c0fa",
  "1538370965046-79c0d6907d47",
] as const;

const OCEAN = [
  "1507525428034-b723cf961d3e", "1505142468610-359e7d316be0", "1439405326854-014607f694d7",
  "1518837695005-2083093ee35b", "1530053969600-caed2596d242", "1502082553048-f009c37129b9",
  "1559827260-dc66d52bef19", "1494891848038-7bd202a2afeb", "1493558103817-58b2924bce98",
  "1500627965408-b5f2c8794f0f", "1463693396721-8ca7cccb4519", "1465311354900-6a9b9ed87fec",
] as const;

// Заметка: тут раньше дважды лежал "1518391846015-55a9cc003b25", дубль убрал.
const CITY = [
  "1480714378408-67cf0d13bc1b", "1449824913935-59a10b8d2000", "1444723121867-7a241cacace9",
  "1496564203457-11bb12075d90", "1485871981521-5b1fd3805eee", "1502920917128-1aa500764cbd",
  "1494522855154-9297ac14b55f", "1477959858617-67f85cf4f1df", "1493515322954-4fa727e97985",
  "1514924013411-cbf25faa35bb", "1518391846015-55a9cc003b25", "1483653364400-eedcfb9f1f88",
  "1496449903678-68ddcb189a24", "1483401757487-2ced3fa77952", "1444084316824-dc26d6657664",
] as const;

const MINIMAL = [
  "1557682250-33bd709cbe85", "1557683316-973673baf926", "1557682224-5b8590cd9ec5",
  "1557682304-c0a8e6c0adc1", "1557672172-298e090bd0f1", "1558591710-4b4a1ae0f04d",
  "1554034483-04fda0d3507b", "1604079628040-94301bb21b91", "1557682233-43e671455dfa",
  "1557683304-673a23048d34", "1612296727716-d6c69a9b54a4", "1572985335543-0e15c0c8d6dd",
] as const;

const ABSTRACT = [
  "1541701494587-cb58502866ab", "1550684848-86a5d8727436", "1574169208507-84376144848b",
  "1604147706283-d7119b5b822c", "1620121684840-edffcfc4b878", "1518791841217-8f162f1e1131",
  "1614851099511-773084f6911d", "1517999144091-3d9dca6d1e43", "1604871000636-074fa5117945",
  "1543857778-c4a1a3e0b2eb", "1567095751004-23bd0c3a8c5a", "1554034483-04fda0d3507b",
] as const;

const ARCH = [
  "1487958449943-2429e8be8625", "1493809842364-78817add7ffb", "1448630360428-65456885c650",
  "1486325212027-8081e485255e", "1492321936769-b49830bc1d1e", "1431576901776-e539bd916ba2",
  "1518780664697-55e3ad937233", "1497366754035-f200968a6e72", "1545158539-3c8a08b9b58d",
  "1486718448742-163732cd1544", "1473773508845-188df298d2d1", "1505409859467-3a796fd5798e",
  "1481026469463-66327c86e544", "1500651230702-0e2d8a49d4ad",
] as const;

// ─── Публичное: категории ────────────────────────────────────────────────────

/**
 * Упорядоченный список категорий обложек для UI выбора. У каждой записи массивы
 * URL `thumbs` и `full(i)` посчитаны один раз при загрузке модуля.
 *
 * Добавить новую категорию: собрать через `makeUnsplashCategory` (для готового
 * списка id) или `makePicsumCategory` (для случайных обложек) и дописать в этот
 * массив. Больше ничего подключать не надо, `CoverPicker` итерирует список
 * напрямую.
 */
export const COVER_CATEGORIES: readonly CoverCategory[] = [
  makeUnsplashCategory("nature", "Природа", NATURE),
  makeUnsplashCategory("art", "Искусство", ART),
  makeUnsplashCategory("space", "Космос", SPACE),
  makeUnsplashCategory("ocean", "Океан", OCEAN),
  makeUnsplashCategory("city", "Города", CITY),
  makeUnsplashCategory("minimal", "Минимализм", MINIMAL),
  makeUnsplashCategory("abstract", "Абстракция", ABSTRACT),
  makeUnsplashCategory("architecture", "Архитектура", ARCH),
  makePicsumCategory("random", "Случайные", RANDOM_CATEGORY_SIZE),
];
