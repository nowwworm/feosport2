-- Judge registration fields — from FormDesigner judge-registration form.
-- Fields extend the existing `users` table since the chosen storage option
-- was to put judge profile data alongside the user record (not a separate
-- judges table). Columns are nullable so existing admin/pilot users aren't
-- forced to have judge metadata.
--
-- Validation source of truth:
--   backend/src/constants/judgeRegistration.js
--   backend/src/schemas/judgeRegistration.js

ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name              VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name               VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS middle_name             VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_date              DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone                   VARCHAR(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS region                  VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS judge_category          VARCHAR(32);
ALTER TABLE users ADD COLUMN IF NOT EXISTS judge_disciplines       TEXT[];
ALTER TABLE users ADD COLUMN IF NOT EXISTS has_coaching_experience BOOLEAN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS additional_info         TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS external_id             VARCHAR(100);

COMMENT ON COLUMN users.first_name              IS 'Имя (из FD-формы для судей)';
COMMENT ON COLUMN users.last_name               IS 'Фамилия';
COMMENT ON COLUMN users.middle_name             IS 'Отчество';
COMMENT ON COLUMN users.birth_date              IS 'Дата рождения';
COMMENT ON COLUMN users.phone                   IS 'Контактный телефон';
COMMENT ON COLUMN users.region                  IS 'Регион проживания (Москва / Санкт-Петербург / Другой регион / свободный текст)';
COMMENT ON COLUMN users.judge_category          IS 'Судейская категория: Всероссийская / 1 / 2 / 3';
COMMENT ON COLUMN users.judge_disciplines       IS 'Дисциплины которые готов судить (массив строк)';
COMMENT ON COLUMN users.has_coaching_experience IS 'Есть ли тренерский опыт (Да/Нет)';
COMMENT ON COLUMN users.additional_info         IS 'Произвольная информация от судьи';
COMMENT ON COLUMN users.external_id             IS 'ID записи из FormDesigner или другого источника (для dedup при импорте)';

-- Partial unique index — позволяет иметь много NULL (для admin/pilot
-- которые не приходят из FD), но запрещает дубли external_id из одного
-- источника при повторном импорте → можно делать ON CONFLICT.
CREATE UNIQUE INDEX IF NOT EXISTS users_external_id_uq
  ON users (external_id)
  WHERE external_id IS NOT NULL;
