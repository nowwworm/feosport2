import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import Button        from '@mui/material/Button';
import Dialog        from '@mui/material/Dialog';
import DialogTitle   from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import api from '../../services/api';
import './ParticipantsPage.scss';

const POLL_INTERVAL = 2000;

function parseExtra(ch) {
  try { return JSON.parse(ch); } catch { return {}; }
}
function formatDate(str) {
  if (!str) return '—';
  return new Date(str).toLocaleDateString('ru-RU');
}

export default function ParticipantsPage() {
  const [pilots,      setPilots]      = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);
  const [syncing,     setSyncing]     = useState(false);
  const [syncLog,     setSyncLog]     = useState('');
  const [lastUpd,     setLastUpd]     = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting,    setDeleting]    = useState(false);

  // ── Фильтры ──────────────────────────────────────────────────────────────
  const [query,       setQuery]       = useState('');   // единый поиск ФИО + Email + Телефон
  const [filterTeam,  setFilterTeam]  = useState('');
  const [filterVtx,   setFilterVtx]   = useState('');
  const [filterVtxCh, setFilterVtxCh] = useState('');

  const logRef   = useRef(null);
  const timerRef = useRef(null);

  const loadPilots = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      setError(null);
      const { data } = await api.get('/pilots');
      const rows = data
        .filter(p => p.external_id)
        .map(p => {
          const extra = parseExtra(p.video_channel);
          return {
            id:        p.id,
            fullName:  [p.last_name, p.first_name, p.middle_name].filter(Boolean).join(' '),
            team:      p.team       || '',
            birthDate: formatDate(p.birth_date),
            email:     extra.email  || '',
            phone:     extra.phone  || '',
            radio:     extra.radio  || '',
            vtx:       extra.vtx    || '',
            vtxCh:     extra.vtx_ch || '',
          };
        });
      setPilots(rows);
      setLastUpd(new Date());
    } catch (e) {
      if (!silent) setError(e.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPilots();
    timerRef.current = setInterval(() => loadPilots(true), POLL_INTERVAL);
    return () => clearInterval(timerRef.current);
  }, [loadPilots]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [syncLog]);

  // ── Уникальные значения для дропдаунов ───────────────────────────────────
  const teamOptions  = useMemo(() => [...new Set(pilots.map(p => p.team).filter(Boolean))].sort(),  [pilots]);
  const vtxOptions   = useMemo(() => [...new Set(pilots.map(p => p.vtx).filter(Boolean))].sort(),   [pilots]);
  const vtxChOptions = useMemo(() => [...new Set(pilots.map(p => p.vtxCh).filter(Boolean))].sort(), [pilots]);

  // ── Фильтрация строк ─────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pilots.filter(p => {
      if (q && !p.fullName.toLowerCase().includes(q)
             && !p.email.toLowerCase().includes(q)
             && !p.phone.toLowerCase().includes(q)) return false;
      if (filterTeam  && p.team  !== filterTeam)  return false;
      if (filterVtx   && p.vtx   !== filterVtx)   return false;
      if (filterVtxCh && p.vtxCh !== filterVtxCh) return false;
      return true;
    });
  }, [pilots, query, filterTeam, filterVtx, filterVtxCh]);

  const hasFilters = query || filterTeam || filterVtx || filterVtxCh;

  function clearFilters() {
    setQuery(''); setFilterTeam(''); setFilterVtx(''); setFilterVtxCh('');
  }

  // ── Синхронизация ────────────────────────────────────────────────────────
  async function handleSync() {
    setSyncing(true); setSyncLog('');
    try {
      const { data } = await api.post('/admin/sync-formdesigner');
      setSyncLog(data.log || '');
      await loadPilots();
    } catch (e) {
      setSyncLog(e.response?.data?.log || e.message);
    } finally {
      setSyncing(false);
    }
  }

  async function handleDeleteOne(id) {
    if (!window.confirm('Удалить участника?')) return;
    try {
      await api.delete(`/pilots/${id}`);
      setPilots(prev => prev.filter(p => p.id !== id));
    } catch (e) { alert('Ошибка: ' + e.message); }
  }

  async function handleDeleteAll() {
    setDeleting(true);
    try {
      await api.delete('/pilots/fd-all');
      setPilots([]); setSyncLog('');
      clearFilters();
    } catch (e) { alert('Ошибка: ' + e.message); }
    finally { setDeleting(false); setConfirmOpen(false); }
  }

  return (
    <div className="participants-page">
      <div className="participants-page__content">

        {/* Шапка */}
        <div className="participants-page__header">
          <div>
            <h1 className="participants-page__title">Участники</h1>
            <p className="participants-page__subtitle">
              FormDesigner · {filtered.length === pilots.length
                ? `${pilots.length} чел.`
                : `${filtered.length} из ${pilots.length} чел.`}
              {lastUpd && ` · ${lastUpd.toLocaleTimeString('ru-RU')}`}
            </p>
          </div>
          <div className="participants-page__actions">
            <button
              className="participants-page__danger-btn"
              onClick={() => setConfirmOpen(true)}
              disabled={deleting || pilots.length === 0}
            >🗑 Удалить все</button>
            <button
              className={`participants-page__sync-btn${syncing ? ' participants-page__sync-btn--loading' : ''}`}
              onClick={handleSync}
              disabled={syncing}
            >{syncing ? '⟳ Синхронизация...' : '↻ Обновить данные'}</button>
          </div>
        </div>

        {syncLog && <pre className="participants-page__log" ref={logRef}>{syncLog}</pre>}
        {error   && <div className="participants-page__state participants-page__state--error">Ошибка: {error}</div>}

        {/* ── Панель фильтров ─────────────────────────────────────────── */}
        <div className="participants-page__filters">

          {/* Единый поиск */}
          <div className="participants-page__search-wrap">
            <span className="participants-page__search-icon">⌕</span>
            <input
              className="participants-page__search"
              type="text"
              placeholder="Поиск по ФИО, Email, Телефону..."
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
            {query && (
              <button className="participants-page__search-clear" onClick={() => setQuery('')}>✕</button>
            )}
          </div>

          {/* Выпадающие фильтры */}
          <select
            className="participants-page__select"
            value={filterTeam}
            onChange={e => setFilterTeam(e.target.value)}
          >
            <option value="">Все команды</option>
            {teamOptions.map(v => <option key={v} value={v}>{v}</option>)}
          </select>

          <select
            className="participants-page__select"
            value={filterVtx}
            onChange={e => setFilterVtx(e.target.value)}
          >
            <option value="">Все VTX</option>
            {vtxOptions.map(v => <option key={v} value={v}>{v}</option>)}
          </select>

          <select
            className="participants-page__select"
            value={filterVtxCh}
            onChange={e => setFilterVtxCh(e.target.value)}
          >
            <option value="">Все каналы</option>
            {vtxChOptions.map(v => <option key={v} value={v}>{v}</option>)}
          </select>

          {hasFilters && (
            <button className="participants-page__clear-btn" onClick={clearFilters}>✕ Сбросить</button>
          )}
        </div>

        {/* Responsive Custom List */}
        <div className="participants-page__list">
          {loading && pilots.length === 0 ? (
            <div className="participants-page__state">Загрузка...</div>
          ) : filtered.length === 0 ? (
            <div className="participants-page__state">Участники не найдены</div>
          ) : (
            filtered.map(p => (
              <article key={p.id} className="participant-card">
                <div className="participant-card__header">
                  <h3 className="participant-card__name">{p.fullName}</h3>
                  <button className="participant-card__delete" title="Удалить" onClick={() => handleDeleteOne(p.id)}>✕</button>
                </div>
                <div className="participant-card__info">
                  <div className="participant-card__field">
                    <span>Команда:</span>
                    <strong>{p.team || '—'}</strong>
                  </div>
                  <div className="participant-card__field">
                    <span>VTX/Канал:</span>
                    <strong>{p.vtx || '—'} {p.vtxCh ? `/ ${p.vtxCh}` : ''}</strong>
                  </div>
                  <div className="participant-card__field">
                    <span>Пульт:</span>
                    <strong>{p.radio || '—'}</strong>
                  </div>
                  <div className="participant-card__field">
                    <span>Телефон:</span>
                    <strong>{p.phone || '—'}</strong>
                  </div>
                  <div className="participant-card__field participant-card__field--full">
                    <span>Email:</span>
                    <strong>{p.email || '—'}</strong>
                  </div>
                  <div className="participant-card__field">
                    <span>Дата рожд.:</span>
                    <strong>{p.birthDate}</strong>
                  </div>
                </div>
              </article>
            ))
          )}
        </div>

      </div>

      {/* Диалог подтверждения */}
      <Dialog
        open={confirmOpen}
        onClose={() => !deleting && setConfirmOpen(false)}
        PaperProps={{ sx: { backgroundColor: '#141414', border: '1px solid #2a2a4a', borderRadius: 2 } }}
      >
        <DialogTitle sx={{ color: '#efefef', fontSize: 16, fontWeight: 700 }}>
          Удалить всех участников?
        </DialogTitle>
        <DialogContent>
          <p style={{ color: '#999', fontSize: 13, margin: 0 }}>
            Будут удалены все <strong style={{ color: '#efefef' }}>{pilots.length} записей</strong> из базы данных.<br />
            Восстановить можно через повторную синхронизацию с FormDesigner.
          </p>
        </DialogContent>
        <DialogActions sx={{ padding: '12px 24px' }}>
          <Button onClick={() => setConfirmOpen(false)} disabled={deleting} sx={{ color: '#666' }}>
            Отмена
          </Button>
          <Button onClick={handleDeleteAll} disabled={deleting} variant="contained" color="error" sx={{ fontWeight: 700 }}>
            {deleting ? 'Удаление...' : 'Да, удалить все'}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
