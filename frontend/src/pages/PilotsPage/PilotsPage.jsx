import React, { useEffect, useMemo, useState } from 'react';
import api    from '../../services/api';
import Header from '../../components/Header/Header';
import './PilotsPage.scss';

// Опции "Разряд" в фильтре: Все / Есть / Нет / Не указан
const RANK_FILTER = [
  { value: '',        label: 'Все: разряд' },
  { value: 'yes',     label: 'С разрядом'  },
  { value: 'no',      label: 'Без разряда' },
  { value: 'unknown', label: 'Не указан'   },
];

function fullName(p) {
  return [p.last_name, p.first_name, p.middle_name].filter(Boolean).join(' ');
}

function rankLabel(p) {
  if (p.sport_rank) return p.sport_rank;
  if (p.has_rank === true)  return '✓ да';
  if (p.has_rank === false) return '— нет';
  return '—';
}

export default function PilotsPage() {
  const [pilots,  setPilots]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  // ── Фильтры ───────────────────────────────────────────────────────────────
  const [query,        setQuery]        = useState('');  // ФИО+email+phone+team
  const [filterTeam,   setFilterTeam]   = useState('');
  const [filterRadio,  setFilterRadio]  = useState('');
  const [filterVtx,    setFilterVtx]    = useState('');
  const [filterVtxCh,  setFilterVtxCh]  = useState('');
  const [filterRank,   setFilterRank]   = useState('');
  const [filterSim,    setFilterSim]    = useState('');

  useEffect(() => {
    api.get('/pilots')
      .then(({ data }) => setPilots(data))
      .catch(() => setError('Ошибка загрузки списка пилотов'))
      .finally(() => setLoading(false));
  }, []);

  // ── Дропдауны — уникальные значения из данных ────────────────────────────
  const teamOptions    = useMemo(() => [...new Set(pilots.map(p => p.team).filter(Boolean))].sort(),            [pilots]);
  const radioOptions   = useMemo(() => [...new Set(pilots.map(p => p.radio_system).filter(Boolean))].sort(),    [pilots]);
  const vtxOptions     = useMemo(() => [...new Set(pilots.map(p => p.vtx_type).filter(Boolean))].sort(),        [pilots]);
  const vtxChOptions   = useMemo(() => [...new Set(pilots.map(p => p.vtx_channel).filter(Boolean))].sort(),     [pilots]);
  const simOptions     = useMemo(() => [...new Set(pilots.map(p => p.drone_simulator).filter(Boolean))].sort(), [pilots]);

  // ── Применение фильтров ──────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pilots.filter(p => {
      if (q) {
        const haystack = [
          fullName(p),
          p.email || '',
          p.phone || '',
          p.team  || '',
        ].join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (filterTeam   && p.team           !== filterTeam)   return false;
      if (filterRadio  && p.radio_system   !== filterRadio)  return false;
      if (filterVtx    && p.vtx_type       !== filterVtx)    return false;
      if (filterVtxCh  && p.vtx_channel    !== filterVtxCh)  return false;
      if (filterSim    && p.drone_simulator !== filterSim)   return false;
      if (filterRank === 'yes'     && p.has_rank !== true)  return false;
      if (filterRank === 'no'      && p.has_rank !== false) return false;
      if (filterRank === 'unknown' && p.has_rank !== null && p.has_rank !== undefined) return false;
      return true;
    });
  }, [pilots, query, filterTeam, filterRadio, filterVtx, filterVtxCh, filterSim, filterRank]);

  const hasFilters = query || filterTeam || filterRadio || filterVtx || filterVtxCh || filterSim || filterRank;

  function clearFilters() {
    setQuery(''); setFilterTeam(''); setFilterRadio('');
    setFilterVtx(''); setFilterVtxCh(''); setFilterSim(''); setFilterRank('');
  }

  return (
    <div className="pilots-page">
      <Header title="Список пилотов" />

      <div className="pilots-page__content">

        {/* Шапка со счётчиком */}
        <div className="pilots-page__header">
          <h2 className="pilots-page__title">
            Пилоты
            <span className="pilots-page__count">
              {filtered.length === pilots.length
                ? `· ${pilots.length}`
                : `· ${filtered.length} из ${pilots.length}`}
            </span>
          </h2>
        </div>

        {/* Панель фильтров */}
        <div className="pilots-page__filters">
          <div className="pilots-page__search-wrap">
            <span className="pilots-page__search-icon">⌕</span>
            <input
              className="pilots-page__search"
              type="text"
              placeholder="Поиск по ФИО, email, телефону, команде…"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
            {query && (
              <button className="pilots-page__search-clear" onClick={() => setQuery('')}>✕</button>
            )}
          </div>

          <select className="pilots-page__select" value={filterTeam} onChange={e => setFilterTeam(e.target.value)}>
            <option value="">Все: команда</option>
            {teamOptions.map(v => <option key={v} value={v}>{v}</option>)}
          </select>

          <select className="pilots-page__select" value={filterRadio} onChange={e => setFilterRadio(e.target.value)}>
            <option value="">Все: радио</option>
            {radioOptions.map(v => <option key={v} value={v}>{v}</option>)}
          </select>

          <select className="pilots-page__select" value={filterVtx} onChange={e => setFilterVtx(e.target.value)}>
            <option value="">Все: VTX</option>
            {vtxOptions.map(v => <option key={v} value={v}>{v}</option>)}
          </select>

          <select className="pilots-page__select" value={filterVtxCh} onChange={e => setFilterVtxCh(e.target.value)}>
            <option value="">Все: канал</option>
            {vtxChOptions.map(v => <option key={v} value={v}>{v}</option>)}
          </select>

          <select className="pilots-page__select" value={filterSim} onChange={e => setFilterSim(e.target.value)}>
            <option value="">Все: симулятор</option>
            {simOptions.map(v => <option key={v} value={v}>{v}</option>)}
          </select>

          <select className="pilots-page__select" value={filterRank} onChange={e => setFilterRank(e.target.value)}>
            {RANK_FILTER.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>

          {hasFilters && (
            <button className="pilots-page__clear-btn" onClick={clearFilters}>✕ Сбросить</button>
          )}
        </div>

        {/* Таблица */}
        {loading && <p className="pilots-page__state">Загрузка…</p>}
        {error   && <p className="pilots-page__state pilots-page__state--error">{error}</p>}

        {!loading && !error && pilots.length === 0 && (
          <p className="pilots-page__state">Пилоты не зарегистрированы</p>
        )}

        {!loading && !error && pilots.length > 0 && filtered.length === 0 && (
          <p className="pilots-page__state">Под фильтр ничего не подошло</p>
        )}

        {filtered.length > 0 && (
          <div className="pilots-page__table-wrap">
            <table className="pilots-page__table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>ФИО</th>
                  <th>Команда</th>
                  <th>Email</th>
                  <th>Телефон</th>
                  <th>Дата рожд.</th>
                  <th>Разряд</th>
                  <th>Радио</th>
                  <th>VTX</th>
                  <th>Канал</th>
                  <th>Симулятор</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => (
                  <tr key={p.id}>
                    <td className="pilots-page__cell-id">#{p.id}</td>
                    <td className="pilots-page__cell-name">{fullName(p)}</td>
                    <td>{p.team || '—'}</td>
                    <td>{p.email || '—'}</td>
                    <td>{p.phone || '—'}</td>
                    <td>{p.birth_date || '—'}</td>
                    <td>{rankLabel(p)}</td>
                    <td>{p.radio_system    || '—'}</td>
                    <td>{p.vtx_type        || '—'}</td>
                    <td>{p.vtx_channel     || '—'}</td>
                    <td>{p.drone_simulator || '—'}</td>
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
