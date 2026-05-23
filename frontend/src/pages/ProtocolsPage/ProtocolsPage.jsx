import React, { useCallback, useEffect, useState } from 'react';
import api from '../../services/api';
import Header from '../../components/Header/Header';
import { useAuth } from '../../context/AuthContext';
import './ProtocolsPage.scss';

const PROTOCOL_TYPES = [
  { key: 'qualification',           label: 'Квалификация',          needsStage: true },
  { key: 'stage_results',           label: 'Результаты этапа',      needsStage: true },
  { key: 'final',                   label: 'Финал',                 needsStage: true },
  { key: 'team_relay',              label: 'Командная гонка',       needsStage: true },
  { key: 'simulator_qualification', label: 'Квалификация симулятора', needsStage: true },
  { key: 'simulator_results',       label: 'Ход симулятора',        needsStage: true },
  { key: 'final_standings',         label: 'Итоговый',              needsStage: false },
  { key: 'team_summary',            label: 'Командный зачёт',       needsStage: false },
  { key: 'tiebreak',                label: 'Дуэль при равенстве',   needsStage: false },
  { key: 'event_report',            label: 'Отчёт о проведении',    needsStage: false },
];

const TYPE_LABEL_BY_KEY = Object.fromEntries(PROTOCOL_TYPES.map(t => [t.key, t.label]));

function backendOrigin() {
  // Match services/api.js baseURL pattern so /api/protocols/:id/html opens in same place.
  return import.meta.env.VITE_API_URL || '';
}

export default function ProtocolsPage() {
  const { user, token } = useAuth();
  const isChief = ['chief_judge', 'admin'].includes(user?.role);

  const [competitions, setCompetitions] = useState([]);
  const [competitionId, setCompetitionId] = useState('');
  const [stages, setStages] = useState([]);
  const [stageId, setStageId] = useState('');
  const [protocols, setProtocols] = useState([]);
  const [genType, setGenType] = useState('qualification');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const refresh = useCallback(async () => {
    if (!competitionId) return;
    try {
      const { data } = await api.get(`/competitions/${competitionId}/protocols`);
      setProtocols(data);
    } catch (err) {
      setFeedback({ type: 'error', msg: err.response?.data?.error || err.message });
    }
  }, [competitionId]);

  useEffect(() => {
    api.get('/competitions').then(({ data }) => {
      setCompetitions(data);
      if (data[0]) setCompetitionId(String(data[0].id));
    }).catch(() => setFeedback({ type: 'error', msg: 'Не удалось загрузить соревнования' }));
  }, []);

  useEffect(() => {
    if (!competitionId) return;
    api.get(`/competitions/${competitionId}/stages`).then(({ data }) => {
      setStages(data);
      if (data[0]) setStageId(String(data[0].id));
    }).catch(() => setStages([]));
  }, [competitionId]);

  useEffect(() => { refresh(); }, [refresh]);

  const generate = async () => {
    setBusy(true);
    try {
      const def = PROTOCOL_TYPES.find(t => t.key === genType);
      const body = def.needsStage ? { stage_id: Number(stageId) } : {};
      const { data } = await api.post(`/competitions/${competitionId}/protocols/${genType}`, body);
      setFeedback({ type: 'success', msg: `Протокол ${def.label} #${data.id} сохранён ✓` });
      refresh();
    } catch (err) {
      setFeedback({ type: 'error', msg: err.response?.data?.error || err.message });
    } finally {
      setBusy(false);
    }
  };

  const openHtml = (protocolId) => {
    // Pass token via query for the new tab since axios interceptor doesn't apply.
    const url = `${backendOrigin()}/api/protocols/${protocolId}/html`;
    // Open via fetch + blob so Authorization header works.
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.text())
      .then(html => {
        const blob = new Blob([html], { type: 'text/html' });
        const objUrl = URL.createObjectURL(blob);
        window.open(objUrl, '_blank');
      })
      .catch(err => setFeedback({ type: 'error', msg: err.message }));
  };

  const needsStage = PROTOCOL_TYPES.find(t => t.key === genType)?.needsStage;

  return (
    <div className="protocols-page">
      <Header title="Протоколы соревнования" />

      <div className="protocols-page__content">
        <label className="protocols-page__field">
          <span>Соревнование</span>
          <select value={competitionId} onChange={(e) => setCompetitionId(e.target.value)}>
            {competitions.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>

        {feedback && (
          <div
            className={`protocols-page__feedback protocols-page__feedback--${feedback.type}`}
            onClick={() => setFeedback(null)}
            role="status"
          >{feedback.msg}</div>
        )}

        {isChief && competitionId && (
          <section className="protocols-page__form">
            <h3>Сгенерировать протокол</h3>
            <div className="protocols-page__row">
              <label className="protocols-page__field">
                <span>Тип</span>
                <select value={genType} onChange={(e) => setGenType(e.target.value)}>
                  {PROTOCOL_TYPES.map(t => (
                    <option key={t.key} value={t.key}>{t.label}</option>
                  ))}
                </select>
              </label>
              {needsStage && (
                <label className="protocols-page__field">
                  <span>Этап</span>
                  <select value={stageId} onChange={(e) => setStageId(e.target.value)} required>
                    {stages.length === 0 && <option value="">— нет этапов —</option>}
                    {stages.map(s => (
                      <option key={s.id} value={s.id}>
                        #{s.ordinal} {s.stage_type}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <button
              type="button"
              className="protocols-page__btn-submit"
              onClick={generate}
              disabled={busy || (needsStage && !stageId)}
            >
              {busy ? 'Создание…' : 'Создать и подписать'}
            </button>
          </section>
        )}

        <section className="protocols-page__list">
          <h3>История протоколов</h3>
          {protocols.length === 0 ? (
            <p className="protocols-page__empty">Протоколы ещё не выпускались</p>
          ) : (
            <table className="protocols-page__table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Тип</th>
                  <th>Этап</th>
                  <th>Подписал</th>
                  <th>Хэш</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {protocols.map(p => (
                  <tr key={p.id}>
                    <td>{new Date(p.signed_at).toLocaleString()}</td>
                    <td>{TYPE_LABEL_BY_KEY[p.protocol_type] || p.protocol_type}</td>
                    <td>{p.stage_id || '—'}</td>
                    <td>{p.signed_by_email}</td>
                    <td className="protocols-page__cell-hash">{p.payload_hash.slice(0, 12)}…</td>
                    <td>
                      <button type="button" onClick={() => openHtml(p.id)}>Открыть</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}
