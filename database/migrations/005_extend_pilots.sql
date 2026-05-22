-- Migration 005: extend pilots with fields required by Минспорт rules.
--
-- Source: разделы 2.1 (возрастные группы), 2.2.3 (документы для допуска),
-- 2.5 (страхование), 5.1 (заявки).

ALTER TABLE pilots ADD COLUMN IF NOT EXISTS gender               CHAR(1);          -- 'M' | 'F'
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS age_group_id         INTEGER REFERENCES age_groups(id);
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS region               VARCHAR(255);     -- субъект РФ
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS registration_number  VARCHAR(64);      -- стартовый номер
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS sport_rank           VARCHAR(16);      -- 'КМС' | '1р' | '2р' | '3р' | 'б/р'
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS gto_passed           BOOLEAN NOT NULL DEFAULT false;
-- Дата окончания действия медицинского допуска (2.2.2).
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS medical_clearance_until DATE;
-- Дата окончания действия страховки от несчастных случаев (2.5).
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS insurance_until         DATE;
-- Email/телефон — для контакта с пилотом и заявок.
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS email                VARCHAR(255);
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS phone                VARCHAR(64);

-- gender — допустимые значения
ALTER TABLE pilots DROP CONSTRAINT IF EXISTS pilots_gender_chk;
ALTER TABLE pilots ADD  CONSTRAINT pilots_gender_chk
    CHECK (gender IS NULL OR gender IN ('M', 'F'));

-- sport_rank — допустимые значения по ЕВСК
ALTER TABLE pilots DROP CONSTRAINT IF EXISTS pilots_sport_rank_chk;
ALTER TABLE pilots ADD  CONSTRAINT pilots_sport_rank_chk
    CHECK (sport_rank IS NULL OR sport_rank IN ('КМС', '1р', '2р', '3р', 'б/р'));

CREATE INDEX IF NOT EXISTS idx_pilots_age_group ON pilots(age_group_id);
CREATE INDEX IF NOT EXISTS idx_pilots_region    ON pilots(region);
