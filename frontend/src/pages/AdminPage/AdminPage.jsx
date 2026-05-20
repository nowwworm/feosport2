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

export default function AdminPage() {
  const [users,   setUsers]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

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

  useEffect(() => { loadUsers(); }, [loadUsers]);

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
                    <td className="admin-page__cell-id">{u.id}</td>

                    <td>{u.email}</td>

                    {/* Роль — выпадающий список */}
                    <td>
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
                    <td>
                      <button
                        className={`admin-page__badge${u.is_active ? ' admin-page__badge--active' : ' admin-page__badge--disabled'}`}
                        onClick={() => toggleActive(u)}
                        title={u.is_active ? 'Деактивировать' : 'Активировать'}
                      >
                        {u.is_active ? 'активен' : 'отключён'}
                      </button>
                    </td>

                    {/* Смена пароля */}
                    <td className="admin-page__cell-pwd">
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
                    </td>

                    <td className="admin-page__cell-date">
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
