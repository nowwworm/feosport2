/**
 * DOM patcher for hardcoded strings in courthive-components bundle.
 * Uses MutationObserver to watch for English strings rendered by the
 * external component library and replaces them with the active locale.
 */
import i18next from 'i18next';

type PatchMap = Record<string, { ru: string; [lang: string]: string }>;

const TEXT_PATCHES: PatchMap = {
  // ── Policies page ──────────────────────────────────────────────────────────
  'Policy Catalog':          { ru: 'Каталог политик' },
  'Tournament Operations':   { ru: 'Операции турнира' },
  'Scoring & Results':       { ru: 'Счёт и результаты' },
  'Ranking Points':          { ru: 'Рейтинговые очки' },
  'By Type':                 { ru: 'По типу' },
  'By Event':                { ru: 'По соревнованию' },
  'builtin':                 { ru: 'встроенная' },
  'New policy':              { ru: 'Новая политика' },
  'New Ranking Policy':      { ru: 'Новая политика рейтинга' },
  'Policy name':             { ru: 'Название политики' },
  'Select a policy to edit': { ru: 'Выберите политику' },
  'Delete profile':          { ru: 'Удалить профиль' },

  // ── MatchUp / Inspector ────────────────────────────────────────────────────
  'MatchUp Catalog':  { ru: 'Каталог матчей' },
  'MatchUp Actions':  { ru: 'Действия с матчем' },
  'MatchUp Format':   { ru: 'Формат матча' },
  Inspector:          { ru: 'Инспектор' },
  'Filter matchUps':  { ru: 'Фильтр матчей' },

  // ── Draw / Structure ───────────────────────────────────────────────────────
  'Add Structure':    { ru: 'Добавить группу' },
  'Delete Structure': { ru: 'Удалить группу' },
  'Draw Configuration': { ru: 'Настройка сетки' },
  'Draw Ceremony':    { ru: 'Жеребьёвка' },
  'Draw Size':        { ru: 'Размер сетки' },
  'Draw types':       { ru: 'Типы сеток' },
  Drawing:            { ru: 'Жеребьёвка' },

  // ── Schedule ───────────────────────────────────────────────────────────────
  'Court Availability':  { ru: 'Доступность кортов' },
  'Court Grid':          { ru: 'Расписание кортов' },
  'Auto Layout':         { ru: 'Авторазметка' },
  'Inline Scoring':      { ru: 'Ввод счёта' },

  // ── Common actions ─────────────────────────────────────────────────────────
  Active:   { ru: 'Активен' },
  Apply:    { ru: 'Применить' },
  'Apply to': { ru: 'Применить к' },
  Available: { ru: 'Доступно' },
  Cancel:   { ru: 'Отмена' },
  Clear:    { ru: 'Очистить' },
  'Clear All': { ru: 'Очистить всё' },
  Close:    { ru: 'Закрыть' },
  'Close drawer': { ru: 'Закрыть панель' },
  Delete:   { ru: 'Удалить' },
  Edit:     { ru: 'Редактировать' },
  'Add format code': { ru: 'Добавить код формата' },

  // ── Rankings ───────────────────────────────────────────────────────────────
  Ranking:         { ru: 'Рейтинг' },
  'Ranking snapshot': { ru: 'Срез рейтинга' },
  RANKING:         { ru: 'РЕЙТИНГ' },

  // ── Scoring ────────────────────────────────────────────────────────────────
  Scoring:         { ru: 'Счёт' },
  'Save to Tournament': { ru: 'Сохранить в турнире' },

  // ── Templates page ─────────────────────────────────────────────────────────
  Topologies:              { ru: 'Топологии' },
  'Tie Formats':           { ru: 'Форматы тай-матчей' },
  Compositions:            { ru: 'Композиции' },
  'Topology Templates':    { ru: 'Шаблоны топологий' },
  'Tie Format Templates':  { ru: 'Шаблоны форматов' },
  'Composition Templates': { ru: 'Шаблоны композиций' },
  Default:                 { ru: 'По умолчанию' },
  'Select a template to view or click New': { ru: 'Выберите шаблон или нажмите «Новый»' },
  'New template':          { ru: 'Новый шаблон' },
  structures:              { ru: 'структур' },
  links:                   { ru: 'связей' },
  compositions:            { ru: 'композиций' },
  formats:                 { ru: 'форматов' },
  templates:               { ru: 'шаблонов' },

  // ── Compositions — форма редактирования ───────────────────────────────────
  'New Composition':       { ru: 'Новая композиция' },
  'Theme & Preset':        { ru: 'Тема и пресет' },
  'Load preset':           { ru: 'Загрузить пресет' },
  '— Load preset —':       { ru: '— Выбрать пресет —' },
  'Replaces all settings with a built-in composition.':
    { ru: 'Заменяет все настройки встроенной композицией.' },
  'Color theme':           { ru: 'Цветовая тема' },
  'Changes only the color scheme, not the display settings.':
    { ru: 'Меняет только цветовую схему, не затрагивая настройки отображения.' },
  Colors:                  { ru: 'Цвета' },
  Display:                 { ru: 'Отображение' },
  'Nationality flags':     { ru: 'Флаги стран' },
  'Seeding style':         { ru: 'Стиль посева' },
  None:                    { ru: 'Нет' },
  'Seed element':          { ru: 'Элемент посева' },
  'Draw positions (1st round)': { ru: 'Позиции (1-й раунд)' },
  'Draw positions (all rounds)': { ru: 'Позиции (все раунды)' },
  'Team logo':             { ru: 'Логотип команды' },
  Score:                   { ru: 'Счёт' },
  'Score box':             { ru: 'Блок счёта' },
  'Game score only':       { ru: 'Только геймовый счёт' },
  'Game Score Display':    { ru: 'Отображение счёта' },
  Position:                { ru: 'Позиция' },
  Inverted:                { ru: 'Инверсия' },
  Preview:                 { ru: 'Предпросмотр' },
  'CONNECTOR PREVIEW':     { ru: 'ПРЕДПРОСМОТР СВЯЗЕЙ' },
  Qualifier:               { ru: 'Квалификация' },
  Save:                    { ru: 'Сохранить' },

  // ── Tournaments page feature cards ─────────────────────────────────────────
  'Tournament Management': { ru: 'Управление турниром' },
  'Smart Scheduling':      { ru: 'Умное расписание' },
  'Participant Tracking':  { ru: 'Учёт участников' },
  'Live Scoring':          { ru: 'Живой счёт' },
  'Create events, manage draws, and run tournaments from start to finish.':
    { ru: 'Создавайте соревнования, управляйте сетками и проводите турниры от начала до конца.' },
  'Assign courts, manage time slots, and handle schedule conflicts.':
    { ru: 'Назначайте площадки, управляйте временными слотами и разрешайте конфликты в расписании.' },
  'Register players, manage ratings, and seed draws automatically.':
    { ru: 'Регистрируйте игроков, управляйте рейтингами и автоматически расставляйте сетки.' },
  'Score matches in real time with automatic draw progression.':
    { ru: 'Вводите результаты матчей в реальном времени с автоматическим продвижением по сетке.' },

  // ── Settings page (beta features) ─────────────────────────────────────────
  'Ask TMX assistant': { ru: 'Помощник TMX' },
  'Format Wizard':     { ru: 'Мастер форматов' },
};

