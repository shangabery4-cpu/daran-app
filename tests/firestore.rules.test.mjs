import { readFileSync } from 'node:fs';
import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc
} from 'firebase/firestore';

const PROJECT_ID = 'demo-daragat-sorani-rules';
const SCHOOL_ID = 'demo-school';
const OTHER_SCHOOL_ID = 'other-demo-school';
const ARCHIVE_ID = '2024_2025';
const VERSION = '123e4567-e89b-42d3-a456-426614174000';
const RULES = readFileSync(new URL('../online/firestore.rules', import.meta.url), 'utf8');
const [EMULATOR_HOST, EMULATOR_PORT] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');

let env;

function dbFor(uid) {
  return env.authenticatedContext(uid).firestore();
}

function archivePath(schoolId = SCHOOL_ID, archiveId = ARCHIVE_ID) {
  return `schools/${schoolId}/yearArchives/${archiveId}`;
}

function chunkPath(schoolId = SCHOOL_ID, archiveId = ARCHIVE_ID) {
  return `${archivePath(schoolId, archiveId)}/versions/${VERSION}/chunks/0000`;
}

function validManifest(uid = 'admin-a', extra = {}) {
  return {
    version: VERSION,
    chunks: 1,
    encoding: 'utf8-b64',
    sha256: 'a'.repeat(64),
    byteLength: 4,
    label: '2024–2025 ساختە',
    createdAt: serverTimestamp(),
    createdBy: uid,
    ...extra
  };
}

function validChunk(uid = 'admin-a') {
  return {
    data: 'ZmFrZQ==',
    createdAt: serverTimestamp(),
    createdBy: uid
  };
}

async function seedBaseData() {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    const members = [
      ['admin-a', { active: true, role: 'admin' }],
      ['admin-b', { active: true, role: 'admin' }],
      ['staff-1', { active: true, role: 'staff' }],
      ['viewer-1', { active: true, role: 'viewer' }],
      ['inactive-admin', { active: false, role: 'admin' }]
    ];
    await Promise.all(members.map(([uid, data]) =>
      setDoc(doc(db, `schools/${SCHOOL_ID}/members/${uid}`), data)
    ));
    await setDoc(doc(db, `schools/${SCHOOL_ID}/students/student-1`), {
      name: 'قوتابی تاقیکردنەوە',
      className: '7 ب',
      active: true,
      createdAt: serverTimestamp()
    });
  });
}

async function createArchiveAsAdmin() {
  const adminDb = dbFor('admin-a');
  await assertSucceeds(setDoc(doc(adminDb, archivePath()), validManifest('admin-a')));
  await assertSucceeds(setDoc(doc(adminDb, chunkPath()), validChunk('admin-a')));
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: EMULATOR_HOST,
      port: Number(EMULATOR_PORT),
      rules: RULES
    }
  });
});

after(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await seedBaseData();
});

test('unauthenticated clients cannot read school data or sealed-year archives', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, archivePath())));
  await assertFails(getDocs(collection(db, `schools/${SCHOOL_ID}/yearArchives`)));
  await assertFails(getDoc(doc(db, `schools/${SCHOOL_ID}/students/student-1`)));
});

test('two independent admin clients share a persisted immutable archive', async () => {
  const deviceA = dbFor('admin-a');
  const deviceB = dbFor('admin-b');

  await assertSucceeds(setDoc(doc(deviceA, archivePath()), validManifest('admin-a')));
  await assertSucceeds(setDoc(doc(deviceA, chunkPath()), validChunk('admin-a')));

  const manifestOnB = await assertSucceeds(getDoc(doc(deviceB, archivePath())));
  const chunkOnB = await assertSucceeds(getDoc(doc(deviceB, chunkPath())));
  assert.equal(manifestOnB.exists(), true);
  assert.equal(manifestOnB.data().label, '2024–2025 ساختە');
  assert.equal(chunkOnB.exists(), true);
  assert.equal(chunkOnB.data().data, 'ZmFrZQ==');

  await assertFails(updateDoc(doc(deviceB, archivePath()), { label: 'گۆڕانکاری' }));
  await assertFails(deleteDoc(doc(deviceB, archivePath())));
  await assertFails(setDoc(doc(deviceB, archivePath()), validManifest('admin-b')));
});

