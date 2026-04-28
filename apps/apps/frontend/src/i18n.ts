import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import HttpBackend from "i18next-http-backend";
import LanguageDetector from "i18next-browser-languagedetector";

i18n
  .use(HttpBackend)          // load translation files
  .use(LanguageDetector)     // detect user language (query/localStorage/navigator)
  .use(initReactI18next)     // connect to React
  .init({
    fallbackLng: "en",
    supportedLngs: ["en", "es", "th"], // your languages
    ns: ["common"],                    // namespaces
    defaultNS: "common",
    debug: false,                      // set true while building
    interpolation: { escapeValue: false },
    backend: {
      // where files live:
      loadPath: "/locales/{{lng}}/{{ns}}.json",
    },
    detection: {
      order: ["querystring", "localStorage", "navigator", "htmlTag"],
      caches: ["localStorage"],
    },
  });

// Keep <html lang> and dir in sync:
const setHtmlAttrs = (lng: string) => {
  document.documentElement.lang = lng;
  document.documentElement.dir = ["ar","he","fa","ur"].includes(lng) ? "rtl" : "ltr";
};
setHtmlAttrs(i18n.resolvedLanguage);
i18n.on("languageChanged", setHtmlAttrs);

export default i18n;
