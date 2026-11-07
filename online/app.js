import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js';
import { getFirestore, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, serverTimestamp, query, orderBy } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js';
import { firebaseConfig, schoolId } from './config.js';

// The new online foundation is independent of the legacy Daragat activation code.
// Firestore rules (not client-side role checks) are the authority for every operation.
const $ = (id) => document.getElementById(id);
const digits = '٠١٢٣٤٥٦٧٨٩';
const num = (value) => String(value).replace(/[0-9]/g, (n) => digits[Number(n)]);
const statuses = { present: 'ئامادە', absent: 'نائامادە', excused: 'مۆڵەت‌پێدراو' };
const state = { auth: null, db: null, user: null, role: '', students: [], attendance: new Map(), busy: false };
let messageTimeout;

function localDate() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function configured() {
  const cfg = firebaseConfig;
  return !!(cfg && typeof cfg === 'object' && ['apiKey', 'authDomain', 'projectId', 'appId'].every((k) => typeof cfg[k] === 'string' && cfg[k].trim())
    && typeof schoolId === 'string' && /^[A-Za-z0-9_-]{2,60}$/.test(schoolId));
}

function show(id) {
  for (const panel of ['setup', 'login-panel', 'dashboard']) $(panel).hidden = panel !== id;
}

function badge(text, good = false) {
  $('connection-badge').textContent = text;
  $('connection-badge').className = `badge ${good ? 'good' : 'bad'}`;
}

function notify(text, error = false) {
  clearTimeout(messageTimeout);
  const item = $('message');
  item.textContent = text;
  item.className = `message ${error ? 'error' : ''}`;
  item.hidden = false;
  messageTimeout = setTimeout(() => { item.hidden = true; }, 7000);
}

function readableError(error) {
  const code = error?.code || '';
  const messages = {
    'auth/invalid-credential': 'ئیمەیڵ یان وشەی نهێنی هەڵەیە.',
    'auth/invalid-email': 'شێوازی ئیمەیڵ دروست نییە.',
    'auth/too-many-requests': 'هەوڵی زۆر دراوە؛ دوای ماوەیەک دووبارە هەوڵ بدەرەوە.',
    'auth/network-request-failed': 'پەیوەندیی ئینتەرنێت بپشکنە.',
    'permission-denied': 'مۆڵەتت نییە. ڕۆڵی هەژمار و Firestore Rules بپشکنە.',
    'unavailable': 'سێرڤەر بەردەست نییە؛ داتا پاشەکەوت نەکرا.'
  };
  return messages[code] || 'کارەکە سەرکەوتوو نەبوو. پەیوەندی و ڕێکخستنەکان بپشکنە.';
}

function setBusy(value) {
  state.busy = value;
  $('login-submit').disabled = value;
  $('work-date').disabled = value;
  $('refresh').disabled = value;
  $('student-form').querySelectorAll('button,input').forEach((element) => { element.disabled = value; });
}

async function login(event) {
  event.preventDefault();
  if (state.busy) return;
  setBusy(true);
  try {
    const email = $('email').value.trim();
    const password = $('password').value;
    await signInWithEmailAndPassword(state.auth, email, password);
    $('password').value = '';
  } catch (error) {
    notify(readableError(error), true);
  } finally {
    setBusy(false);
  }
}

async function authorize(user) {
  // Never trust a role from LocalStorage or from the sign-in form.
  const member = await getDoc(doc(state.db, 'schools', schoolId, 'members', user.uid));
  if (!member.exists() || member.data().active !== true || !['admin', 'staff'].includes(member.data().role)) {
    throw new Error('membership-missing');
  }
  return member.data().role;
}

function dateId() {
  return $('work-date').value;
}

async function loadDay() {
  if (!state.user || state.busy) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateId())) { notify('ڕۆژێکی دروست هەڵبژێرە.', true); return; }
  setBusy(true);
  $('student-rows').replaceChildren(rowMessage('زانیاری بار دەکرێت…'));
  try {
    // Explicit one-time reads; no permanent snapshot listeners or polling.
    const [studentsSnap, attendanceSnap] = await Promise.all([
      getDocs(query(collection(state.db, 'schools', schoolId, 'students'), orderBy('name'))),
      getDocs(collection(state.db, 'schools', schoolId, 'days', dateId(), 'attendance'))
    ]);
    state.students = studentsSnap.docs.filter((item) => item.data().active === true)
      .map((item) => ({ id: item.id, name: String(item.data().name || ''), className: String(item.data().className || '') }));
    state.attendance = new Map(attendanceSnap.docs.map((item) => [item.id, item.data().status]));
    renderClasses();
    render();
    badge('پەیوەندی چالاکە', true);
  } catch (error) {
    $('student-rows').replaceChildren(rowMessage('زانیاری بار نەبوو؛ دووبارە هەوڵ بدەرەوە.'));
    notify(readableError(error), true);
    badge('هەڵەی پەیوەندی');
  } finally {
    setBusy(false);
  }
}

