import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { DataGrid }          from '@mui/x-data-grid';
import { ruRU }              from '@mui/x-data-grid/locales';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import Button        from '@mui/material/Button';
import Dialog        from '@mui/material/Dialog';
import DialogTitle   from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import api from '../../services/api';
import './ParticipantsPage.scss';

const POLL_INTERVAL = 2000;

const darkTheme = createTheme({
  palette: { mode: 'dark', primary: { main: '#e8272a' } },
  components: {
    MuiDataGrid: {
      styleOverrides: {
        root: {
          border: '1px solid #2a2a2a', borderRadius: 10,
          backgroundColor: '#0a0a0a', color: '#efefef', fontSize: 13,
        },
        columnHeader:      { backgroundColor: '#141414', color: '#666' },
        columnHeaderTitle: { fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.5px' },
        row: {
          '&:hover':        { backgroundColor: '#141414' },
          '&.Mui-selected': { backgroundColor: '#1e1e1e !important' },
        },
        cell:            { borderColor: '#2a2a2a' },
        footerContainer: { backgroundColor: '#141414', borderColor: '#2a2a2a' },
      },
    },
    MuiCheckbox:        { styleOverrides: { root: { color: '#444', '&.Mui-checked': { color: '#e8272a' } } } },
    MuiTablePagination: { styleOverrides: { root: { color: '#666', fontSize: 12 } } },
    MuiButton:          { styleOverrides: { root: { fontSize: 12, textTransform: 'none' } } },
  },
}, ruRU);

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

  // ── Колонки ──────────────────────────────────────────────────────────────
  const columns = [
    { field: 'fullName',  headerName: 'ФИО',           flex: 2, minWidth: 200 },
    { field: 'team',      headerName: 'Команда',        flex: 1, minWidth: 120 },
    { field: 'birthDate', headerName: 'Дата рождения',  flex: 1, minWidth: 120 },
    { field: 'email',     headerName: 'Email',          flex: 1.5, minWidth: 180 },
    { field: 'phone',     headerName: 'Телефон',        flex: 1, minWidth: 140 },
    { field: 'radio',     headerName: 'Пульт',          flex: 1, minWidth: 140 },
    { field: 'vtx',       headerName: 'VTX',            flex: 1, minWidth: 130 },
    { field: 'vtxCh',     headerName: 'Канал',          width: 80 },
    {
      field: '_del', headerName: '', width: 52,
      sortable: false, filterable: false, disableColumnMenu: true,
      renderCell: ({ row }) => (
        <button className="participants-page__del-btn" title="Удалить" onClick={() => handleDeleteOne(row.id)}>✕</button>
      ),
    },
  ];

  return (
    <ThemeProvider theme={darkTheme}>
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

          {/* DataGrid — без встроенного toolbar/фильтров */}
          <div className="participants-page__grid-wrap">
            <DataGrid
              rows={filtered}
              columns={columns}
              loading={loading}
              pageSizeOptions={[10, 25, 50]}
              initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
              disableRowSelectionOnClick
              disableColumnFilter
              disableColumnMenu
              density="compact"
              localeText={ruRU.components.MuiDataGrid.defaultProps.localeText}
            />
          </div>

        </div>
      </div>

      {/* Диалог подтверждения */}
      <Dialog
        open={confirmOpen}
        onClose={() => !deleting && setConfirmOpen(false)}
        PaperProps={{ sx: { backgroundColor: '#141414', border: '1px solid #2a2a2a', borderRadius: 2 } }}
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

    </ThemeProvider>
  );
}
