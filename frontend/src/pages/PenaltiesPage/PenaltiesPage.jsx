import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../services/api';
import Header from '../../components/Header/Header';
import { useAuth } from '../../context/AuthContext';
import { useSocketEvent } from '../../hooks/useSocket';
import './PenaltiesPage.scss';

const PENALTY_TYPES = [
  { value: 'oral_warning',      label: 'Устное замечание' },
  { value: 'written_warning',   label: 'Письменное предупреждение' },
  { value: 'points_deduction',  label: 'Лишение баллов' },
  { value: 'technical_defeat',  label: 'Техническое поражение' },
  { value: 'disqualification',  label: 'Дисквалификация' },
];

const PROTEST_STATUS_LABELS = {
  pending:   'На рассмотрении',
  upheld:    'Удовлетворён',
  rejected:  'Отклонён',
  withdrawn: 'Отозван',
};

function pilotName(p) {
  if (!p) return '—';
  return [p.last_name, p.first_name].filter(Boolean).join(' ');
}

export default function PenaltiesPage() {
  const { user } = useAuth();
  const isChief = ['chief_judge', 'admin'].includes(user?.role);

  const [competitions, setCompetitions] = useState([]);
  const [competitionId, setCompetitionId] = useState('');
  const [pilots, setPilots] = useState([]);
  const [teams, setTeams] = useState([]);
  const [penalties, setPenalties] = useState([]);
  const [protests, setProtests] = useState([]);
  const [feedback, setFeedback] = useState(null);

  const refresh = useCallback(async () => {
    if (!competitionId) return;
    try {
      const [pen, pro] = await Promise.all([
        api.get(`/competitions/${competitionId}/penalties`),
        api.get(`/competitions/${competitionId}/protests`),
      ]);
      setPenalties(pen.data);
      setProtests(pro.data);
    } catch (err) {
      setFeedback({ type: 'error', msg: err.response?.data?.error || err.message });
    }
  }, [competitionId]);

  useEffect(() => {
    Promise.all([
      api.get('/competitions'),
      api.get('/pilots'),
      api.get('/teams').catch(() => ({ data: [] })),
    ]).then(([c, p, t]) => {
      setCompetitions(c.data);
      setPilots(p.data);
      setTeams(t.data);
      if (c.data[0]) setCompetitionId(String(c.data[0].id));
    }).catch(() => setFeedback({ type: 'error', msg: 'Не удалось загрузить данные' }));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useSocketEvent('penalty_issued',    refresh);
  useSocketEvent('protest_filed',     refresh);
  useSocketEvent('protest_resolved',  refresh);

  return (
    <div className="penalties-page">
      <Header title="Штрафы и протесты" />

      <div className="penalties-page__content">
        <label className="penalties-page__field">
          <span>Соревнование</span>
          <select value={competitionId} onChange={(e) => setCompetitionId(e.target.value)}>
            {competitions.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>

        {feedback && (
          <div
            className={`penalties-page__feedback penalties-page__feedback--${feedback.type}`}
            onClick={() => setFeedback(null)}
            role="status"
          >
            {feedback.msg}
          </div>
        )}

        {competitionId && isChief && (
          <PenaltyForm
            competitionId={competitionId}
            pilots={pilots}
            teams={teams}
            onSaved={(msg) => { setFeedback({ type: 'success', msg }); refresh(); }}
            onError={(msg) => setFeedback({ type: 'error', msg })}
          />
        )}

        <section className="penalties-page__list">
          <h3>Штрафы</h3>
          {penalties.length === 0
            ? <p className="penalties-page__empty">Штрафов нет</p>
            : <PenaltyTable penalties={penalties} />}
        </section>

        <section className="penalties-page__list">
          <h3>Протесты</h3>
          {protests.length === 0
            ? <p className="penalties-page__empty">Протестов нет</p>
            : <ProtestTable
                protests={protests}
                isChief={isChief}
                onResolved={() => refresh()}
                onError={(msg) => setFeedback({ type: 'error', msg })}
              />}
        </section>

        {competitionId && (
          <FileProtestForm
            competitionId={competitionId}
            pilots={pilots}
            teams={teams}
            onSaved={(msg) => { setFeedback({ type: 'success', msg }); refresh(); }}
            onError={(msg) => setFeedback({ type: 'error', msg })}
          />
        )}
      </div>
    </div>
  );
}

function PenaltyForm({ competitionId, pilots, teams, onSaved, onError }) {
  const [type, setType] = useState('oral_warning');
  const [subjectKind, setSubjectKind] = useState('pilot');
  const [subjectId, setSubjectId] = useState('');
  const [points, setPoints] = useState('');
  const [reason, setReason] = useState('');
  const [rulesClause, setRulesClause] = useState('');
  const [heatId, setHeatId] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    const payload = {
      penalty_type: type,
      pilot_id: subjectKind === 'pilot' && subjectId ? Number(subjectId) : null,
      team_id:  subjectKind === 'team'  && subjectId ? Number(subjectId) : null,
      points: type === 'points_deduction' ? -Math.abs(Number(points || 0)) : null,
      reason: reason || null,
      rules_clause: rulesClause || null,
      heat_id: heatId ? Number(heatId) : null,
    };
    try {
      await api.post(`/competitions/${competitionId}/penalties`, payload);
      onSaved('Штраф выписан ✓');
      setReason(''); setPoints(''); setRulesClause(''); setHeatId('');
    } catch (err) {
      onError(err.response?.data?.error || err.message);
    }
  };

  return (
    <form className="penalties-page__form" onSubmit={submit}>
      <h3>Выписать штраф</h3>
      <div className="penalties-page__row">
        <label className="penalties-page__field">
          <span>Тип</span>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {PENALTY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        <label className="penalties-page__field">
          <span>Объект</span>
          <select value={subjectKind} onChange={(e) => { setSubjectKind(e.target.value); setSubjectId(''); }}>
            <option value="pilot">Пилот</option>
            <option value="team">Команда</option>
          </select>
        </label>
        <label className="penalties-page__field">
          <span>{subjectKind === 'pilot' ? 'Пилот' : 'Команда'}</span>
          <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} required>
            <option value="">—</option>
            {(subjectKind === 'pilot' ? pilots : teams).map(s => (
              <option key={s.id} value={s.id}>
                {subjectKind === 'pilot' ? pilotName(s) : s.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="penalties-page__row">
        {type === 'points_deduction' && (
          <label className="penalties-page__field">
            <span>Баллы (вычитаем)</span>
            <input
              type="number" min="1"
              value={points} onChange={(e) => setPoints(e.target.value)}
              required
            />
          </label>
        )}
        <label className="penalties-page__field">
          <span>Пункт правил</span>
          <input value={rulesClause} onChange={(e) => setRulesClause(e.target.value)} placeholder="5.10.2.1" />
        </label>
        <label className="penalties-page__field">
          <span>Вылет (опц.)</span>
          <input type="number" value={heatId} onChange={(e) => setHeatId(e.target.value)} />
        </label>
      </div>

      <label className="penalties-page__field">
        <span>Причина</span>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
      </label>

      <button type="submit" className="penalties-page__btn-submit">Выписать</button>
    </form>
  );
}

function PenaltyTable({ penalties }) {
  return (
    <table className="penalties-page__table">
      <thead>
        <tr>
          <th>Время</th>
          <th>Тип</th>
          <th>Объект</th>
          <th>Баллы</th>
          <th>Пункт</th>
          <th>Причина</th>
        </tr>
      </thead>
      <tbody>
        {penalties.map(p => (
          <tr key={p.id}>
            <td>{new Date(p.issued_at).toLocaleString()}</td>
            <td>{PENALTY_TYPES.find(t => t.value === p.penalty_type)?.label || p.penalty_type}</td>
            <td>{p.first_name ? `${p.last_name} ${p.first_name}` : (p.team_name || '—')}</td>
            <td>{p.points ?? '—'}</td>
            <td>{p.rules_clause || '—'}</td>
            <td className="penalties-page__cell-reason">{p.reason || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ProtestTable({ protests, isChief, onResolved, onError }) {
  const [resolving, setResolving] = useState(null);

  const resolve = async (id, status) => {
    setResolving(id);
    try {
      await api.patch(`/protests/${id}`, { status });
      onResolved();
    } catch (err) {
      onError(err.response?.data?.error || err.message);
    } finally {
      setResolving(null);
    }
  };

  return (
    <table className="penalties-page__table">
      <thead>
        <tr>
          <th>Подан</th>
          <th>Кем</th>
          <th>Объект</th>
          <th>Пункт</th>
          <th>Описание</th>
          <th>Статус</th>
          {isChief && <th>Действия</th>}
        </tr>
      </thead>
      <tbody>
        {protests.map(p => (
          <tr key={p.id} className={`penalties-page__row--status-${p.status}`}>
            <td>{new Date(p.filed_at).toLocaleString()}</td>
            <td>{p.filed_by_email}</td>
            <td>{p.subject_pilot_first_name ? `${p.subject_pilot_last_name} ${p.subject_pilot_first_name}`
                  : (p.subject_team_name || '—')}</td>
            <td>{p.rules_clause || '—'}</td>
            <td className="penalties-page__cell-reason">{p.description}</td>
            <td>
              <span className={`penalties-page__status-badge penalties-page__status-badge--${p.status}`}>
                {PROTEST_STATUS_LABELS[p.status] || p.status}
              </span>
            </td>
            {isChief && (
              <td className="penalties-page__cell-actions">
                {p.status === 'pending' ? (
                  <>
                    <button
                      type="button"
                      disabled={resolving === p.id}
                      onClick={() => resolve(p.id, 'upheld')}
                    >Удовлетворить</button>
                    <button
                      type="button"
                      disabled={resolving === p.id}
                      onClick={() => resolve(p.id, 'rejected')}
                      className="penalties-page__btn-reject"
                    >Отклонить</button>
                  </>
                ) : (
                  <span>{p.resolution || '—'}</span>
                )}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FileProtestForm({ competitionId, pilots, teams, onSaved, onError }) {
  const [heatId, setHeatId] = useState('');
  const [subjectKind, setSubjectKind] = useState('pilot');
  const [subjectId, setSubjectId] = useState('');
  const [rulesClause, setRulesClause] = useState('');
  const [description, setDescription] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!description.trim()) {
      onError('Опишите суть протеста');
      return;
    }
    try {
      await api.post(`/competitions/${competitionId}/protests`, {
        heat_id: heatId ? Number(heatId) : null,
        subject_pilot_id: subjectKind === 'pilot' && subjectId ? Number(subjectId) : null,
        subject_team_id:  subjectKind === 'team'  && subjectId ? Number(subjectId) : null,
        rules_clause: rulesClause || null,
        description,
      });
      onSaved('Протест подан ✓');
      setDescription(''); setHeatId(''); setRulesClause(''); setSubjectId('');
    } catch (err) {
      onError(err.response?.data?.error || err.message);
    }
  };

  return (
    <form className="penalties-page__form" onSubmit={submit}>
      <h3>Подать протест</h3>
      <p className="penalties-page__hint">Подача — в течение 5 минут после окончания вылета.</p>
      <div className="penalties-page__row">
        <label className="penalties-page__field">
          <span>Вылет</span>
          <input type="number" value={heatId} onChange={(e) => setHeatId(e.target.value)} required />
        </label>
        <label className="penalties-page__field">
          <span>Объект</span>
          <select value={subjectKind} onChange={(e) => { setSubjectKind(e.target.value); setSubjectId(''); }}>
            <option value="pilot">Пилот</option>
            <option value="team">Команда</option>
          </select>
        </label>
        <label className="penalties-page__field">
          <span>{subjectKind === 'pilot' ? 'Пилот' : 'Команда'}</span>
          <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
            <option value="">—</option>
            {(subjectKind === 'pilot' ? pilots : teams).map(s => (
              <option key={s.id} value={s.id}>
                {subjectKind === 'pilot' ? pilotName(s) : s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="penalties-page__field">
          <span>Пункт правил</span>
          <input value={rulesClause} onChange={(e) => setRulesClause(e.target.value)} placeholder="5.14.3" />
        </label>
      </div>

      <label className="penalties-page__field">
        <span>Описание</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          required
          placeholder="Опишите ситуацию и основание"
        />
      </label>

      <button type="submit" className="penalties-page__btn-submit">Подать</button>
    </form>
  );
}
