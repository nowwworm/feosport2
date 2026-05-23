// @ts-check
// Shared E2E helpers — login via REST then inject JWT into localStorage so
// the React app boots straight into an authenticated session.

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8090';

async function login(email = 'admin@feosport.local', password = 'admin123') {
  const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login failed: HTTP ${res.status}`);
  return res.json(); // { token, user }
}

async function loginAndVisit(page, path, credentials) {
  const { token, user } = await login(
    credentials?.email,
    credentials?.password,
  );
  await page.addInitScript(({ token, user }) => {
    localStorage.setItem('fs_token', token);
    localStorage.setItem('fs_user', JSON.stringify(user));
  }, { token, user });
  await page.goto(path);
  return { token, user };
}

// Collect console errors so tests can assert "no JS errors".
function collectPageErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });
  return errors;
}

module.exports = { login, loginAndVisit, collectPageErrors, BACKEND_URL };
