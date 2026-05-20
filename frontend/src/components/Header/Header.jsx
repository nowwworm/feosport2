import React from 'react';
import { useAuth } from '../../context/AuthContext';
import './Header.scss';

export default function Header({ title }) {
  const { user, logout } = useAuth();

  return (
    <header className="header">
      <span className="header__title">{title || 'FeoSport'}</span>
      {user && (
        <div className="header__user">
          <span className="header__role">{user.role}</span>
          <button className="header__logout" onClick={logout}>Выход</button>
        </div>
      )}
    </header>
  );
}
