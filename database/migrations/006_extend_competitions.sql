-- Migration 006: extend competitions with discipline / age / format / system.
--
-- Source: разделы 1.2 (дисциплины), 1.3 (характер), 1.4 (системы), 2.1
-- (возрастные группы), 3.2 (программа соревнований), 5.2 (заявочный взнос).

ALTER TABLE competitions ADD COLUMN IF NOT EXISTS discipline_id     INTEGER REFERENCES disciplines(id);
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS race_system_id    INTEGER REFERENCES race_systems(id);
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS race_format_id    INTEGER REFERENCES race_formats(id);
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS age_group_id      INTEGER REFERENCES age_groups(id);

-- Пол: 'M' | 'F' | 'X' (смешанные). NULL — не задано.
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS gender            CHAR(1);
ALTER TABLE competitions DROP CONSTRAINT IF EXISTS competitions_gender_chk;
ALTER TABLE competitions ADD  CONSTRAINT competitions_gender_chk
    CHECK (gender IS NULL OR gender IN ('M', 'F', 'X'));

-- Заявочный взнос (рубли). 5.2: max 3000 / 5000.
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS entry_fee_rub     INTEGER;

-- Дедлайн подачи заявок (5.1.3).
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS registration_deadline DATE;

-- Организатор (опциональная ссылка на пользователя).
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS organizer_id      INTEGER REFERENCES users(id);

-- Полный адрес проведения (3.2.8: место, маршрут, способ доставки).
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS venue_address     TEXT;

CREATE INDEX IF NOT EXISTS idx_competitions_discipline ON competitions(discipline_id);
CREATE INDEX IF NOT EXISTS idx_competitions_age_group  ON competitions(age_group_id);
