import test from 'node:test';
import assert from 'node:assert/strict';
import { runYearArchiveSelftest } from '../online/year-archive-selftest.mjs';

test('synthetic archive transfer verifies seven paths without reads/writes to school data', async () => {
  const result = await runYearArchiveSelftest();
  assert.deepEqual(result, {
    passed: 7, total: 7, fakeId: 'test_2024_2025', remoteWrites: 0, localWrites: 0
  });
});