const PLACEHOLDER_PATCHES: PatchMap = {
  'Search matchUps...': { ru: 'Поиск матчей...' },
  'Search policies...': { ru: 'Поиск политик...' },
  'Search participants...': { ru: 'Поиск участников...' },
  'Additional information...': { ru: 'Дополнительная информация...' },
};

function getLang(): string {
  return i18next.language || localStorage.getItem('tmx.language') || 'en';
}

function patchText(node: Text): void {
  const lang = getLang();
  if (lang === 'en') return;
  const val = node.nodeValue?.trim();
  if (!val) return;
  const patch = TEXT_PATCHES[val];
  if (patch?.[lang]) node.nodeValue = patch[lang];
}

function patchElement(el: Element): void {
  const lang = getLang();
  if (lang === 'en') return;

  // Text content nodes
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) patchText(child as Text);
  }

  // Placeholders (inputs)
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const patch = PLACEHOLDER_PATCHES[el.placeholder];
    if (patch?.[lang]) el.placeholder = patch[lang];
  }

  // Recurse into children
  for (const child of Array.from(el.children)) patchElement(child);
}

let observer: MutationObserver | null = null;

export function startDomPatcher(): void {
  if (observer) return;

  observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'childList') {
        for (const node of Array.from(m.addedNodes)) {
          if (node.nodeType === Node.ELEMENT_NODE) patchElement(node as Element);
          else if (node.nodeType === Node.TEXT_NODE) patchText(node as Text);
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  // Patch anything already in the DOM
  patchElement(document.body);
}
