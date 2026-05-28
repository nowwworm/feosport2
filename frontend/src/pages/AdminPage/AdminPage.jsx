import React, { useEffect, useState, useCallback } from 'react';
import api    from '../../services/api';
import Header from '../../components/Header/Header';
import './AdminPage.scss';

const ROLES = ['admin', 'chief_judge', 'judge', 'pilot'];
const ROLE_LABEL = {
  admin:       'Администратор',
  chief_judge: 'Главный судья',
  judge:       'Судья',
  pilot:       'Пилот',
};

const EMPTY_FORM = { email: '', password: '', role: 'judge' };
const TMX_URL = import.meta.env.VITE_TMX_URL || '/tmx/';
const TMX_LINKS = [
  { label: 'Турниры', href: '#/tournaments' },
  { label: 'Топологии', href: '#/templates/topologies' },
  { label: 'Форматы матчей', href: '#/templates/tieformats' },
  { label: 'Композиции', href: '#/templates/compositions' },
  { label: 'Политики', href: '#/policies' },
  { label: 'Настройки', href: '#/settings' },
];

function tmxHref(hash = '') {
  if (!hash) return TMX_URL;
  return `${TMX_URL.replace(/\/?$/, '/')}${hash}`;
}

export default function AdminPage() {
  const [users,   setUsers]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [dbStatus, setDbStatus] = useState(null);
  const [dbLoading, setDbLoading] = useState(true);
  const [dbError, setDbError] = useState('');
  const [pgAdminStarting, setPgAdminStarting] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoResult, setDemoResult] = useState(null);
  const [demoError, setDemoError] = useState('');

  const [form,      setForm]      = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [formSaving,setFormSaving]= useState(false);
  const [showForm,  setShowForm]  = useState(false);

  // inline password change per row
  const [editPwd,    setEditPwd]    = useState({}); // { [userId]: newPwd }
  const [savingPwd,  setSavingPwd]  = useState(null);
  const [savingRole, setSavingRole] = useState(null);

  const loadUsers = useCallback(() => {
    setLoading(true);
    setError('');
    api.get('/admin/users')
      .then(({ data }) => setUsers(data))
      .catch(() => setError('Ошибка загрузки пользователей'))
      .finally(() => setLoading(false));
  }, []);

  const loadDbStatus = useCallback(() => {
    setDbLoading(true);
    setDbError('');
    api.get('/admin/db/status')
      .then(({ data }) => setDbStatus(data))
      .catch((err) => setDbError(err.response?.data?.error || 'Ошибка проверки PostgreSQL'))
      .finally(() => setDbLoading(false));
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);
  useEffect(() => { loadDbStatus(); }, [loadDbStatus]);

  async function handleStartPgAdmin() {
    setPgAdminStarting(true);
    try {
      await api.post('/admin/db/pgadmin/start');
      loadDbStatus();
    } catch (err) {
      alert(err.response?.data?.error || 'Не удалось запустить pgAdmin');
    } finally {
      setPgAdminStarting(false);
    }
  }

  async function handleGenerateDemoData() {
    setDemoLoading(true);
    setDemoResult(null);
    setDemoError('');
    try {
      const { data } = await api.post('/admin/demo-data');
      setDemoResult(data);
    } catch (err) {
      setDemoError(err.response?.data?.details || err.response?.data?.error || 'Не удалось сгенерировать тестовые данные');
    } finally {
      setDemoLoading(false);
    }
  }

  // ── Создание пользователя ──────────────────────────────────────────────────
  async function handleCreate(e) {
    e.preventDefault();
    setFormError('');
    if (!form.email.trim()) return setFormError('Введите e-mail');
    if (form.password.length < 6) return setFormError('Пароль минимум 6 символов');

    setFormSaving(true);
    try {
      await api.post('/admin/users', form);
      setForm(EMPTY_FORM);
      setShowForm(false);
      loadUsers();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Ошибка создания пользователя');
    } finally {
      setFormSaving(false);
    }
  }

  // ── Переключение активности ────────────────────────────────────────────────
  async function toggleActive(user) {
    try {
      await api.patch(`/admin/users/${user.id}`, { is_active: !user.is_active });
      setUsers(prev => prev.map(u =>
        u.id === user.id ? { ...u, is_active: !u.is_active } : u
      ));
    } catch {
      alert('Не удалось обновить статус');
    }
  }

  // ── Смена роли ─────────────────────────────────────────────────────────────
  async function handleRoleChange(user, newRole) {
    setSavingRole(user.id);
    try {
      await api.patch(`/admin/users/${user.id}`, { role: newRole });
      setUsers(prev => prev.map(u =>
        u.id === user.id ? { ...u, role: newRole } : u
      ));
    } catch {
      alert('Не удалось изменить роль');
    } finally {
      setSavingRole(null);
    }
  }

  // ── Смена пароля ───────────────────────────────────────────────────────────
  async function handleSavePwd(user) {
    const pwd = (editPwd[user.id] || '').trim();
    if (pwd.length < 6) return alert('Пароль минимум 6 символов');
    setSavingPwd(user.id);
    try {
      await api.patch(`/admin/users/${user.id}`, { password: pwd });
      setEditPwd(prev => { const n = { ...prev }; delete n[user.id]; return n; });
    } catch {
      alert('Не удалось сменить пароль');
    } finally {
      setSavingPwd(null);
    }
  }

  return (
    <div className="admin-page">
      <Header title="Управление пользователями" />

      <div className="admin-page__content">
        <section className="admin-page__db-panel">
          <div className="admin-page__db-head">
            <div>
              <h2>PostgreSQL</h2>
              <p>База {dbStatus?.connection?.database || 'feosport2'} · {dbStatus?.connection?.user || 'feosport'}@{dbStatus?.connection?.host || 'localhost'}:{dbStatus?.connection?.port || 5432}</p>
            </div>
            <div className="admin-page__db-actions">
              <button
                className="admin-page__btn admin-page__btn--secondary"
                type="button"
                onClick={loadDbStatus}
                disabled={dbLoading}
              >
                {dbLoading ? 'Проверка…' : 'Обновить'}
              </button>
              <button
                className="admin-page__btn admin-page__btn--primary"
                type="button"
                onClick={handleStartPgAdmin}
                disabled={pgAdminStarting || !dbStatus?.pgAdmin?.available}
                title={dbStatus?.pgAdmin?.available ? 'Открыть pgAdmin на сервере' : 'pgAdmin не найден на сервере'}
              >
                {pgAdminStarting ? 'Запуск…' : 'Открыть pgAdmin'}
              </button>
            </div>
          </div>

          {dbError && <p className="admin-page__db-error">{dbError}</p>}
          {!dbError && (
            <div className="admin-page__db-grid">
              <div>
                <span>Статус</span>
                <strong>{dbStatus?.ok ? 'Подключено' : dbLoading ? 'Проверка' : 'Нет данных'}</strong>
              </div>
              <div>
                <span>Базовые пользователи</span>
                <strong>{dbStatus?.baselineUsers ?? '—'}/4</strong>
              </div>
              <div>
                <span>pgAdmin</span>
                <strong>{dbStatus?.pgAdmin?.available ? 'Найден' : 'Не найден'}</strong>
              </div>
            </div>
          )}
        </section>

        <section className="admin-page__tmx-panel">
          <div className="admin-page__tmx-head">
            <div>
              <h2>TMX</h2>
              <p>Отдельный модуль турнирных сеток, шаблонов форматов, политик и печати сетки.</p>
            </div>
            <a
              className="admin-page__btn admin-page__btn--primary admin-page__tmx-main"
              href={tmxHref()}
              target="_blank"
              rel="noopener noreferrer"
            >
              Открыть TMX ↗
            </a>
          </div>
          <div className="admin-page__tmx-links" aria-label="Быстрые ссылки TMX">
            {TMX_LINKS.map(link => (
              <a
                key={link.href}
                className="admin-page__tmx-link"
                href={tmxHref(link.href)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {link.label}
              </a>
            ))}
          </div>
        </section>

        <section className="admin-page__demo-panel">
          <div className="admin-page__demo-head">
            <div>
              <h2>Демо-данные</h2>
              <p>Создаёт витринный набор для презентации: Кубок Севастополя 2025, команды, пилоты, судьи, заявки, документы, дроны, вылеты, штрафы, протест и протоколы.</p>
            </div>
            <button
              className="admin-page__btn admin-page__btn--primary admin-page__demo-main"
              type="button"
              onClick={handleGenerateDemoData}
              disabled={demoLoading}
            >
              {demoLoading ? 'Генерация…' : 'Сгенерировать тестовые данные'}
            </button>
          </div>

          {demoError && (
            <p className="admin-page__demo-error">{demoError}</p>
          )}

          {demoResult && (
            <div className="admin-page__demo-result">
              <strong>{demoResult.competition_name}</strong>
              <span>ID соревнования: {demoResult.competition_id}</span>
              <span>Команды: {demoResult.summary?.teams}</span>
              <span>Пилоты: {demoResult.summary?.pilots}</span>
              <span>Вылеты: {demoResult.summary?.heats}</span>
              <span>Протоколы: {demoResult.summary?.protocols}</span>
            </div>
          )}
        </section>

        {/* ── Кнопка добавить ──────────────────────────────────────────── */}
        <div className="admin-page__toolbar">
          <button
            className="admin-page__btn admin-page__btn--primary"
            onClick={() => setShowForm(v => !v)}
          >
            {showForm ? '✕ Отмена' : '+ Новый пользователь'}
          </button>
        </div>

        {/* ── Форма создания ────────────────────────────────────────────── */}
        {showForm && (
          <form className="admin-page__form" onSubmit={handleCreate}>
            <h3 className="admin-page__form-title">Новый пользователь</h3>

            <label className="admin-page__field">
              <span>E-mail</span>
              <input
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="user@example.com"
                autoComplete="off"
              />
            </label>

            <label className="admin-page__field">
              <span>Пароль</span>
              <input
                type="password"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder="мин. 6 символов"
                autoComplete="new-password"
              />
            </label>

            <label className="admin-page__field">
              <span>Роль</span>
              <select
                value={form.role}
                onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
              >
                {ROLES.map(r => (
                  <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                ))}
              </select>
            </label>

            {formError && (
              <p className="admin-page__form-error">{formError}</p>
            )}

            <button
              className="admin-page__btn admin-page__btn--primary"
              type="submit"
              disabled={formSaving}
            >
              {formSaving ? 'Сохранение…' : 'Создать'}
            </button>
          </form>
        )}

        {/* ── Состояния загрузки ────────────────────────────────────────── */}
        {loading && <p className="admin-page__state">Загрузка…</p>}
        {error   && <p className="admin-page__state admin-page__state--error">{error}</p>}

        {/* ── Таблица пользователей ─────────────────────────────────────── */}
        {!loading && !error && (
          <div className="admin-page__table-wrap">
            <table className="admin-page__table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>E-mail</th>
                  <th>Роль</th>
                  <th>Статус</th>
                  <th>Пароль</th>
                  <th>Зарегистрирован</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr
                    key={u.id}
                    className={`admin-page__row${!u.is_active ? ' admin-page__row--inactive' : ''}`}
                  >
                    <td className="admin-page__cell-id" data-label="#">{u.id}</td>

                    <td data-label="E-mail">{u.email}</td>

                    {/* Роль — выпадающий список */}
                    <td data-label="Роль">
                      <select
                        className="admin-page__select"
                        value={u.role}
                        disabled={savingRole === u.id}
                        onChange={e => handleRoleChange(u, e.target.value)}
                      >
                        {ROLES.map(r => (
                          <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                        ))}
                      </select>
                    </td>

                    {/* Активность */}
                    <td data-label="Статус">
                      <button
                        className={`admin-page__badge${u.is_active ? ' admin-page__badge--active' : ' admin-page__badge--disabled'}`}
                        onClick={() => toggleActive(u)}
                        title={u.is_active ? 'Деактивировать' : 'Активировать'}
                      >
                        {u.is_active ? 'активен' : 'отключён'}
                      </button>
                    </td>

                    {/* Смена пароля */}
                    <td className="admin-page__cell-pwd" data-label="Пароль">
                      <div>
                        <input
                          type="password"
                          placeholder="новый пароль"
                          value={editPwd[u.id] || ''}
                          onChange={e => setEditPwd(p => ({ ...p, [u.id]: e.target.value }))}
                          className="admin-page__pwd-input"
                          autoComplete="new-password"
                        />
                        {editPwd[u.id] && (
                          <button
                            className="admin-page__btn admin-page__btn--sm"
                            disabled={savingPwd === u.id}
                            onClick={() => handleSavePwd(u)}
                          >
                            {savingPwd === u.id ? '…' : '✓'}
                          </button>
                        )}
                      </div>
                    </td>

                    <td className="admin-page__cell-date" data-label="Зарегистрирован">
                      {new Date(u.created_at).toLocaleDateString('ru-RU')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
