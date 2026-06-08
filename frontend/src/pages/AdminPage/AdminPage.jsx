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
const JUDGE_FORM_ID = '245211';
const JUDGE_REGIONS = [
  'Центральный',
  'Северо-Западный',
  'Южный',
  'Северо-Кавказский',
  'Приволжский',
  'Уральский',
  'Сибирский',
  'Дальневосточный',
];
const JUDGE_CATEGORIES = [
  'Национальная',
  'Региональная',
  'Местная',
  'Без категории',
];
const JUDGE_DISCIPLINES = [
  'Технический симулятор',
  'ЛЗ/КЗ (класс А)',
  'ЛЗ/КЗ (класс Б)',
  'ЛЗ/КЗ (класс В)',
  'Другая дисциплина (укажите)',
];
const EMPTY_JUDGE_FORM = {
  birth_date: '',
  phone: '',
  email: '',
  region: 'Центральный',
  judge_category: 'Национальная',
  coaching_experience_years: '0',
  judge_disciplines: [],
  additional_info: '',
};
// Ярлык строки импорта: ФИО, затем email — из самого элемента или из entry
// (ошибки несут entry целиком, успешные строки — только fio/email).
function importItemLabel(item) {
  return item.fio || item.entry?.fio || item.email || item.entry?.email || '(без имени)';
}

function ImportResultGroup({ title, items, tone, renderExtra }) {
  if (!items?.length) return null;
  return (
    <details className={`admin-page__import-group admin-page__import-group--${tone}`} open>
      <summary>{title} · {items.length}</summary>
      <ul className="admin-page__import-list">
        {items.slice(0, 50).map((it, i) => (
          <li key={i}>
            <span className="admin-page__import-row">{it.row ? `строка ${it.row}` : `#${it.index}`}</span>
            <span className="admin-page__import-name">{importItemLabel(it)}</span>
            {renderExtra ? renderExtra(it) : null}
          </li>
        ))}
        {items.length > 50 && <li className="admin-page__import-more">…ещё {items.length - 50}</li>}
      </ul>
    </details>
  );
}

