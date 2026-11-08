import test from 'node:test';
import assert from 'node:assert/strict';
import { assertExpectedVersion, sameContent, versionOf } from '../online/backup-version.mjs';

test('absent initial manifest may create a first backup', () => {
  assert.equal(versionOf(undefined), null);
  assert.doesNotThrow(() => assertExpectedVersion(null, null));
});

test('unchanged manifest version is safe', () => {
  assert.doesNotThrow(() => assertExpectedVersion({ version: 'a' }, { version: 'a' }));
});

test('another device created a manifest after initial scan', () => {
  assert.throws(() => assertExpectedVersion(null, { version: 'b' }), /backup-conflict/);
});

test('another device replaced the expected version', () => {
  assert.throws(() => assertExpectedVersion({ version: 'a' }, { version: 'b' }), /backup-conflict/);
});

test('missing newer manifest is also a conflict', () => {
  assert.throws(() => assertExpectedVersion({ version: 'a' }, null), /backup-conflict/);
});

test('unchanged fingerprint permits no-op without a write', () => {
  assert.equal(sameContent({sha256:'hash'}, 'hash'), true);
  assert.equal(sameContent({sha256:'hash'}, 'different'), false);
  assert.equal(sameContent(null, 'hash'), false);
});