function rowMessage(text) {
  const row = document.createElement('tr');
  const cell = document.createElement('td');
  cell.colSpan = state.role === 'admin' ? 5 : 4;
  cell.className = 'empty';
  cell.textContent = text;
  row.append(cell);
  return row;
}

function renderClasses() {
  const select = $('class-filter');
  const previous = select.value;
  select.replaceChildren(new Option('هەموو پۆلەکان', ''));
  const classes = [...new Set(state.students.map((student) => student.className))].filter(Boolean).sort((a, b) => a.localeCompare(b, 'ckb'));
  for (const name of classes) select.add(new Option(name, name));
  if (classes.includes(previous)) select.value = previous;
}

function updateCounters() {
  const list = state.students;
  $('count-total').textContent = num(list.length);
  for (const key of ['present', 'absent', 'excused']) {
    const count = list.filter((student) => state.attendance.get(student.id) === key).length;
    $(`count-${key}`).textContent = num(count);
  }
}

function visibleStudents() {
  const needle = $('student-search').value.trim().toLocaleLowerCase();
  const selectedClass = $('class-filter').value;
  return state.students.filter((item) => (!selectedClass || item.className === selectedClass)
    && (!needle || item.name.toLocaleLowerCase().includes(needle)));
}

function render() {
  updateCounters();
  const students = visibleStudents();
  const body = $('student-rows');
  body.replaceChildren();
  if (!students.length) { body.append(rowMessage('هیچ قوتابییەک نەدۆزرایەوە.')); return; }
  const fragment = document.createDocumentFragment();
  for (const student of students) {
    const row = document.createElement('tr');
    const name = document.createElement('td'); name.textContent = student.name;
    const className = document.createElement('td'); className.textContent = student.className;
    const statusCell = document.createElement('td');
    const select = document.createElement('select');
    select.className = 'status-select';
    select.setAttribute('aria-label', `دۆخی ${student.name}`);
    select.add(new Option('دیاری نەکراوە', ''));
    for (const [key, label] of Object.entries(statuses)) select.add(new Option(label, key));
    select.value = state.attendance.get(student.id) || '';
    statusCell.append(select);
    const action = document.createElement('td');
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'save-button'; button.textContent = 'پاشەکەوتکردن';
    button.disabled = true;
    select.addEventListener('change', () => { button.disabled = !select.value || select.value === (state.attendance.get(student.id) || ''); });
    button.addEventListener('click', () => saveAttendance(student, select, button));
    action.append(button);
    row.append(name, className, statusCell, action);
    if (state.role === 'admin') {
      const manage = document.createElement('td');
      manage.className = 'manage-cell';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'secondary edit-button';
      edit.textContent = 'دەستکاری / گواستنەوە';
      edit.addEventListener('click', () => editStudent(student));
      manage.append(edit);
      row.append(manage);
    }
    fragment.append(row);
  }
  body.append(fragment);
}

async function saveAttendance(student, select, button) {
  if (state.busy || !state.user) return;
  const value = select.value;
  if (!statuses[value] || value === state.attendance.get(student.id)) return;
  const savedDate = dateId();
  button.disabled = true;
  select.disabled = true;
  try {
    await setDoc(doc(state.db, 'schools', schoolId, 'days', savedDate, 'attendance', student.id), {
      status: value,
      updatedAt: serverTimestamp(),
      updatedBy: state.user.uid
    });
    if (savedDate === dateId()) { state.attendance.set(student.id, value); updateCounters(); }
    notify(`دۆخی ${student.name} پاشەکەوت کرا.`);
  } catch (error) {
    notify(readableError(error), true);
  } finally {
    select.disabled = false;
    button.disabled = !select.value || select.value === (state.attendance.get(student.id) || '');
  }
}

async function addStudent(event) {
  event.preventDefault();
  if (state.busy || state.role !== 'admin') return;
  const name = $('student-name').value.trim();
  const className = $('student-class').value.trim();
  if (!name || !className || name.length > 100 || className.length > 40) { notify('ناوی قوتابی و پۆل بە درستی بنووسە.', true); return; }
  setBusy(true);
  try {
    const ref = await addDoc(collection(state.db, 'schools', schoolId, 'students'), {
      name, className, active: true, createdAt: serverTimestamp()
    });
    state.students.push({ id: ref.id, name, className });
    state.students.sort((a, b) => a.name.localeCompare(b.name, 'ckb'));
    $('student-form').reset();
    renderClasses(); render();
    notify('قوتابی بە سەرکەوتوویی زیاد کرا.');
  } catch (error) {
    notify(readableError(error), true);
  } finally {
    setBusy(false);
  }
}

