import React from 'react';
import { NavLink } from 'react-router-dom';
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

export default function Navigation() {
  const { user } = useAuth();

  const visible = NAV_ITEMS.filter(
    item => !item.roles || item.roles.includes(user?.role)
  );

  return (
    <nav className="nav-bar" aria-label="Основная навигация">
      {visible.map(item => (
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
    </nav>
  );
}
