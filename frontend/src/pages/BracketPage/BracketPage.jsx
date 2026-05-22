import React, { useState, useEffect, useMemo, useCallback } from 'react';
import api    from '../../services/api';
import Header from '../../components/Header/Header';
import { useAuth } from '../../context/AuthContext';
import './BracketPage.scss';

const ROUND_LABELS = {
  qualification: 'Квалификация',
  round_of_16:   '1/8 финала',
  quarterfinal: 'Четвертьфинал',
  semifinal:    'Полуфинал',
  bronze_final: 'Бронза',
  final:        'Финал',
};

const ROUND_ORDER = ['round_of_16', 'quarterfinal', 'semifinal', 'bronze_final', 'final'];
const STAGE_ORDER = ['qualification', 'round_of_16', 'quarterfinal', 'semifinal', 'final'];

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

function formatMs(ms) {
  if (ms == null) return '—';
  return `${(Number(ms) / 1000).toFixed(3)}с`;
}

function participantName(participant) {
  if (participant.team_id) return participant.team_name || `Команда #${participant.team_id}`;
  const name = [participant.pilot_last_name, participant.pilot_first_name].filter(Boolean).join(' ');
  return name || `Пилот #${participant.pilot_id}`;
}

function qualificationMetric(participant, stage) {
  if (stage.qualification_mode === 'max_laps') {
    const laps = participant.qualification_total_laps ?? '—';
    return `${laps} кр. / ${formatMs(participant.qualification_total_time_ms)}`;
  }
  return formatMs(participant.qualification_total_time_ms);
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

function GroupParticipant({ participant, stage, canEdit, savingId, onPatch, onReplace }) {
  const replaced = participant.attendance_status === 'replaced';
  const noShow = participant.attendance_status === 'no_show';
  const saving = savingId === participant.id;
  const metric = stage.stage_type === 'qualification'
    ? qualificationMetric(participant, stage)
    : participant.finish_place
      ? `${participant.finish_place} место`
      : '—';

  const saveQualification = (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const totalTimeSeconds = form.get('qualification_total_time_seconds');
    const bestLapSeconds = form.get('qualification_best_lap_seconds');
    onPatch(participant.id, {
      qualification_total_laps: Number(form.get('qualification_total_laps')),
      qualification_total_time_ms: Math.round(Number(totalTimeSeconds) * 1000),
      qualification_best_lap_ms: bestLapSeconds ? Math.round(Number(bestLapSeconds) * 1000) : null,
      attendance_status: 'present',
    });
  };

  const savePlace = (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onPatch(participant.id, {
      finish_place: Number(form.get('finish_place')),
      points: form.get('points') ? Number(form.get('points')) : null,
      attendance_status: 'present',
    });
  };

  return (
    <div className={`stage-participant${replaced ? ' stage-participant--replaced' : ''}${noShow ? ' stage-participant--no-show' : ''}`}>
      <span className="stage-participant__slot">{participant.seed ? `#${participant.seed}` : participant.slot}</span>
      <div className="stage-participant__body">
        <span className="stage-participant__name">{participantName(participant)}</span>
        <span className="stage-participant__meta">
          {participant.pilot_team || participant.team_name || (replaced ? `замена #${participant.replaced_pilot_id}` : '')}
        </span>
      </div>
      <span className="stage-participant__metric">{noShow ? 'неявка' : metric}</span>
      {canEdit && (
        <div className="stage-participant__controls">
          {stage.stage_type === 'qualification' ? (
            <form onSubmit={saveQualification} className="stage-participant__form">
              <input
                aria-label="Круги"
                name="qualification_total_laps"
                type="number"
                min="0"
                defaultValue={participant.qualification_total_laps ?? ''}
              />
              <input
                aria-label="Время"
                name="qualification_total_time_seconds"
                type="number"
                min="0"
                step="0.001"
                defaultValue={participant.qualification_total_time_ms != null ? participant.qualification_total_time_ms / 1000 : ''}
              />
              <input
                aria-label="Лучший круг"
                name="qualification_best_lap_seconds"
                type="number"
                min="0"
                step="0.001"
                defaultValue={participant.qualification_best_lap_ms != null ? participant.qualification_best_lap_ms / 1000 : ''}
              />
              <button type="submit" disabled={saving}>✓</button>
            </form>
          ) : (
            <form onSubmit={savePlace} className="stage-participant__form stage-participant__form--place">
              <input
                aria-label="Место"
                name="finish_place"
                type="number"
                min="1"
                max="8"
                defaultValue={participant.finish_place ?? ''}
              />
              <input
                aria-label="Баллы"
                name="points"
                type="number"
                min="0"
                defaultValue={participant.points ?? ''}
              />
              <button type="submit" disabled={saving}>✓</button>
            </form>
          )}
          <button
            type="button"
            disabled={saving}
            onClick={() => onPatch(participant.id, { attendance_status: 'no_show' })}
          >
            Н
          </button>
          {stage.stage_type !== 'qualification' && (
            <button
              type="button"
              disabled={saving}
              onClick={() => onReplace(participant.id)}
            >
              ↔
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function StageGroup({ group, stage, canEdit, savingId, onPatch, onReplace }) {
  const participants = group.participants || [];
  return (
    <article className="stage-group">
      <header className="stage-group__header">
        <h4>Группа {group.group_number}</h4>
        <span>{participants.length} участников</span>
      </header>
      <div className="stage-group__participants">
        {participants.map(p => (
          <GroupParticipant
            key={p.id}
            participant={p}
            stage={stage}
            canEdit={canEdit}
            savingId={savingId}
            onPatch={onPatch}
            onReplace={onReplace}
          />
        ))}
      </div>
    </article>
  );
}

function GroupStageView({ stages, canEdit, savingId, onPatch, onReplace }) {
  const ordered = STAGE_ORDER
    .map(type => stages.find(stage => stage.stage_type === type))
    .filter(Boolean);

  if (!ordered.length) return null;

  return (
    <div className="stage-board">
      {ordered.map(stage => (
        <section key={stage.id} className={`stage-round stage-round--${stage.stage_type}`}>
          <header className="stage-round__header">
            <div>
              <h3>{ROUND_LABELS[stage.stage_type] || stage.stage_type}</h3>
              {stage.stage_type === 'qualification' && (
                <p>
                  {stage.qualification_mode === 'max_laps'
                    ? `Максимум кругов за ${stage.time_limit_seconds}с`
                    : `${stage.target_laps || 'N'} кругов на время`}
                </p>
              )}
            </div>
            <span>{stage.groups?.length || 0} групп</span>
          </header>
          <div className="stage-round__groups">
            {(stage.groups || []).map(group => (
              <StageGroup
                key={group.id}
                group={group}
                stage={stage}
                canEdit={canEdit}
                savingId={savingId}
                onPatch={onPatch}
                onReplace={onReplace}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export default function BracketPage() {
  const { user } = useAuth();
  const [competitions, setCompetitions] = useState([]);
  const [selectedId,   setSelectedId]   = useState(null);
  const [bracketData,  setBracketData]  = useState(null);
  const [stageData,    setStageData]    = useState([]);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState(null);
  const [savingId,     setSavingId]     = useState(null);
  const canEditStages = ['admin', 'chief_judge'].includes(user?.role);

  useEffect(() => {
    api.get('/competitions').then(r => {
      const visible = r.data || [];
      setCompetitions(visible);
      if (visible.length) setSelectedId(visible[0].id);
    });
  }, []);

  const loadCompetitionData = useCallback((competitionId) => {
    if (!competitionId) return Promise.resolve();
    setLoading(true);
    setError(null);
    return Promise.all([
      api.get(`/competitions/${competitionId}/stages`).catch(() => ({ data: [] })),
      api.get(`/competitions/${competitionId}/bracket`).catch(() => ({ data: null })),
    ])
      .then(([stages, bracket]) => {
        setStageData(stages.data || []);
        setBracketData(bracket.data);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    loadCompetitionData(selectedId);
  }, [selectedId, loadCompetitionData]);

  const patchParticipant = async (participantId, payload) => {
    setSavingId(participantId);
    try {
      await api.patch(`/group-participants/${participantId}`, payload);
      await loadCompetitionData(selectedId);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setSavingId(null);
    }
  };

  const replaceParticipant = async (participantId) => {
    setSavingId(participantId);
    try {
      await api.post(`/group-participants/${participantId}/replace`);
      await loadCompetitionData(selectedId);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setSavingId(null);
    }
  };

  const roundSlots = useMemo(() => {
    if (!bracketData?.brackets) return {};
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

        {stageData.length > 0 && !loading && (
          <GroupStageView
            stages={stageData}
            canEdit={canEditStages}
            savingId={savingId}
            onPatch={patchParticipant}
            onReplace={replaceParticipant}
          />
        )}

        {stageData.length === 0 && bracketData && !loading && (
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
