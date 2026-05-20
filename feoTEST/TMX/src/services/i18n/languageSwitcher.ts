/**
 * Language switcher service.
 * Handles EN/RU toggle with localStorage persistence and page reload.
 */
import i18next from 'i18next';
import { persistConfigToStorage } from 'services/settings/settingsStorage';

const LANG_KEY = 'tmx.language';

export function getCurrentLanguage(): string {
  return localStorage.getItem(LANG_KEY) || 'en';
}

export function setLanguage(lang: string): void {
  // Write to BOTH storage locations so both i18n.ts (reads tmx.language)
  // and resolveBootLanguage() in initialState.ts (reads tmx_settings.language
  // + languageExplicit) pick up the choice after reload.
  localStorage.setItem(LANG_KEY, lang);
  persistConfigToStorage({ language: lang, languageExplicit: true });
  void i18next.changeLanguage(lang).then(() => {
    window.location.reload();
  });
}

export function toggleLanguage(): void {
  const current = getCurrentLanguage();
  setLanguage(current === 'ru' ? 'en' : 'ru');
}

export function createLangToggleButton(): HTMLElement {
  const btn = document.createElement('button');
  btn.id = 'langToggle';
  const current = getCurrentLanguage();
  btn.textContent = current === 'ru' ? 'EN' : 'RU';
  btn.title = current === 'ru' ? 'Switch to English' : 'Переключить на русский';
  btn.style.cssText = [
    'cursor:pointer',
    'padding:1px 6px',
    'margin:0 4px',
    'border:1px solid currentColor',
    'border-radius:4px',
    'font-size:0.7em',
    'font-weight:bold',
    'background:transparent',
    'color:inherit',
    'opacity:0.8',
    'line-height:1.4',
    'letter-spacing:0.05em',
    'vertical-align:middle',
  ].join(';');
  btn.addEventListener('mouseover', () => { btn.style.opacity = '1'; });
  btn.addEventListener('mouseout', () => { btn.style.opacity = '0.8'; });
  btn.addEventListener('click', toggleLanguage);
  return btn;
}
