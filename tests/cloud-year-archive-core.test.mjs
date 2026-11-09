import test from 'node:test';
import assert from 'node:assert/strict';
import {
  yearPackage, checkEncodedYear, validateCloudYearManifest,
  uploadDecision, validateDownloadedYear, isActiveYearAdmin,
  makeYearVerificationReceipt, parseYearVerificationReceipt, matchesYearVerificationReceipt,
  CLOUD_YEAR_MAX_BYTES, CLOUD_YEAR_MAX_CHUNKS
} from '../online/cloud-year-archive-core.mjs';

const id = '2024_2025';
const record = { id, meta: { id, academicYear: '2024–2025' }, snapshot: JSON.stringify({v:1,store:{schoolResultsGradebook_v1:'{}'}}) };
const encoded = { byteLength: 290, chunks:['abcd'], sha256:'a'.repeat(64), encoding:'utf8-b64' };
const manifest = { ...encoded, version:'123e4567-e89b-42d3-a456-426614174000', chunks:1, label:'2024–2025' };

test('one-year package validates and never includes other years', () => {
  const pack = yearPackage(record);
  assert.equal(pack.records.length, 1);
  assert.deepEqual(validateDownloadedYear(JSON.stringify(pack), id), pack);
  assert.throws(() => validateDownloadedYear(JSON.stringify(pack), 'other'), /cloud-year-corrupt/);
});
test('bad record and private unapproved storage keys are rejected', () => {
  assert.throws(() => yearPackage({...record, snapshot:'{"v":1,"store":{"token":"secret"}}'}), /invalid-archive-snapshot/);
  assert.throws(() => yearPackage({...record, snapshot:'{"v":1,"store":{"schoolResultsSession_v1":"secret"}}'}), /cloud-year-private-key/);
});
test('cloud cap prevents unexpectedly expensive uploads', () => {
  assert.equal(checkEncodedYear(encoded), encoded);
  assert.throws(() => checkEncodedYear({...encoded, byteLength: CLOUD_YEAR_MAX_BYTES + 1}), /cloud-year-too-large/);
  assert.throws(() => checkEncodedYear({...encoded, chunks: Array(CLOUD_YEAR_MAX_CHUNKS + 1).fill('a')}), /cloud-year-too-large/);
});
test('immutable cloud IDs: skip same content, refuse changed content', () => {
  assert.equal(uploadDecision(null, encoded, id), 'create');
  assert.equal(uploadDecision(manifest, encoded, id), 'skip');
  assert.throws(() => uploadDecision(manifest, {...encoded,sha256:'b'.repeat(64)}, id), /cloud-year-conflict/);
});
test('manifest rejects corrupt, forged or oversized chunk metadata', () => {
  assert.equal(validateCloudYearManifest(manifest,id), manifest);
  assert.throws(() => validateCloudYearManifest({...manifest, version:'bad'},id), /cloud-year-corrupt/);
  assert.throws(() => validateCloudYearManifest({...manifest,chunks:101},id), /cloud-year-corrupt/);
  assert.throws(() => validateCloudYearManifest(manifest,'bad/id'), /cloud-year-corrupt/);
});
test('admin role guard rejects staff, viewer, inactive, and mismatched sessions', () => {
  assert.equal(isActiveYearAdmin({active:true,role:'admin'},'a','a'),true);
  assert.equal(isActiveYearAdmin({active:true,role:'staff'},'a','a'),false);
  assert.equal(isActiveYearAdmin({active:true,role:'viewer'},'a','a'),false);
  assert.equal(isActiveYearAdmin({active:false,role:'admin'},'a','a'),false);
  assert.equal(isActiveYearAdmin({active:true,role:'admin'},'a','b'),false);
});

test('device A and B can match the same fully verified cloud manifest without exposing records', () => {
  const proof = makeYearVerificationReceipt(manifest, id, 'daragat-sorani');
  const decoded = parseYearVerificationReceipt(proof);
  assert.equal(decoded.archiveId, id);
  assert.equal(decoded.schoolId, 'daragat-sorani');
  assert.equal(proof.includes('schoolResultsGradebook'), false);
  assert.equal(matchesYearVerificationReceipt(proof, {...manifest}, id, 'daragat-sorani'), true);
});

test('comparison rejects changed manifest and wrong school or selected year', () => {
  const proof = makeYearVerificationReceipt(manifest, id, 'daragat-sorani');
  assert.equal(matchesYearVerificationReceipt(proof, {...manifest, sha256:'b'.repeat(64)}, id, 'daragat-sorani'), false);
  assert.equal(matchesYearVerificationReceipt(proof, manifest, id, 'different-school'), false);
  assert.equal(matchesYearVerificationReceipt(proof, {...manifest}, '2025_2026', 'daragat-sorani'), false);
  assert.equal(matchesYearVerificationReceipt(proof, {...manifest, version:'00000000-0000-0000-0000-000000000001'}, id, 'daragat-sorani'), false);
});

test('comparison proof rejects corrupted JSON, unknown fields, malformed hashes and oversized input', () => {
  const proof = makeYearVerificationReceipt(manifest, id, 'daragat-sorani');
  assert.throws(() => parseYearVerificationReceipt('{'), /receipt-invalid/);
  assert.throws(() => parseYearVerificationReceipt(proof + 'x'.repeat(1100)), /receipt-invalid/);
  assert.throws(() => parseYearVerificationReceipt(JSON.stringify({...JSON.parse(proof), unexpected: true})), /receipt-invalid/);
  assert.throws(() => parseYearVerificationReceipt(JSON.stringify({...JSON.parse(proof), sha256:'bad'})), /receipt-invalid/);
  assert.throws(() => makeYearVerificationReceipt(manifest, id, 'school/id'), /receipt-invalid/);
});
