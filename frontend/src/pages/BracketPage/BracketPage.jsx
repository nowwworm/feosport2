import React, { useState, useEffect, useMemo } from 'react';
import api    from '../../services/api';
import Header from '../../components/Header/Header';
import './BracketPage.scss';

const ROUND_LABELS = {
  quarterfinal: 'Четвертьфинал',
  semifinal:    'Полуфинал',
  bronze_final: 'Бронза',
  final:        'Финал',
};

const ROUND_ORDER = ['quarterfinal', 'semifinal', 'bronze_final', 'final'];

function groupIntoMatches(slots) {
  const matches = [];
  for (let i = 0; i < slots.length; i += 2) {
    matches.push([slots[i], slots[i + 1] || null]);
  }
  return matches;
}

function formatTime(t) {
  if (t == null) return '—';
  return `${parseFloat(t).toFixed(3)}с`;
}

function PilotSlot({ slot }) {
  if (!slot) return <div className="bracket-slot bracket-slot--bye">Bye</div>;

  const isDnf = slot.dnf || slot.dsq;
  const time  = slot.total_time ?? slot.time_seconds;

  return (
    <div className={`bracket-slot${slot.advanced ? ' bracket-slot--winner' : ''}${isDnf ? ' bracket-slot--dnf' : ''}`}>
      <span className="bracket-slot__seed">#{slot.seed}</span>
      <div className="bracket-slot__pilot">
        <span className="bracket-slot__name">{slot.last_name} {slot.first_name?.[0]}.</span>
        <span className="bracket-slot__team">{slot.team}</span>
      </div>
      <span className="bracket-slot__time">
        {isDnf ? (slot.dsq ? 'DSQ' : 'DNF') : formatTime(time)}
      </span>
      {slot.advanced && <span className="bracket-slot__crown">✓</span>}
    </div>
  );
}

function BracketMatch({ match, matchIndex }) {
  const [p1, p2] = match;
  return (
    <div className="bracket-match">
      <div className="bracket-match__label">М{matchIndex + 1}</div>
      <PilotSlot slot={p1} />
      <div className="bracket-match__vs">vs</div>
      <PilotSlot slot={p2} />
    </div>
  );
}

function BracketRound({ roundType, slots }) {
  const matches = groupIntoMatches(slots);
  const isFinal = roundType === 'final';

  return (
    <section className={`bracket-round bracket-round--${roundType}`}>
      <h3 className="bracket-round__title">
        {isFinal && <span className="bracket-round__trophy">🏆</span>}
        {ROUND_LABELS[roundType]}
      </h3>
      <div className="bracket-round__matches">
        {matches.map((match, i) => (
          <BracketMatch key={i} match={match} matchIndex={i} />
        ))}
      </div>
    </section>
  );
}

function QualLeaderboard({ rows }) {
  if (!rows?.length) return null;
  return (
    <section className="qual-board">
      <h3 className="qual-board__title">Квалификация</h3>
      <ol className="qual-board__list">
        {rows.map((r, i) => (
          <li key={r.id} className={`qual-board__row${i < 8 ? ' qual-board__row--qualify' : ''}`}>
            <span className="qual-board__rank">{i + 1}</span>
            <div className="qual-board__pilot">
              <span className="qual-board__name">{r.last_name} {r.first_name}</span>
              <span className="qual-board__team">{r.team}</span>
            </div>
            <span className="qual-board__time">{formatTime(r.best_time)}</span>
            {i < 8 && <span className="qual-board__badge">→ Плей-офф</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function BracketPage() {
  const [competitions, setCompetitions] = useState([]);
  const [selectedId,   setSelectedId]   = useState(null);
  const [bracketData,  setBracketData]  = useState(null);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState(null);

  useEffect(() => {
    api.get('/competitions').then(r => {
      const completed = r.data.filter(c => c.status === 'completed');
      setCompetitions(completed);
      if (completed.length) setSelectedId(completed[0].id);
    });
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setLoading(true);
    setError(null);
    api.get(`/competitions/${selectedId}/bracket`)
      .then(r => setBracketData(r.data))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [selectedId]);

  const roundSlots = useMemo(() => {
    if (!bracketData) return {};
    return bracketData.brackets.reduce((acc, slot) => {
      if (!acc[slot.round_type]) acc[slot.round_type] = [];
      acc[slot.round_type].push(slot);
      return acc;
    }, {});
  }, [bracketData]);

  return (
    <div className="bracket-page">
      <Header title="Турнирная сетка" />

      <div className="bracket-page__content">
        {/* Competition tabs */}
        <div className="bracket-page__tabs" role="tablist">
          {competitions.map(c => (
            <button
              key={c.id}
              role="tab"
              aria-selected={selectedId === c.id}
              className={`bracket-page__tab${selectedId === c.id ? ' bracket-page__tab--active' : ''}`}
              onClick={() => setSelectedId(c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>

        {loading && <div className="bracket-page__loading">Загрузка…</div>}
        {error   && <div className="bracket-page__error">{error}</div>}

        {bracketData && !loading && (
          <>
            {/* Qual leaderboard */}
            <QualLeaderboard rows={bracketData.qual_leaderboard} />

            {/* Bracket rounds */}
            <div className="bracket-page__bracket">
              {ROUND_ORDER.map(rt =>
                roundSlots[rt] ? (
                  <BracketRound key={rt} roundType={rt} slots={roundSlots[rt]} />
                ) : null
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