test('staff cannot read or write sealed-year archives, but can record attendance', async () => {
  await createArchiveAsAdmin();
  const staffDb = dbFor('staff-1');

  await assertFails(getDoc(doc(staffDb, archivePath())));
  await assertFails(getDocs(collection(staffDb, `schools/${SCHOOL_ID}/yearArchives`)));
  await assertFails(getDoc(doc(staffDb, chunkPath())));
  await assertFails(setDoc(doc(staffDb, archivePath(SCHOOL_ID, 'staff-attempt')), validManifest('staff-1')));
  await assertFails(setDoc(doc(staffDb, chunkPath(SCHOOL_ID, 'staff-attempt')), validChunk('staff-1')));

  await assertSucceeds(setDoc(
    doc(staffDb, `schools/${SCHOOL_ID}/days/2026-11-09/attendance/student-1`),
    { status: 'present', updatedAt: serverTimestamp(), updatedBy: 'staff-1' }
  ));
});

test('inactive admins, viewers, and admins from another school are denied', async () => {
  await createArchiveAsAdmin();

  for (const uid of ['inactive-admin', 'viewer-1']) {
    const db = dbFor(uid);
    await assertFails(getDoc(doc(db, archivePath())));
    await assertFails(getDocs(collection(db, `schools/${SCHOOL_ID}/yearArchives`)));
    await assertFails(setDoc(doc(db, archivePath(SCHOOL_ID, `blocked-${uid}`)), validManifest(uid)));
  }

  const otherSchoolArchive = `schools/${OTHER_SCHOOL_ID}/yearArchives/${ARCHIVE_ID}`;
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), otherSchoolArchive), {
      version: VERSION,
      chunks: 1,
      encoding: 'utf8-b64',
      sha256: 'b'.repeat(64),
      byteLength: 4,
      label: 'Other school',
      createdAt: serverTimestamp(),
      createdBy: 'seed'
    });
  });
  await assertFails(getDoc(doc(dbFor('admin-a'), otherSchoolArchive)));
});

test('membership self-escalation and malformed archive manifests are denied', async () => {
  const adminDb = dbFor('admin-a');
  const staffDb = dbFor('staff-1');

  await assertFails(updateDoc(
    doc(adminDb, `schools/${SCHOOL_ID}/members/admin-a`),
    { role: 'admin', active: true }
  ));
  await assertFails(updateDoc(
    doc(staffDb, `schools/${SCHOOL_ID}/members/staff-1`),
    { role: 'admin', active: true }
  ));

  await assertFails(setDoc(
    doc(adminDb, archivePath(SCHOOL_ID, 'bad-extra-field')),
    validManifest('admin-a', { accessToken: 'must-never-be-stored' })
  ));
  await assertFails(setDoc(
    doc(adminDb, archivePath(SCHOOL_ID, 'too-many-chunks')),
    validManifest('admin-a', { chunks: 73 })
  ));
});

test('viewer cannot write attendance and staff cannot create students', async () => {
  const viewerDb = dbFor('viewer-1');
  const staffDb = dbFor('staff-1');

  await assertFails(setDoc(
    doc(viewerDb, `schools/${SCHOOL_ID}/days/2026-11-09/attendance/student-1`),
    { status: 'present', updatedAt: serverTimestamp(), updatedBy: 'viewer-1' }
  ));
  await assertFails(setDoc(
    doc(staffDb, `schools/${SCHOOL_ID}/students/student-2`),
    { name: 'نابێت دروست بکرێت', className: '7 ب', active: true, createdAt: serverTimestamp() }
  ));
});
