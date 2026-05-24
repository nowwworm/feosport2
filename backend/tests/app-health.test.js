const { Readable, Writable } = require('stream');

function request(app, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = new Readable({
      read() {
        this.push(null);
      },
    });
    req.method = 'GET';
    req.url = path;
    req.headers = Object.fromEntries(
      Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
    );

    let body = '';
    const responseHeaders = {};
    const res = new Writable({
      write(chunk, _encoding, callback) {
        body += chunk.toString();
        callback();
      },
    });
    res.statusCode = 200;
    res.setHeader = (key, value) => {
      responseHeaders[key.toLowerCase()] = value;
    };
    res.getHeader = key => responseHeaders[key.toLowerCase()];
    res.removeHeader = key => {
      delete responseHeaders[key.toLowerCase()];
    };
    res.writeHead = (statusCode, headersToSet = {}) => {
      res.statusCode = statusCode;
      Object.entries(headersToSet).forEach(([key, value]) => res.setHeader(key, value));
      return res;
    };
    res.end = chunk => {
      if (chunk) body += chunk.toString();
      resolve({ statusCode: res.statusCode, headers: responseHeaders, body });
      return res;
    };

    app.handle(req, res, reject);
  });
}

describe('app health and production CORS', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  test.each(['/healthz', '/api/healthz'])('returns ok for %s', async path => {
    const app = require('../src/app');

    const res = await request(app, path);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'ok' });
  });

  test('allows configured production origin', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOWED_ORIGINS = 'https://race.example.com';
    // Hard-fail guards expect these to be set in production.
    process.env.JWT_SECRET = 'test_prod_secret_for_app_health_test';
    process.env.WEBHOOK_SECRET = 'test_prod_webhook_secret_for_app_health_test';
    process.env.DB_PASSWORD = 'test_prod_db_password_for_app_health_test';
    jest.resetModules();
    const app = require('../src/app');

    const res = await request(app, '/healthz', { Origin: 'https://race.example.com' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://race.example.com');
  });
});
