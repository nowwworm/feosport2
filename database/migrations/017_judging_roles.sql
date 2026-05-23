-- Migration 017: judging panel roles per Раздел VI правил (ГСК).
--
-- Существующие роли (admin, chief_judge, judge, pilot) сохраняются ради
-- обратной совместимости. `judge` отныне трактуется как "любой
-- специалист-судья" в коде, который ещё не разнесён по конкретным ролям.

INSERT INTO roles (name) VALUES
    ('deputy_chief_judge'),
    ('chief_secretary'),
    ('deputy_secretary'),
    ('pilot_zone_judge'),
    ('tech_control_judge'),
    ('senior_pit_judge'),
    ('pit_judge'),
    ('chronometer_judge'),
    ('informer_judge'),
    ('tech_director'),
    ('competition_doctor')
ON CONFLICT (name) DO NOTHING;
