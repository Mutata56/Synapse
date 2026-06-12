/**
 * Каталог эмодзи плюс индекс поиска по ключевым словам (RU + EN) для пикера иконок.
 *
 * Каждая запись это символ эмодзи в паре со списком поисковых слов (нижний
 * регистр, через пробел): названия, синонимы и слово-категория, чтобы запрос
 * вроде "еда", "music" или "сердце" поднимал всю группу. Ключевые слова лежат
 * рядом с символом (один кортеж), так что разъехаться не могут. Это важно для
 * эмодзи с вариационным селектором (❤️, ✏️, 🗂️ и пр.), где отдельную map по
 * ключам легко рассинхронить.
 */

type EmojiEntry = readonly [char: string, keywords: string];
export type EmojiCategory = { name: string; emojis: readonly EmojiEntry[] };

export const EMOJI_CATEGORIES: readonly EmojiCategory[] = [
  {
    name: "Часто",
    emojis: [
      ["📝", "заметка записка память note memo писать write"],
      ["✨", "блёстки искры волшебство магия sparkles magic новое чисто shine"],
      ["💡", "идея лампочка свет озарение idea bulb light"],
      ["🔥", "огонь пламя жар горячо пожар fire flame hot lit"],
      ["⭐", "звезда избранное оценка рейтинг star favorite"],
      ["❤️", "сердце любовь красное валентин heart love red"],
      ["🚀", "ракета запуск космос старт быстро рост rocket launch space"],
      ["🎯", "цель мишень дартс точность попадание target goal bullseye"],
      ["📌", "кнопка булавка закрепить метка pin pushpin"],
      ["✅", "галочка готово выполнено подтверждено check done ok tick"],
      ["🌟", "звезда блеск сияние особый glowing star shine"],
      ["💭", "мысль облако думать пузырь идея thought think bubble"],
    ],
  },
  {
    name: "Лица",
    emojis: [
      ["😀", "лицо смайл улыбка смех радость face grin smile happy"],
      ["😃", "лицо смайл улыбка радость face smile grin happy"],
      ["😄", "лицо смайл смех радость face laugh smile happy"],
      ["😁", "лицо смайл улыбка зубы face grin beam smile"],
      ["😊", "лицо смайл улыбка милый доволен face smile blush happy"],
      ["😍", "лицо смайл влюблён любовь восторг face love heart eyes"],
      ["🤩", "лицо смайл восторг звёзды восхищение face star struck wow"],
      ["😎", "лицо смайл круто очки солнцезащитные face cool sunglasses"],
      ["🥳", "лицо смайл праздник вечеринка face party celebrate"],
      ["🤔", "лицо смайл думать размышление face think thinking hmm"],
      ["🙃", "лицо смайл перевёрнутый ирония face silly upside down"],
      ["😴", "лицо смайл сон спать усталость face sleep sleeping zzz"],
      ["🤯", "лицо смайл взрыв мозг шок face mind blown exploding"],
      ["😱", "лицо смайл крик страх ужас face scream fear"],
      ["😢", "лицо смайл плач слёзы грусть face cry sad tear"],
      ["😅", "лицо смайл пот нервно облегчение face sweat nervous"],
      ["🤗", "лицо смайл обнять объятия обнимашки face hug"],
      ["🤫", "лицо смайл тихо тсс секрет face shush quiet silence"],
      ["🙄", "лицо смайл закатить глаза раздражение face eyeroll annoyed"],
      ["😏", "лицо смайл ухмылка самодовольство face smirk"],
    ],
  },
  {
    name: "Объекты",
    emojis: [
      ["📚", "книги стопка библиотека учёба books study book"],
      ["📖", "книга открытая чтение open book read"],
      ["📓", "тетрадь блокнот записи notebook book"],
      ["📔", "тетрадь блокнот дневник notebook journal book"],
      ["📒", "тетрадь блокнот журнал ledger notebook book"],
      ["📕", "книга красная closed red book"],
      ["📗", "книга зелёная green book"],
      ["📘", "книга синяя blue book"],
      ["📙", "книга оранжевая orange book"],
      ["📰", "газета новости пресса newspaper news"],
      ["📄", "лист страница документ файл page document file"],
      ["📃", "лист страница документ page document curl"],
      ["🗂️", "разделители картотека папки index dividers organize files"],
      ["🗃️", "картотека ящик коробка архив card box files"],
      ["🗄️", "шкаф картотека архив file cabinet files"],
      ["📁", "папка директория folder directory"],
      ["📂", "папка открытая open folder"],
      ["🗒️", "блокнот спираль заметки notepad notes"],
      ["🗓️", "календарь планер дата spiral calendar"],
      ["📅", "календарь дата день calendar date"],
      ["✏️", "карандаш писать рисовать pencil write"],
      ["✒️", "перо ручка чернила nib pen ink"],
      ["🖊️", "ручка писать pen write"],
      ["🖋️", "перьевая ручка перо fountain pen"],
      ["🖌️", "кисть рисовать краска paintbrush paint art"],
      ["🖍️", "мелок карандаш рисовать crayon"],
      ["📎", "скрепка вложение прикрепить paperclip attach"],
      ["📌", "кнопка булавка закрепить метка pin pushpin"],
      ["📍", "булавка метка место локация pin location pushpin"],
      ["📐", "линейка треугольник угол ruler measure"],
    ],
  },
  {
    name: "Природа",
    emojis: [
      ["🌸", "цветок сакура весна розовый природа blossom cherry flower"],
      ["🌺", "цветок гибискус природа hibiscus flower"],
      ["🌻", "подсолнух цветок природа sunflower flower"],
      ["🌷", "тюльпан цветок природа tulip flower"],
      ["🌹", "роза цветок любовь природа rose flower"],
      ["🥀", "увядший цветок грусть природа wilted flower"],
      ["🌼", "цветок ромашка природа blossom daisy flower"],
      ["💐", "букет цветы подарок природа bouquet flowers"],
      ["🍀", "клевер удача четырёхлистный природа clover luck"],
      ["🍃", "лист листья ветер природа leaf leaves"],
      ["🌿", "трава листья зелень растение природа herb plant"],
      ["☘️", "клевер трилистник природа shamrock clover"],
      ["🌱", "росток саженец растение природа seedling sprout plant"],
      ["🌳", "дерево лиственное природа tree"],
      ["🌲", "ёлка дерево хвойное природа pine tree"],
      ["🌴", "пальма тропики природа palm tree"],
      ["🌵", "кактус пустыня природа cactus"],
      ["🌾", "колосья пшеница колос природа rice grain"],
      ["🌊", "волна море океан вода природа wave ocean water"],
      ["🔥", "огонь пламя жар природа fire flame hot"],
      ["❄️", "снежинка снег зима холод природа snowflake snow winter cold"],
      ["☀️", "солнце жара погода природа sun sunny"],
      ["🌙", "луна месяц ночь природа moon night"],
      ["⭐", "звезда избранное природа star favorite"],
      ["🌈", "радуга цвета природа rainbow"],
      ["☁️", "облако туча погода природа cloud"],
      ["⚡", "молния энергия электричество природа lightning power"],
      ["💧", "капля вода природа droplet water"],
      ["🌍", "земля глобус планета мир европа африка природа earth globe world"],
      ["🌎", "земля глобус планета мир америка природа earth globe world"],
    ],
  },
  {
    name: "Еда",
    emojis: [
      ["🍕", "пицца еда food pizza"],
      ["🍔", "бургер гамбургер еда food burger"],
      ["🍟", "картошка фри чипсы еда food fries"],
      ["🌭", "хот-дог сосиска еда food hotdog"],
      ["🥪", "сэндвич бутерброд еда food sandwich"],
      ["🌮", "тако еда food taco"],
      ["🌯", "буррито шаурма еда food burrito wrap"],
      ["🥗", "салат зелень еда food salad"],
      ["🍝", "паста спагетти макароны еда food pasta spaghetti"],
      ["🍜", "лапша рамен суп еда food noodles ramen soup"],
      ["🍲", "суп рагу горшок еда food stew pot soup"],
      ["🍱", "бенто обед коробка еда food bento lunch"],
      ["🍣", "суши роллы рыба еда food sushi"],
      ["🍙", "онигири рис еда food rice ball onigiri"],
      ["🍚", "рис чашка еда food rice"],
      ["🍛", "карри рис еда food curry rice"],
      ["🍦", "мороженое рожок десерт еда food ice cream"],
      ["🍰", "торт пирожное десерт еда food cake dessert"],
      ["🎂", "торт день рождения праздник еда food birthday cake"],
      ["🍪", "печенье десерт еда food cookie"],
      ["☕", "кофе чай напиток горячий еда food coffee tea drink"],
      ["🍵", "чай чашка зелёный напиток еда food tea"],
      ["🧃", "сок коробка напиток еда food juice box drink"],
      ["🥤", "напиток стакан соломинка газировка еда food drink soda cup"],
      ["🍺", "пиво кружка алкоголь еда food beer drink"],
      ["🍷", "вино бокал алкоголь еда food wine drink"],
      ["🥂", "бокалы тост шампанское алкоголь еда food cheers celebrate"],
      ["🍓", "клубника ягода фрукт еда food strawberry"],
      ["🍎", "яблоко красное фрукт еда food apple fruit"],
      ["🍊", "мандарин апельсин фрукт еда food orange tangerine fruit"],
    ],
  },
  {
    name: "Активности",
    emojis: [
      ["⚽", "футбол мяч спорт soccer football ball sport"],
      ["🏀", "баскетбол мяч спорт basketball ball sport"],
      ["🏈", "американский футбол мяч спорт football ball sport"],
      ["⚾", "бейсбол мяч спорт baseball ball sport"],
      ["🎾", "теннис мяч спорт tennis ball sport"],
      ["🏐", "волейбол мяч спорт volleyball ball sport"],
      ["🏓", "настольный теннис пинг-понг ракетка спорт table tennis ping pong sport"],
      ["🎱", "бильярд шар спорт pool billiards ball sport"],
      ["🎮", "игра геймпад джойстик игры game controller gamepad"],
      ["🎲", "кубик кость рандом игры dice game"],
      ["🎯", "цель мишень дартс спорт target dartboard sport"],
      ["🎳", "боулинг кегли спорт bowling sport"],
      ["🎤", "микрофон пение караоке музыка mic microphone karaoke music"],
      ["🎧", "наушники музыка headphones music"],
      ["🎼", "ноты партитура музыка инструмент music score"],
      ["🎹", "пианино клавиши синтезатор музыка инструмент piano keyboard music"],
      ["🎸", "гитара музыка инструмент guitar music"],
      ["🎺", "труба музыка инструмент trumpet music"],
      ["🎻", "скрипка музыка инструмент violin music"],
      ["🎬", "кино фильм хлопушка movie film clapper"],
      ["🏆", "кубок трофей награда победа trophy win award"],
      ["🏅", "медаль награда спорт medal award sport"],
      ["🥇", "золото золотая первое первый спорт gold medal first sport"],
      ["🥈", "серебро серебряная второе второй спорт silver medal second sport"],
      ["🥉", "бронза бронзовая третье третий спорт bronze medal third sport"],
      ["🎖️", "медаль орден военная награда military medal award"],
      ["🏵️", "розетка награда rosette award"],
      ["🎗️", "ленточка лента напоминание reminder ribbon"],
      ["🎟️", "билет тикет вход admission ticket"],
      ["🎫", "билет вход ticket"],
    ],
  },
  {
    name: "Символы",
    emojis: [
      ["❤️", "сердце любовь красное валентин heart love red"],
      ["🧡", "сердце оранжевое любовь orange heart love"],
      ["💛", "сердце жёлтое любовь yellow heart love"],
      ["💚", "сердце зелёное любовь green heart love"],
      ["💙", "сердце синее любовь blue heart love"],
      ["💜", "сердце фиолетовое любовь purple heart love"],
      ["🖤", "сердце чёрное любовь black heart love"],
      ["🤍", "сердце белое любовь white heart love"],
      ["🤎", "сердце коричневое любовь brown heart love"],
      ["💔", "разбитое сердце грусть broken heart love"],
      ["❣️", "сердце восклицание любовь heart exclamation love"],
      ["💕", "два сердца любовь two hearts love"],
      ["💞", "сердца вращение любовь revolving hearts love"],
      ["💓", "сердце биение пульс любовь beating heart love"],
      ["💗", "сердце растёт любовь growing heart love"],
      ["💖", "сердце блеск искры любовь sparkling heart love"],
      ["💘", "сердце стрела амур купидон любовь heart arrow cupid love"],
      ["💝", "сердце подарок лента любовь gift heart ribbon love"],
      ["💟", "сердце украшение любовь heart decoration love"],
      ["♨️", "горячие источники пар баня hot springs steam"],
      ["✅", "галочка готово выполнено check done ok tick"],
      ["❌", "крестик нет отмена ошибка cross no wrong cancel"],
      ["⭕", "круг правильно circle right"],
      ["💯", "сто идеально perfect hundred score"],
      ["💢", "злость гнев anger angry mad"],
      ["💥", "взрыв бум столкновение collision boom explosion"],
      ["💫", "звёзды головокружение dizzy star"],
      ["💦", "капли пот вода брызги sweat droplets water"],
      ["💨", "ветер дым пар быстро dash wind smoke fast"],
      ["🌀", "циклон вихрь спираль воронка cyclone swirl spiral"],
    ],
  },
];

