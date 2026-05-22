import assert from 'node:assert/strict';
import { resolveSocketUrl } from '../src/config/socketEndpoint.js';

assert.equal(resolveSocketUrl(''), undefined);
assert.equal(resolveSocketUrl('   '), undefined);
assert.equal(resolveSocketUrl(undefined), undefined);
assert.equal(resolveSocketUrl('http://localhost:8090'), 'http://localhost:8090');
assert.equal(resolveSocketUrl('https://race.example.com'), 'https://race.example.com');