// Подробный результат bulk-импорта (пилоты и судьи): цветной баннер статуса,
// человекочитаемый итог и по-строчная разбивка созданных/обновлённых/ошибок.
function ImportResultDetails({ result }) {
  if (!result) return null;
  const created = result.created || [];
  const updated = result.updated || [];
  const errors  = result.errors  || [];

  const status = errors.length === 0
    ? 'ok'
    : (created.length + updated.length > 0 ? 'partial' : 'fail');
  const statusText = {
    ok:      'Импорт завершён успешно',
    partial: 'Импорт завершён с ошибками',
    fail:    'Импорт не выполнен',
  }[status];
  const statusIcon = { ok: '✓', partial: '!', fail: '×' }[status];

  const parts = [];
  if (created.length) parts.push(`добавлено ${created.length}`);
  if (updated.length) parts.push(`обновлено ${updated.length}`);
  if (errors.length)  parts.push(`ошибок ${errors.length}`);
  const summary = parts.length ? parts.join(', ') : 'нет записей';

  return (
    <div className={`admin-page__import-result admin-page__import-result--${status}`}>
      <div className="admin-page__import-banner">
        <span className="admin-page__import-banner-icon">{statusIcon}</span>
        <div>
          <strong>{statusText}</strong>
          <div className="admin-page__import-banner-sub">
            {result.source
              ? `${result.source.filename} · форма ${result.source.form} · строк ${result.source.rows} · `
              : ''}
            {summary}
          </div>
        </div>
      </div>

      <div className="admin-page__import-stats">
        <span className="admin-page__import-stat admin-page__import-stat--ok">＋ Создано {created.length}</span>
        <span className="admin-page__import-stat admin-page__import-stat--upd">↻ Обновлено {updated.length}</span>
        <span className={`admin-page__import-stat admin-page__import-stat--err${errors.length ? ' is-active' : ''}`}>✗ Ошибок {errors.length}</span>
      </div>

      <ImportResultGroup
        title="Созданные" items={created} tone="ok"
        renderExtra={(it) => <span className="admin-page__import-id">id {it.pilot_id || it.id}</span>}
      />
      <ImportResultGroup
        title="Обновлённые" items={updated} tone="upd"
        renderExtra={(it) => <span className="admin-page__import-id">id {it.pilot_id || it.id}</span>}
      />
      <ImportResultGroup
        title="Ошибки" items={errors} tone="err"
        renderExtra={(it) => <span className="admin-page__import-reason">{it.reason || (it.issues || []).map(x => `${x.path} — ${x.message}`).join('; ')}</span>}
      />
    </div>
  );
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

  // Pilot bulk-import (FormDesigner-форма 245167 или ручной JSON)
  const [importOpen,    setImportOpen]    = useState(false);
  const [importJson,    setImportJson]    = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [importResult,  setImportResult]  = useState(null);
  const [importError,   setImportError]   = useState('');
  const [importFile,    setImportFile]    = useState(null);
  const [fileImportLoading, setFileImportLoading] = useState(false);

  // Judge bulk-import (FormDesigner-форма 245211 или ручной JSON)
  const [judgeImportOpen,    setJudgeImportOpen]    = useState(false);
  const [judgeImportJson,    setJudgeImportJson]    = useState('');
  const [judgeImportLoading, setJudgeImportLoading] = useState(false);
  const [judgeImportResult,  setJudgeImportResult]  = useState(null);
  const [judgeImportError,   setJudgeImportError]   = useState('');
  const [judgeImportFile,    setJudgeImportFile]    = useState(null);
  const [judgeFileImportLoading, setJudgeFileImportLoading] = useState(false);
  const [judgeFormOpen, setJudgeFormOpen] = useState(false);
  const [judgeForm, setJudgeForm] = useState(EMPTY_JUDGE_FORM);
  const [judgeFormSaving, setJudgeFormSaving] = useState(false);
  const [judgeFormError, setJudgeFormError] = useState('');
  const [judgeFormResult, setJudgeFormResult] = useState(null);

  const [form,      setForm]      = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [formSaving,setFormSaving]= useState(false);
  const [showForm,  setShowForm]  = useState(false);

  // inline password change per row
  const [editPwd,    setEditPwd]    = useState({}); // { [userId]: newPwd }
  const [savingPwd,  setSavingPwd]  = useState(null);
  const [savingRole, setSavingRole] = useState(null);
  const [deletingUser, setDeletingUser] = useState(null);

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

  // ── Импорт пилотов ─────────────────────────────────────────────────────────
  async function handleImportPilots() {
    setImportError('');
    setImportResult(null);
    let entries;
    try {
      const parsed = JSON.parse(importJson);
      entries = Array.isArray(parsed) ? parsed : parsed.entries;
      if (!Array.isArray(entries) || entries.length === 0) {
        throw new Error('Ожидался массив [...] или объект { entries: [...] }');
      }
    } catch (e) {
      setImportError(`Ошибка разбора JSON: ${e.message}`);
      return;
    }

    setImportLoading(true);
    try {
      const { data } = await api.post('/pilots/import', { entries });
      setImportResult(data);
    } catch (err) {
      const details = err.response?.data?.details;
      if (Array.isArray(details)) {
        setImportError(details.map(d => `${d.path}: ${d.message}`).join('; '));
      } else {
        setImportError(err.response?.data?.error || err.message);
      }
    } finally {
      setImportLoading(false);
    }
  }

  async function handleImportPilotsXlsx() {
    if (!importFile) {
      setImportError('Выбери .xlsx файл');
      return;
    }
    setImportError('');
    setImportResult(null);
    setFileImportLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', importFile);
      const { data } = await api.post('/pilots/import/xlsx', formData);
      setImportResult(data);
    } catch (err) {
      setImportError(err.response?.data?.error || err.message);
    } finally {
      setFileImportLoading(false);
    }
  }

  // ── Импорт судей ──────────────────────────────────────────────────────────
  async function handleImportJudges() {
    setJudgeImportError('');
    setJudgeImportResult(null);
    let entries;
    try {
      const parsed = JSON.parse(judgeImportJson);
      entries = Array.isArray(parsed) ? parsed : parsed.entries;
      if (!Array.isArray(entries) || entries.length === 0) {
        throw new Error('Ожидался массив [...] или объект { entries: [...] }');
      }
    } catch (e) {
      setJudgeImportError(`Ошибка разбора JSON: ${e.message}`);
      return;
    }

    setJudgeImportLoading(true);
    try {
      const { data } = await api.post('/admin/judges/import', { entries });
      setJudgeImportResult(data);
      loadUsers();  // refresh users list — судьи попадут в таблицу
    } catch (err) {
      setJudgeImportError(err.response?.data?.error || err.message);
    } finally {
      setJudgeImportLoading(false);
    }
  }

  async function handleImportJudgesXlsx() {
    if (!judgeImportFile) {
      setJudgeImportError('Выбери .xlsx файл');
      return;
    }
    setJudgeImportError('');
    setJudgeImportResult(null);
    setJudgeFileImportLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', judgeImportFile);
      const { data } = await api.post('/admin/judges/import/xlsx', formData);
      setJudgeImportResult(data);
      loadUsers();
    } catch (err) {
      setJudgeImportError(err.response?.data?.error || err.message);
    } finally {
      setJudgeFileImportLoading(false);
    }
  }

  function toggleJudgeDiscipline(discipline) {
    setJudgeForm(current => {
      const selected = new Set(current.judge_disciplines);
      if (selected.has(discipline)) selected.delete(discipline);
      else selected.add(discipline);
      return { ...current, judge_disciplines: Array.from(selected) };
    });
  }

  async function handleCreateJudge(e) {
    e.preventDefault();
    setJudgeFormError('');
    setJudgeFormResult(null);

    const coachingYears = Number(judgeForm.coaching_experience_years);
    if (!judgeForm.birth_date) return setJudgeFormError('Укажите дату рождения');
    if (!judgeForm.phone.trim()) return setJudgeFormError('Введите телефон');
    if (!judgeForm.email.trim()) return setJudgeFormError('Введите email');
    if (!Number.isInteger(coachingYears) || coachingYears < 0 || coachingYears > 80) {
      return setJudgeFormError('Опыт тренерской работы должен быть целым числом от 0 до 80');
    }
    if (judgeForm.judge_disciplines.length === 0) {
      return setJudgeFormError('Выберите хотя бы одну дисциплину для судейства');
    }

    setJudgeFormSaving(true);
    try {
      const { data } = await api.post('/admin/judges/import', {
        entries: [{
          birth_date: judgeForm.birth_date,
          phone: judgeForm.phone.trim(),
          email: judgeForm.email.trim(),
          region: judgeForm.region,
          judge_category: judgeForm.judge_category,
          coaching_experience_years: coachingYears,
          has_coaching_experience: coachingYears > 0,
          judge_disciplines: judgeForm.judge_disciplines,
          additional_info: judgeForm.additional_info.trim() || null,
        }],
      });

      if (data.errors?.length) {
        const firstError = data.errors[0];
        const message = firstError.reason || firstError.issues?.map(issue => `${issue.path}: ${issue.message}`).join('; ');
        setJudgeFormError(message || 'Не удалось добавить судью');
        return;
      }

      setJudgeFormResult(data);
      setJudgeForm(EMPTY_JUDGE_FORM);
      loadUsers();
    } catch (err) {
      setJudgeFormError(err.response?.data?.error || err.message);
    } finally {
      setJudgeFormSaving(false);
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

  // ── Удаление пользователя ──────────────────────────────────────────────────
  async function handleDeleteUser(user) {
    if (!window.confirm(`Удалить пользователя ${user.email}? Действие необратимо.`)) return;
    setDeletingUser(user.id);
    try {
      await api.delete(`/admin/users/${user.id}`);
      setUsers(prev => prev.filter(u => u.id !== user.id));
    } catch (err) {
      alert(err.response?.data?.error || 'Не удалось удалить пользователя');
    } finally {
      setDeletingUser(null);
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

        <section className="admin-page__demo-panel">
          <div className="admin-page__demo-head">
            <div>
              <h2>Импорт пилотов</h2>
              <p>
                Bulk-импорт участников по схеме FormDesigner-формы{' '}
                <a href="https://formdesigner.ru/form/view/245167" target="_blank" rel="noopener noreferrer">245167</a>.
                Валидация ФИО, даты рождения, телефона, email, классов, TBS/ELRS/VTX и канала через Zod. Дедупликация по{' '}
                <code>external_id</code>.
              </p>
            </div>
            <button
              className="admin-page__btn admin-page__btn--primary admin-page__demo-main"
              type="button"
              onClick={() => setImportOpen(v => !v)}
            >
              {importOpen ? '✕ Закрыть форму' : 'Открыть форму импорта'}
            </button>
          </div>

          {importOpen && (
            <div className="admin-page__import-body" style={{ marginTop: '1rem' }}>
              <div style={{ display: 'flex', gap: '.75rem', alignItems: 'center', flexWrap: 'wrap', margin: '0 0 .75rem' }}>
                <input
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={e => setImportFile(e.target.files?.[0] || null)}
                />
                <button
                  className="admin-page__btn admin-page__btn--primary"
                  type="button"
                  onClick={handleImportPilotsXlsx}
                  disabled={fileImportLoading || !importFile}
                >
                  {fileImportLoading ? 'Загрузка…' : 'Загрузить XLSX'}
                </button>
              </div>
              <p style={{ margin: '0 0 .5rem' }}>
                XLSX: первая строка — заголовки формы 245167. JSON: массив пилотов или объект <code>{'{ entries: [...] }'}</code>.
                Поддерживаются поля: ФИО, Email, Телефон, Дата рождения, Наличие разряда, Наименование команды,
                Технический симулятор, 75й класс командный, 75й класс личный, Дополнительная информация,
                Система управления, VTX тип, VTX канал, external_id.
              </p>
              <details style={{ margin: '0 0 .75rem' }}>
                <summary style={{ cursor: 'pointer' }}>Пример одной записи</summary>
                <pre style={{ background: '#1a1a1a', padding: '.75rem', borderRadius: 4, fontSize: 12, overflow: 'auto' }}>
{`[
  {
    "fio": "Иванов Петр Сергеевич",
    "email": "petr@example.com",
    "phone": "+7 (999) 123-45-67",
    "birth_date": "1995-04-12",
    "has_rank": true,
    "team": "Феодосия FPV",
    "radio_system": "ELRS 2,4GHz",
    "vtx_type": "HD Zero",
    "vtx_channel": "R3",
    "drone_simulator": "Liftoff",
    "class_75_team": true,
    "class_75_individual": false,
    "notes": "Готов участвовать в командном классе",
    "external_id": "fd-245167-001"
  }
]`}
                </pre>
              </details>
              <textarea
                className="admin-page__import-textarea"
                value={importJson}
                onChange={e => setImportJson(e.target.value)}
                rows={12}
                placeholder='[{"fio": "Иванов И. И.", "external_id": "001"}]'
                style={{ width: '100%', fontFamily: 'monospace', fontSize: 13, padding: '.5rem', boxSizing: 'border-box' }}
              />
              <div style={{ marginTop: '.75rem' }}>
                <button
                  className="admin-page__btn admin-page__btn--primary"
                  type="button"
                  onClick={handleImportPilots}
                  disabled={importLoading || !importJson.trim()}
                >
                  {importLoading ? 'Импорт…' : 'Импортировать'}
                </button>
              </div>

              {importError && (
                <p className="admin-page__demo-error" style={{ marginTop: '.75rem' }}>{importError}</p>
              )}

              {importResult && <ImportResultDetails result={importResult} />}
            </div>
          )}
        </section>

        {/* ── Добавление и импорт судей ─────────────────────────────────── */}
        <section className="admin-page__demo-panel">
          <div className="admin-page__demo-head">
            <div>
              <h2>Судейский корпус</h2>
              <p>
                Добавление и bulk-импорт судей по схеме FormDesigner-формы{' '}
                <a href={`https://formdesigner.ru/form/view/${JUDGE_FORM_ID}`} target="_blank" rel="noopener noreferrer">{JUDGE_FORM_ID}</a>.
                Валидация регионов / категорий / дисциплин через Zod. Дедупликация по{' '}
                <code>external_id</code>, при отсутствии — по <code>email</code>.
              </p>
            </div>
            <div className="admin-page__panel-actions">
              <button
                className="admin-page__btn admin-page__btn--primary admin-page__demo-main"
                type="button"
                onClick={() => setJudgeFormOpen(v => !v)}
              >
                {judgeFormOpen ? 'Закрыть добавление' : 'Добавить судью'}
              </button>
              <button
                className="admin-page__btn admin-page__btn--secondary admin-page__demo-main"
                type="button"
                onClick={() => setJudgeImportOpen(v => !v)}
              >
                {judgeImportOpen ? 'Закрыть импорт' : 'Импорт XLSX/JSON'}
              </button>
            </div>
          </div>

          {judgeFormOpen && (
            <form className="admin-page__judge-form" onSubmit={handleCreateJudge}>
              <div className="admin-page__judge-grid">
                <label className="admin-page__field">
                  <span>Дата рождения</span>
                  <input
                    type="date"
                    value={judgeForm.birth_date}
                    onChange={e => setJudgeForm(f => ({ ...f, birth_date: e.target.value }))}
                    required
                  />
                </label>

                <label className="admin-page__field">
                  <span>Телефон</span>
                  <input
                    type="tel"
                    value={judgeForm.phone}
                    onChange={e => setJudgeForm(f => ({ ...f, phone: e.target.value }))}
                    placeholder="+7 (___) ___-__-__"
                    autoComplete="tel"
                    required
                  />
                </label>

                <label className="admin-page__field">
                  <span>Email</span>
                  <input
                    type="email"
                    value={judgeForm.email}
                    onChange={e => setJudgeForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="judge@example.com"
                    autoComplete="email"
                    required
                  />
                </label>

                <label className="admin-page__field">
                  <span>Регион</span>
                  <select
                    value={judgeForm.region}
                    onChange={e => setJudgeForm(f => ({ ...f, region: e.target.value }))}
                  >
                    {JUDGE_REGIONS.map(region => (
                      <option key={region} value={region}>{region}</option>
                    ))}
                  </select>
                </label>

                <label className="admin-page__field">
                  <span>Категория судьи</span>
                  <select
                    value={judgeForm.judge_category}
                    onChange={e => setJudgeForm(f => ({ ...f, judge_category: e.target.value }))}
                  >
                    {JUDGE_CATEGORIES.map(category => (
                      <option key={category} value={category}>{category}</option>
                    ))}
                  </select>
                </label>

                <label className="admin-page__field">
                  <span>Опыт тренерской работы</span>
                  <input
                    type="number"
                    min="0"
                    max="80"
                    step="1"
                    value={judgeForm.coaching_experience_years}
                    onChange={e => setJudgeForm(f => ({ ...f, coaching_experience_years: e.target.value }))}
                    required
                  />
                </label>
              </div>

              <fieldset className="admin-page__judge-disciplines">
                <legend>Дисциплины для судейства</legend>
                <div className="admin-page__checkbox-grid">
                  {JUDGE_DISCIPLINES.map(discipline => (
                    <label key={discipline} className="admin-page__checkbox">
                      <input
                        type="checkbox"
                        checked={judgeForm.judge_disciplines.includes(discipline)}
                        onChange={() => toggleJudgeDiscipline(discipline)}
                      />
                      <span>{discipline}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <label className="admin-page__field admin-page__field--wide">
                <span>Дополнительная информация</span>
                <textarea
                  value={judgeForm.additional_info}
                  onChange={e => setJudgeForm(f => ({ ...f, additional_info: e.target.value }))}
                  rows={3}
                  placeholder="Другая дисциплина или комментарий"
                />
              </label>

              {judgeFormError && (
                <p className="admin-page__form-error">{judgeFormError}</p>
              )}

              {judgeFormResult && <ImportResultDetails result={judgeFormResult} />}

              <button
                className="admin-page__btn admin-page__btn--primary"
                type="submit"
                disabled={judgeFormSaving}
              >
                {judgeFormSaving ? 'Сохранение…' : 'Сохранить судью'}
              </button>
            </form>
          )}

          {judgeImportOpen && (
            <div className="admin-page__import-body" style={{ marginTop: '1rem' }}>
              <div style={{ display: 'flex', gap: '.75rem', alignItems: 'center', flexWrap: 'wrap', margin: '0 0 .75rem' }}>
                <input
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={e => setJudgeImportFile(e.target.files?.[0] || null)}
                />
                <button
                  className="admin-page__btn admin-page__btn--primary"
                  type="button"
                  onClick={handleImportJudgesXlsx}
                  disabled={judgeFileImportLoading || !judgeImportFile}
                >
                  {judgeFileImportLoading ? 'Загрузка…' : 'Загрузить XLSX'}
                </button>
              </div>
              <p style={{ margin: '0 0 .5rem' }}>
                XLSX: первая строка — заголовки формы {JUDGE_FORM_ID}. JSON: массив судей или объект <code>{'{ entries: [...] }'}</code>.
                Допустимые значения: <code>region</code> ∈ {'{Центральный, Северо-Западный, Южный, Северо-Кавказский, Приволжский, Уральский, Сибирский, Дальневосточный}'},{' '}
                <code>judge_category</code> ∈ {'{Национальная, Региональная, Местная, Без категории}'},{' '}
                <code>judge_disciplines</code> — массив из {'{Технический симулятор, ЛЗ/КЗ (класс А), ЛЗ/КЗ (класс Б), ЛЗ/КЗ (класс В), Другая дисциплина (укажите)}'}.
              </p>
              <details style={{ margin: '0 0 .75rem' }}>
                <summary style={{ cursor: 'pointer' }}>Пример одной записи</summary>
                <pre style={{ background: '#1a1a1a', padding: '.75rem', borderRadius: 4, fontSize: 12, overflow: 'auto' }}>
{`[
  {
    "email": "alex.bakharev97@gmail.com",
    "phone": "(978) 984-23-13",
    "birth_date": "1997-06-13",
    "region": "Северо-Западный",
    "judge_category": "Национальная",
    "coaching_experience_years": 0,
    "judge_disciplines": ["ЛЗ/КЗ (класс Б)"],
    "additional_info": "Готов судить класс Б",
    "external_id": "fd-245211-001"
  }
]`}
                </pre>
              </details>
              <textarea
                className="admin-page__import-textarea"
                value={judgeImportJson}
                onChange={e => setJudgeImportJson(e.target.value)}
                rows={12}
                placeholder='[{"email": "j@example.com", "region": "Северо-Западный", "judge_category": "Национальная"}]'
                style={{ width: '100%', fontFamily: 'monospace', fontSize: 13, padding: '.5rem', boxSizing: 'border-box' }}
              />
              <div style={{ marginTop: '.75rem' }}>
                <button
                  className="admin-page__btn admin-page__btn--primary"
                  type="button"
                  onClick={handleImportJudges}
                  disabled={judgeImportLoading || !judgeImportJson.trim()}
                >
                  {judgeImportLoading ? 'Импорт…' : 'Импортировать'}
                </button>
              </div>

              {judgeImportError && (
                <p className="admin-page__demo-error" style={{ marginTop: '.75rem' }}>{judgeImportError}</p>
              )}

              {judgeImportResult && <ImportResultDetails result={judgeImportResult} />}
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
                  <th></th>
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

                    <td data-label="">
                      <button
                        className="admin-page__btn admin-page__btn--sm admin-page__btn--danger"
                        disabled={deletingUser === u.id}
                        onClick={() => handleDeleteUser(u)}
                        title="Удалить пользователя"
                      >
                        {deletingUser === u.id ? '…' : 'Удалить'}
                      </button>
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
