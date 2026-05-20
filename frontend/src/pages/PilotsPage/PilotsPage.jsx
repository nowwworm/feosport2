import React, { useEffect, useState } from 'react';
import api    from '../../services/api';
import Header from '../../components/Header/Header';
import './PilotsPage.scss';

export default function PilotsPage() {
  const [pilots,  setPilots]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    api.get('/pilots')
      .then(({ data }) => setPilots(data))
      .catch(() => setError('Ошибка загрузки списка пилотов'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="pilots-page">
      <Header title="Список пилотов" />

      <div className="pilots-page__content">
        {loading && <p className="pilots-page__state">Загрузка…</p>}
        {error   && <p className="pilots-page__state pilots-page__state--error">{error}</p>}
        {!loading && !error && pilots.length === 0 && (
          <p className="pilots-page__state">Пилоты не зарегистрированы</p>
        )}

        {pilots.length > 0 && (
          <ul className="pilots-page__list">
            {pilots.map((p) => (
              <li key={p.id} className="pilots-page__item">
                <span className="pilots-page__num">#{p.id}</span>
                <div className="pilots-page__info">
                  <span className="pilots-page__name">
                    {p.last_name} {p.first_name}{p.middle_name ? ` ${p.middle_name}` : ''}
                  </span>
                  <span className="pilots-page__meta">
                    {[p.team, p.city].filter(Boolean).join(' · ')}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
