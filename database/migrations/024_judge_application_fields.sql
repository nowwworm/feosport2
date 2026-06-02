-- Judge application fields from FormDesigner form 245210.
-- Stores numeric coaching experience while keeping the legacy boolean
-- users.has_coaching_experience for coarse filtering/backward compatibility.

ALTER TABLE users ADD COLUMN IF NOT EXISTS coaching_experience_years INTEGER;

COMMENT ON COLUMN users.region IS 'Федеральный округ из формы 245210';
COMMENT ON COLUMN users.judge_category IS 'Судейская категория из формы 245210: Национальная / Региональная / Местная / Без категории';
COMMENT ON COLUMN users.judge_disciplines IS 'Дисциплины для судейства из формы 245210';
COMMENT ON COLUMN users.coaching_experience_years IS 'Опыт тренерской работы в годах из формы 245210';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'users_coaching_experience_years_nonnegative'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_coaching_experience_years_nonnegative
      CHECK (coaching_experience_years IS NULL OR coaching_experience_years >= 0);
  END IF;
END $$;
