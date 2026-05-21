-- FeoSport2 — базовые пользователи
-- Идемпотентно: можно запускать повторно после установки или обновления.
-- Пароли: admin@feosport.local -> admin123 | остальные -> judge123

INSERT INTO users (email, password_hash, role_id, is_active)
VALUES
  ('admin@feosport.local', '$2a$10$PKRk3ezNIg5rR3RnSoQu.OlfPmE7CFuPZQtUO3EBtXBDg7dBtswC.', 1, true),
  ('chief@feosport.local', '$2a$10$o8Ywy/SljigQxIFmfKlp2.78.zVdSYyM4csHKJ9cdwY3VnXAzkf5S', 2, true),
  ('judge@feosport.local', '$2a$10$o8Ywy/SljigQxIFmfKlp2.78.zVdSYyM4csHKJ9cdwY3VnXAzkf5S', 3, true),
  ('pilot@feosport.local', '$2a$10$o8Ywy/SljigQxIFmfKlp2.78.zVdSYyM4csHKJ9cdwY3VnXAzkf5S', 4, true)
ON CONFLICT (email) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  role_id = EXCLUDED.role_id,
  is_active = true,
  updated_at = NOW();