function editStudent(student) {
  if (state.role !== 'admin' || state.busy) return;
  $('edit-student-id').value = student.id;
  $('edit-student-name').value = student.name;
  $('edit-student-class').value = student.className;
  $('student-dialog').showModal();
  $('edit-student-name').focus();
}

async function saveStudentEdits(event) {
  event.preventDefault();
  if (state.role !== 'admin' || state.busy || !state.user) return;
  const id = $('edit-student-id').value;
  const item = state.students.find((student) => student.id === id);
  if (!item) { notify('قوتابی نەدۆزرایەوە. نوێکردنەوە بکە.', true); return; }
  const name = $('edit-student-name').value.trim();
  const className = $('edit-student-class').value.trim();
  if (!name || !className || name.length > 100 || className.length > 40) {
    notify('ناو و پۆل بە درستی پڕ بکەرەوە.', true);
    return;
  }
  if (name === item.name && className === item.className) { $('student-dialog').close(); return; }
  const oldClassName = item.className;
  const wasViewingOldClass = $('class-filter').value === oldClassName;
  $('save-student-edit').disabled = true;
  $('cancel-student-edit').disabled = true;
  setBusy(true);
  try {
    // Keep the same student document ID; historical attendance is keyed by this ID.
    await updateDoc(doc(state.db, 'schools', schoolId, 'students', id), { name, className });
    item.name = name;
    item.className = className;
    state.students.sort((a, b) => a.name.localeCompare(b.name, 'ckb'));
    $('student-dialog').close();
    renderClasses();
    if (wasViewingOldClass && className !== oldClassName) $('class-filter').value = className;
    render();
    notify('زانیاریی قوتابی پاشەکەوت کرا؛ تۆمارە کۆنەکانی ئامادەبوون پارێزراون.');
  } catch (error) {
    notify(readableError(error), true);
  } finally {
    setBusy(false);
    $('save-student-edit').disabled = false;
    $('cancel-student-edit').disabled = false;
  }
}

function csvCell(value) {
  // Prevent spreadsheet formula execution if a name or class begins with =, +, -, @.
  const clean = String(value).replace(/[\r\n\t]/g, ' ').trim();
  const safe = /^[=+\-@]/.test(clean) ? "'" + clean : clean;
  return '"' + safe.replace(/"/g, '""') + '"';
}

function downloadDailyReport() {
  if (!state.user || state.busy) return;
  const rows = [
    ['ڕۆژ', 'ناوی قوتابی', 'پۆل', 'دۆخی ئامادەبوون'],
    ...visibleStudents().map((item) => [
      dateId(), item.name, item.className, statuses[state.attendance.get(item.id)] || 'دیاری نەکراوە'
    ])
  ];
  const csv = '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'daragat-report-' + dateId() + '.csv';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function handleAuth(user) {
  state.user = null;
  state.role = '';
  state.students = [];
  state.attendance = new Map();
  $('logout').hidden = !user;
  if (!user) { show('login-panel'); badge('چوونەژوورەوە پێویستە'); return; }
  try {
    const role = await authorize(user);
    state.user = user;
    state.role = role;
    $('student-entry').hidden = role !== 'admin';
    $('manage-heading').hidden = role !== 'admin';
    $('user-summary').textContent = `${user.email || 'هەژمار'} • ${role === 'admin' ? 'بەڕێوەبەر' : 'مامۆستا'} • ${schoolId}`;
    show('dashboard');
    await loadDay();
  } catch (error) {
    notify(error.message === 'membership-missing' ? 'هەژمارەکەت مۆڵەتی ئەم قوتابخانەیەی نییە. لەگەڵ بەڕێوەبەر قسە بکە.' : readableError(error), true);
    await signOut(state.auth);
  }
}

function start() {
  $('work-date').value = localDate();
  $('login-form').addEventListener('submit', login);
  $('student-form').addEventListener('submit', addStudent);
  $('work-date').addEventListener('change', loadDay);
  $('refresh').addEventListener('click', loadDay);
  $('export-day').addEventListener('click', downloadDailyReport);
  $('print-day').addEventListener('click', () => window.print());
  $('student-edit-form').addEventListener('submit', saveStudentEdits);
  $('cancel-student-edit').addEventListener('click', () => $('student-dialog').close());
  $('class-filter').addEventListener('change', render);
  $('student-search').addEventListener('input', render);
  $('logout').addEventListener('click', async () => { try { await signOut(state.auth); } catch (error) { notify(readableError(error), true); } });
  if (!configured()) { show('setup'); badge('ڕێکخستن پێویستە'); return; }
  try {
    const app = initializeApp(firebaseConfig);
    state.auth = getAuth(app);
    state.db = getFirestore(app);
    onAuthStateChanged(state.auth, handleAuth, (error) => { show('login-panel'); notify(readableError(error), true); });
  } catch (error) {
    show('setup'); badge('ڕێکخستن هەڵەیە'); notify(readableError(error), true);
  }
}

start();
