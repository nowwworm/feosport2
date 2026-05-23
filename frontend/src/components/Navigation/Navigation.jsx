import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import './Navigation.scss';

// type: 'link' - internal NavLink, 'external' - opens in a new tab.
const TMX_URL = import.meta.env.VITE_TMX_URL || '/tmx/';

const NAV_ITEMS = [
  { to: '/',             label: 'Таблица',    icon: '◈', roles: null,                                    type: 'link' },
  { to: '/bracket',      label: 'Сетка',      icon: '⬡', roles: null,                                    type: 'link' },
  { to: '/judge',        label: 'Судья',      icon: '⊕', roles: ['judge', 'chief_judge', 'admin'],        type: 'link' },
  { to: '/chronometer',  label: 'Тайминг',    icon: '◷', roles: ['judge', 'chief_judge', 'admin'],        type: 'link' },
  { to: '/pilots',       label: 'Пилоты',     icon: '◉', roles: ['admin', 'chief_judge'],                 type: 'link' },
  { to: '/participants', label: 'Участники',  icon: '⊞', roles: ['admin'],                                type: 'link' },
  { to: TMX_URL,         label: 'TMX',        icon: '⬡', roles: ['admin', 'chief_judge'],                 type: 'external' },
  { to: '/penalties',    label: 'Штрафы',     icon: '⚖', roles: ['judge', 'chief_judge', 'admin', 'pilot'], type: 'link' },
  { to: '/admin',        label: 'Аккаунты',   icon: '⚙', roles: ['admin'],                                type: 'link' },
  { to: '/docs',         label: 'Справка',    icon: '?', roles: ['admin', 'chief_judge'],                  type: 'link' },
];

export default function Navigation() {
  const { user } = useAuth();

  const visible = NAV_ITEMS.filter(
    item => !item.roles || item.roles.includes(user?.role)
  );

  return (
    <nav className="nav-bar" aria-label="Основная навигация">
      {visible.map(item =>
        item.type === 'external' ? (
          <a
            key={item.to}
            href={item.to}
            target="_blank"
            rel="noopener noreferrer"
            className="nav-bar__item"
          >
            <span className="nav-bar__icon">{item.icon}</span>
            <span className="nav-bar__label">{item.label}</span>
            <span className="nav-bar__ext-mark" aria-hidden="true">↗</span>
          </a>
        ) : (
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
        )
      )}
    </nav>
  );
}
