import React, { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import './Navigation.scss';

const NAV_ITEMS = [
  { to: '/',             label: 'Таблица',    icon: '◈', roles: null,                                    type: 'link' },
  { to: '/bracket',      label: 'Сетка',      icon: '⬡', roles: null,                                    type: 'link' },
  { to: '/judge',        label: 'Судья',      icon: '⊕', roles: ['judge', 'chief_judge', 'admin'],        type: 'link' },
  { to: '/chronometer',  label: 'Тайминг',    icon: '◷', roles: ['judge', 'chief_judge', 'admin'],        type: 'link' },
  { to: '/pilots',       label: 'Пилоты',     icon: '◉', roles: ['admin', 'chief_judge'],                 type: 'link' },
  { to: '/participants', label: 'Участники',  icon: '⊞', roles: ['admin'],                                type: 'link' },
  { to: '/penalties',    label: 'Штрафы',     icon: '⚖', roles: ['judge', 'chief_judge', 'admin', 'pilot'], type: 'link' },
  { to: '/protocols',    label: 'Протоколы',  icon: '📄', roles: ['judge', 'chief_judge', 'admin'],         type: 'link' },
  { to: '/admin',        label: 'Аккаунты',   icon: '⚙', roles: ['admin'],                                type: 'link' },
  { to: '/docs',         label: 'Справка',    icon: '?', roles: ['admin', 'chief_judge'],                  type: 'link' },
];

const MAX_PRIMARY = 4;

export default function Navigation() {
  const { user } = useAuth();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);

  const visible = NAV_ITEMS.filter(
    item => !item.roles || item.roles.includes(user?.role)
  );

  const useMoreSlot = visible.length > MAX_PRIMARY;
  const primary = useMoreSlot ? visible.slice(0, MAX_PRIMARY) : visible;
  const extra   = useMoreSlot ? visible.slice(MAX_PRIMARY) : [];

  const extraActive = extra.some(item => item.to === location.pathname);

  // Close the drawer whenever the route changes (after the user taps an item
  // inside it). This also keeps the drawer in sync with browser back/forward.
  useEffect(() => {
    setMoreOpen(false);
  }, [location.pathname]);

  // Esc closes the drawer.
  useEffect(() => {
    if (!moreOpen) return;
    function onKey(e) {
      if (e.key === 'Escape') setMoreOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moreOpen]);

  return (
    <>
      <nav className="nav-bar" aria-label="Основная навигация">
        {primary.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `nav-bar__item${isActive ? ' nav-bar__item--active' : ''}`
            }
          >
            <span className="nav-bar__icon">{item.icon}</span>
            <span className="nav-bar__label">{item.label}</span>
          </NavLink>
        ))}

        {useMoreSlot && (
          <button
            type="button"
            className={`nav-bar__item nav-bar__item--more${extraActive ? ' nav-bar__item--active' : ''}`}
            onClick={() => setMoreOpen(v => !v)}
            aria-expanded={moreOpen}
            aria-controls="nav-more-drawer"
          >
            <span className="nav-bar__icon">⋯</span>
            <span className="nav-bar__label">Ещё</span>
          </button>
        )}
      </nav>

      {useMoreSlot && (
        <MoreDrawer
          open={moreOpen}
          items={extra}
          onClose={() => setMoreOpen(false)}
        />
      )}
    </>
  );
}

function MoreDrawer({ open, items, onClose }) {
  // Mounted regardless of `open` so CSS transitions can run; visibility is
  // toggled via the data-open attribute below.
  return (
    <div
      className="nav-drawer-backdrop"
      data-open={open ? 'true' : 'false'}
      onClick={onClose}
      role="presentation"
    >
      <div
        id="nav-more-drawer"
        className="nav-drawer"
        role="dialog"
        aria-label="Дополнительные разделы"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="nav-drawer__handle" aria-hidden="true" />
        <ul className="nav-drawer__list">
          {items.map(item => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `nav-drawer__item${isActive ? ' nav-drawer__item--active' : ''}`
                }
                onClick={onClose}
              >
                <span className="nav-drawer__icon">{item.icon}</span>
                <span className="nav-drawer__label">{item.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