/** Плоский список символов эмодзи без дублей (множество для поиска плюс случайный выбор). */
export const ALL_EMOJIS: readonly string[] = [
  ...new Set(EMOJI_CATEGORIES.flatMap((c) => c.emojis.map(([char]) => char))),
];

/** char даёт keywords. Символ, который встречается в двух категориях (🔥, ⭐,
 *  ❤️, ✅, 🎯, 📌), получает *объединение* своих наборов ключевых слов, дедуп
 *  пословный, так что ни один синоним не теряется. */
const KEYWORDS = ((): Map<string, string> => {
  const map = new Map<string, string>();
  for (const cat of EMOJI_CATEGORIES) {
    for (const [char, kw] of cat.emojis) {
      const words = new Set([
        ...(map.get(char)?.split(" ") ?? []),
        ...kw.split(" "),
      ]);
      map.set(char, [...words].join(" "));
    }
  }
  return map;
})();

/**
 * Поиск без учёта регистра по названиям/ключевым словам (RU + EN), плюс по
 * самому символу эмодзи (чтобы вставленный эмодзи тоже находился). Возвращает
 * подходящие символы в порядке каталога.
 */
export function searchEmojis(query: string): string[] {
  const raw = query.trim();
  if (!raw) return [];
  const q = raw.toLowerCase();
  return ALL_EMOJIS.filter(
    (char) => char.includes(raw) || (KEYWORDS.get(char) ?? "").includes(q),
  );
}
