import i18next from 'i18next';
import en from './locales/en.json';
import ru from './locales/ru.json';

// English and Russian are bundled for instant first paint without network round-trips.
// All other locales are fetched at runtime from CFS via `ensureLocaleCurrent()`.
i18next.init({
  lng: localStorage.getItem('tmx.language') || 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  resources: {
    en: { translation: en },
    ru: { translation: ru },
  },
});

export const t = i18next.t.bind(i18next);
export default i18next;
