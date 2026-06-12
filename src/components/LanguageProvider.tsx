import {
  createContext,
  useContext,
  useState,
  useCallback,
  Fragment,
  type ReactNode,
} from "react";
import {
  t as tFn,
  setLanguage as setLang,
  getLanguage,
} from "../lib/i18n";

type Lang = "ru" | "en";

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (russian: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue>({
  lang: "ru",
  setLang: () => {},
  t: (key) => key,
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, _setLang] = useState<Lang>(() => {
    try {
      return (localStorage.getItem("i18n-lang") as Lang) ?? "ru";
    } catch {
      return "ru";
    }
  });

  // Держим глобал i18n в синхроне с выбранным языком, в том числе на первом
  // рендере (чтобы голый t() сразу отдавал нужный язык, а не дефолтный ru).
  if (getLanguage() !== lang) setLang(lang);

  const setLangFn = useCallback((next: Lang) => {
    _setLang(next);
    setLang(next);
    try {
      localStorage.setItem("i18n-lang", next);
    } catch {
      /* квота или приватный режим, забиваем */
    }
  }, []);

  const value: I18nContextValue = { lang, setLang: setLangFn, t: tFn };

  // key={lang} перемонтирует всё дерево при смене языка, так что каждый
  // компонент сразу перечитывает новый язык, даже те, что зовут голый t() из
  // lib/i18n и на этот контекст не подписаны.
  // TODO: remount гоняет bootstrap приложения (refreshTree и пр.) на каждую
  // смену языка, из-за этого подмаргивает. Поднять ключ глубже, мимо bootstrap.
  return (
    <I18nContext.Provider value={value}>
      <Fragment key={lang}>{children}</Fragment>
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
