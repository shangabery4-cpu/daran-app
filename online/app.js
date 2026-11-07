import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js';
import { getFirestore, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, writeBatch, serverTimestamp, query, orderBy } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js';
import { firebaseConfig, schoolId } from './config.js';

// The new online foundation is independent of the legacy Daragat activation code.
// Firestore rules (not client-side role checks) are the authority for every operation.
const $ = (id) => document.getElementById(id);
const digits = '٠١٢٣٤٥٦٧٨٩';
const num = (value) => String(value).replace(/[0-9]/g, (n) => digits[Number(n)]);
const statuses = { present: 'ئامادە', absent: 'نائامادە', excused: 'مۆڵەت‌پێدراو' };
const state = { auth: null, db: null, user: null, role: '', students: [], studentsLoaded: false, attendance: new Map(), dayCache: new Map(), monthlyReport: null, parentReport: null, parentDayCache: new Map(), calendar: { termStart: '', termEnd: '', workingSaturdays: [], holidays: [] }, busy: false };
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
  $('build-month').disabled = value;
  $('load-members').disabled = value;
  $('build-parent-report').disabled = value;
  $('parent-report-form').querySelectorAll('input,select').forEach((element) => { element.disabled = value; });
  $('previous-day').disabled = value;
  $('next-day').disabled = value;
  $('today-button').disabled = value;
  $('class-rename-form').querySelectorAll('button,input,select').forEach((element) => { element.disabled = value; });
  $('student-form').querySelectorAll('button,input').forEach((element) => { element.disabled = value; });
  $('calendar-form').querySelectorAll('button,input,textarea').forEach((element) => { element.disabled = value; });
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

async function loadDay({ refreshStudents = false, forceDay = false } = {}) {
  if (!state.user || state.busy) return;
  const selectedDate = dateId();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) { notify('ڕۆژێکی دروست هەڵبژێرە.', true); return; }
  setBusy(true);
  $('student-rows').replaceChildren(rowMessage('زانیاری بار دەکرێت…'));
  const activeUid = state.user.uid;
  try {
    // Student records load once per session. Selected days are cached until explicit refresh.
    const [studentsSnap, attendanceSnap] = await Promise.all([
      (!state.studentsLoaded || refreshStudents)
        ? getDocs(query(collection(state.db, 'schools', schoolId, 'students'), orderBy('name')))
        : Promise.resolve(null),
      (!state.dayCache.has(selectedDate) || forceDay)
        ? getDocs(collection(state.db, 'schools', schoolId, 'days', selectedDate, 'attendance'))
        : Promise.resolve(null)
    ]);
    if (state.user?.uid !== activeUid) return;
    if (studentsSnap) {
      state.students = studentsSnap.docs.filter((item) => item.data().active === true)
        .map((item) => ({ id: item.id, name: String(item.data().name || ''), className: String(item.data().className || '') }));
      state.studentsLoaded = true;
    }
    if (attendanceSnap) {
      state.dayCache.set(selectedDate, new Map(attendanceSnap.docs.map((item) => [item.id, item.data().status])));
    }
    state.attendance = new Map(state.dayCache.get(selectedDate) || []);
    if (state.monthlyReport && (studentsSnap || (attendanceSnap && state.monthlyReport.month === selectedDate.slice(0, 7)))) invalidateMonthlyReport();
    if (state.parentReport && (studentsSnap || (attendanceSnap && state.parentReport.dates.includes(selectedDate)))) invalidateParentReport();
    renderClasses();
    render();
    renderHolidayBadge();
    badge('پەیوەندی چالاکە', true);
  } catch (error) {
    if (state.user?.uid !== activeUid) return;
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
  renderClassManagement(classes);
  const parent = $('parent-student');
  const previousStudent = parent.value;
  parent.replaceChildren(new Option('قوتابی هەڵبژێرە', ''));
  for (const student of state.students) parent.add(new Option(student.name + ' — ' + student.className, student.id));
  if (state.students.some((student) => student.id === previousStudent)) parent.value = previousStudent;
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
  if (!students.length) { body.append(rowMessage('هیچ قوتابییەک نەدۆزرایەوە.')); renderMonthlyReport(); return; }
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
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'secondary edit-button';
      copy.textContent = 'کۆپی ناسنامە';
      copy.title = 'ناسنامەی قوتابی بۆ هەژماری دایک‌وباوک';
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(student.id); notify('ناسنامەی قوتابی کۆپی کرا.'); }
        catch { window.prompt('ئەم ناسنامەیە کۆپی بکە:', student.id); }
      });
      manage.append(edit, copy);
      row.append(manage);
    }
    fragment.append(row);
  }
  body.append(fragment);
  renderMonthlyReport();
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
    const savedMap = state.dayCache.get(savedDate) || new Map();
    savedMap.set(student.id, value);
    state.dayCache.set(savedDate, savedMap);
    if (savedDate === dateId()) { state.attendance.set(student.id, value); updateCounters(); }
    invalidateMonthlyReport();
    invalidateParentReport();
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
    invalidateMonthlyReport();
    invalidateParentReport();
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
    invalidateMonthlyReport();
    invalidateParentReport();
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

// Class administration uses existing student documents; no new Firestore collection is required.
function renderClassManagement(classes) {
  const cards = $('class-cards');
  const select = $('class-rename-from');
  const oldChoice = select.value;
  cards.replaceChildren();
  select.replaceChildren(new Option('پۆل هەڵبژێرە', ''));
  for (const className of classes) {
    select.add(new Option(className, className));
    const count = state.students.filter((item) => item.className === className).length;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'class-card';
    button.textContent = className + ' — ' + num(count) + ' قوتابی';
    button.title = 'پیشاندانی قوتابییەکانی ئەم پۆلە';
    button.addEventListener('click', () => {
      $('class-filter').value = className;
      render();
      $('student-rows').closest('.panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    cards.append(button);
  }
  if (classes.includes(oldChoice)) select.value = oldChoice;
  if (!classes.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'هێشتا هیچ پۆلێک تۆمار نەکراوە.';
    cards.append(p);
  }
}

async function renameClass(event) {
  event.preventDefault();
  if (!state.user || state.role !== 'admin' || state.busy) return;
  const oldName = $('class-rename-from').value;
  const nextName = $('class-rename-to').value.trim();
  if (!oldName || !nextName || nextName.length > 40) {
    notify('پۆلی کۆن و ناوی نوێی پۆل بە درستی دیاری بکە.', true);
    return;
  }
  if (oldName === nextName) { notify('ناوی پۆل نەگۆڕاوە.'); return; }
  const members = state.students.filter((student) => student.className === oldName);
  if (!members.length) { notify('هیچ قوتابییەک لەم پۆلەدا نییە.', true); return; }
  if (members.length > 20) {
    notify('زیاتر لە ٢٠ قوتابییە؛ بۆ ئەم وەشانی تاقیکردنەوەیە قوتابییەکان بە تاکی بگوازەرەوە.', true);
    return;
  }
  const approved = window.confirm('دڵنیایت ناوی پۆلی «' + oldName + '» بگۆڕیت بۆ «' + nextName + '» بۆ ' + num(members.length) + ' قوتابی؟ ئەم کارە ' + num(members.length) + ' نووسینی Firebase بەکاردەهێنێت.');
  if (!approved) return;
  setBusy(true);
  try {
    const batch = writeBatch(state.db);
    for (const student of members) batch.update(doc(state.db, 'schools', schoolId, 'students', student.id), { className: nextName });
    await batch.commit();
    for (const student of members) student.className = nextName;
    if ($('class-filter').value === oldName) $('class-filter').value = '';
    $('class-rename-to').value = '';
    invalidateMonthlyReport();
    invalidateParentReport();
    renderClasses();
    $('class-filter').value = nextName;
    render();
    notify('ناوی پۆل گۆڕدرا و تۆمارەکانی ئامادەبوون پارێزراون.');
  } catch (error) {
    notify(readableError(error), true);
  } finally {
    setBusy(false);
  }
}

async function loadMembers() {
  if (!state.user || state.role !== 'admin' || state.busy) return;
  setBusy(true);
  const tbody = $('member-rows');
  tbody.replaceChildren();
  const activeUid = state.user.uid;
  try {
    const result = await getDocs(collection(state.db, 'schools', schoolId, 'members'));
    if (state.user?.uid !== activeUid) return;
    for (const item of result.docs) {
      const data = item.data();
      const tr = document.createElement('tr');
      const uid = document.createElement('td');
      uid.className = 'uid-cell';
      uid.textContent = item.id;
      const role = document.createElement('td');
      role.textContent = ({ admin: 'بەڕێوەبەر', staff: 'مامۆستا', viewer: 'تەنها بینەر', parent: 'دایک‌وباوک' })[data.role] || 'نەناسراو';
      const active = document.createElement('td');
      active.textContent = data.active === true ? 'چالاک' : 'ناچالاک';
      tr.append(uid, role, active);
      tbody.append(tr);
    }
    if (!result.docs.length) {
      const tr = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 3;
      cell.className = 'empty';
      cell.textContent = 'هیچ ئەندامێک نییە.';
      tr.append(cell);
      tbody.append(tr);
    }
  } catch (error) {
    notify(readableError(error), true);
  } finally {
    setBusy(false);
  }
}

function changeDate(delta) {
  if (!state.user || state.busy) return;
  const current = dateId();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(current)) return;
  const [year, month, day] = current.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12);
  date.setDate(date.getDate() + delta);
  const pad = (n) => String(n).padStart(2, '0');
  $('work-date').value = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  loadDay();
}

function invalidateMonthlyReport() {
  state.monthlyReport = null;
  $('export-month').disabled = true;
  $('month-rows').replaceChildren(rowMessage('ڕاپۆرتەکە پێویستی بە نوێکردنەوەیە.'));
  $('month-rows').firstElementChild.firstElementChild.colSpan = 5;
  $('month-progress').textContent = 'بۆ ڕاپۆرتی نوێ «دروستکردنی ڕاپۆرت» دابگرە.';
}

function renderMonthlyReport() {
  if (!state.monthlyReport) return;
  const tbody = $('month-rows');
  tbody.replaceChildren();
  const selected = new Set(visibleStudents().map((student) => student.id));
  const fragment = document.createDocumentFragment();
  for (const row of state.monthlyReport.rows) {
    if (!selected.has(row.id)) continue;
    const tr = document.createElement('tr');
    for (const value of [row.name, row.className, num(row.present), num(row.absent), num(row.excused)]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      tr.append(cell);
    }
    fragment.append(tr);
  }
  tbody.append(fragment);
  if (!tbody.children.length) {
    const tr = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 5;
    cell.className = 'empty';
    cell.textContent = 'هیچ قوتابییەک لە فلتەرەکەدا نییە.';
    tr.append(cell);
    tbody.append(tr);
  }
  $('export-month').disabled = false;
}

function monthDates(value) {
  if (!/^\d{4}-\d{2}$/.test(value)) return null;
  const [year, month] = value.split('-').map(Number);
  if (year < 2000 || year > 2100 || month < 1 || month > 12) return null;
  const days = new Date(year, month, 0).getDate();
  return Array.from({ length: days }, (_, i) => value + '-' + String(i + 1).padStart(2, '0')).filter((day) => day <= localDate());
}

async function buildMonthlyReport() {
  if (!state.user || state.busy || !state.studentsLoaded) return;
  const month = $('report-month').value;
  const dates = monthDates(month);
  if (!dates) { notify('مانگێکی دروست هەڵبژێرە.', true); return; }
  if (!dates.length) { notify('ئەم مانگە هێشتا دەستی پێنەکردووە.', true); return; }
  const missing = dates.filter((day) => !state.dayCache.has(day));
  if (missing.length && !window.confirm('بۆ ڕاپۆرتی مانگی «' + month + '»، تا ' + num(missing.length) + ' داواکاری خوێندنەوە لە Firebase دەکرێت. دەتەوێت بەردەوام بیت؟')) return;
  const activeUid = state.user.uid;
  setBusy(true);
  $('export-month').disabled = true;
  try {
    for (let offset = 0; offset < missing.length; offset += 3) {
      const chunk = missing.slice(offset, offset + 3);
      const snapshots = await Promise.all(chunk.map((date) =>
        getDocs(collection(state.db, 'schools', schoolId, 'days', date, 'attendance'))));
      if (state.user?.uid !== activeUid) return;
      for (let i = 0; i < chunk.length; i++) {
        state.dayCache.set(chunk[i], new Map(snapshots[i].docs.map((item) => [item.id, item.data().status])));
      }
      $('month-progress').textContent = 'خوێندنەوەی ڕۆژەکان: ' + num(Math.min(offset + chunk.length, missing.length)) + ' / ' + num(missing.length);
    }
    const rows = state.students.map((student) => {
      const counts = { present: 0, absent: 0, excused: 0 };
      for (const date of dates) {
        const value = state.dayCache.get(date)?.get(student.id);
        if (Object.hasOwn(counts, value)) counts[value]++;
      }
      return { ...student, ...counts };
    });
    state.monthlyReport = { month, rows };
    renderMonthlyReport();
    $('month-progress').textContent = 'ڕاپۆرتی ' + month + ' ئامادەیە. دۆخە نەنووسراوەکان نەژمێردراون. فلتەری پۆل/گەڕان کاریگەری لە ڕیزە پیشاندراوەکان دەکات.';
    notify('ڕاپۆرتی مانگانە دروست کرا.');
  } catch (error) {
    $('month-progress').textContent = 'ڕاپۆرتەکە تەواو نەبوو. دووبارە هەوڵ بدەرەوە.';
    notify(readableError(error), true);
  } finally {
    setBusy(false);
  }
}

function downloadMonthlyReport() {
  if (!state.user || state.busy || !state.monthlyReport) return;
  const selected = new Set(visibleStudents().map((student) => student.id));
  const rows = [
    ['مانگ', 'ناوی قوتابی', 'پۆلی ئێستا', 'ئامادە', 'نائامادە', 'مۆڵەت‌پێدراو'],
    ...state.monthlyReport.rows.filter((item) => selected.has(item.id)).map((item) =>
      [state.monthlyReport.month, item.name, item.className, item.present, item.absent, item.excused])
  ];
  const csv = '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'daragat-month-' + state.monthlyReport.month + '.csv';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// The calendar is editable by admins only; Firestore security rules enforce authorization.
async function loadCalendar() {
  state.calendar = { termStart: '', termEnd: '', workingSaturdays: [], holidays: [] };
  try {
    const snap = await getDoc(doc(state.db, 'schools', schoolId));
    if (snap.exists()) {
      const data = snap.data();
      const validDay = (item) => typeof item === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item);
      state.calendar.termStart = validDay(data.termStart) ? data.termStart : '';
      state.calendar.termEnd = validDay(data.termEnd) ? data.termEnd : '';
      state.calendar.workingSaturdays = Array.isArray(data.workingSaturdays) ? data.workingSaturdays.filter(validDay).slice(0, 400) : [];
      state.calendar.holidays = Array.isArray(data.holidays) ? data.holidays.filter(validDay).slice(0, 400) : [];
    }
  } catch {
    // The basic attendance flow remains usable when optional calendar settings are absent.
  }
  if (state.role === 'admin') {
    $('term-start').value = state.calendar.termStart;
    $('term-end').value = state.calendar.termEnd;
    $('working-saturdays').value = state.calendar.workingSaturdays.join('\n');
    $('holiday-dates').value = state.calendar.holidays.join('\n');
  }
  renderHolidayBadge();
}

function parseCalendarDates(value) {
  const dates = value.split(/[\s,،;]+/).map((date) => date.trim()).filter(Boolean);
  if (dates.length > 100 || dates.some((date) => !validIsoDate(date))) return null;
  return [...new Set(dates)].sort();
}

function validIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

async function saveCalendar(event) {
  event.preventDefault();
  if (state.busy || state.role !== 'admin' || !state.user) return;
  const termStart = $('term-start').value;
  const termEnd = $('term-end').value;
  const workingSaturdays = parseCalendarDates($('working-saturdays').value);
  const holidays = parseCalendarDates($('holiday-dates').value);
  if (!validIsoDate(termStart) || !validIsoDate(termEnd) || termStart > termEnd || !workingSaturdays || !holidays) {
    notify('بەرواری ساڵی خوێندن یان لیستی پشووەکان دروست نییە (زۆرترین ١٠٠ بەروار بۆ هەر لیستێک).', true);
    return;
  }
  if (workingSaturdays.some((date) => new Date(date + 'T12:00:00').getDay() !== 6)
      || workingSaturdays.some((date) => date < termStart || date > termEnd)
      || holidays.some((date) => date < termStart || date > termEnd)) {
    notify('شەممەکانی دەوام دەبێت شەممە بن و هەموو بەروارەکان لەناو ساڵی خوێندندا بن.', true);
    return;
  }
  setBusy(true);
  try {
    await setDoc(doc(state.db, 'schools', schoolId), { termStart, termEnd, workingSaturdays, holidays }, { merge: true });
    state.calendar = { termStart, termEnd, workingSaturdays, holidays };
    renderHolidayBadge();
    notify('ڕێکخستنی ساڵی خوێندن لە سێرڤەر پاشەکەوت کرا.');
  } catch (error) { notify(readableError(error), true); }
  finally { setBusy(false); }
}

function renderHolidayBadge() {
  const current = dateId();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(current)) return;
  const [year, month, day] = current.split('-').map(Number);
  const weekday = new Date(year, month - 1, day, 12).getDay();
  const c = state.calendar;
  const outside = (c.termStart && current < c.termStart) || (c.termEnd && current > c.termEnd);
  const off = c.holidays.includes(current) || weekday === 5 || (weekday === 6 && !c.workingSaturdays.includes(current));
  const marker = $('holiday-badge');
  marker.textContent = outside ? 'دەرەوەی ساڵی خوێندن' : off ? 'پشوو' : 'دەوام';
  marker.className = 'badge ' + (outside || off ? 'bad' : 'good');
  const term = c.termStart && c.termEnd ? ('ساڵی خوێندن: ' + c.termStart + ' تا ' + c.termEnd + '. ') : 'ساڵی خوێندن هێشتا بە شێوەی گشتی دیاری نەکراوە. ';
  $('calendar-info').textContent = term + 'هەینی و شەممە بە بنەڕەت پشوون؛ بەرواری دەوامی شەممە و پشووە زیادەکان لە بەشی ڕێکخستنی ساڵی خوێندن دیاری دەکرێن. نیشانەی پشوو تۆمارکردن قەدەغە ناکات.';
}

function weekDates(firstDay) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(firstDay)) return null;
  const [year, month, day] = firstDay.split('-').map(Number);
  const start = new Date(year, month - 1, day, 12);
  if (start.getFullYear() !== year || start.getMonth() !== month - 1 || start.getDate() !== day) return null;
  const pad = (value) => String(value).padStart(2, '0');
  return Array.from({ length: 7 }, (_, index) => {
    const current = new Date(year, month - 1, day + index, 12);
    return `${current.getFullYear()}-${pad(current.getMonth() + 1)}-${pad(current.getDate())}`;
  });
}

function invalidateParentReport() {
  state.parentReport = null;
  $('parent-preview').hidden = true;
  $('parent-progress').textContent = 'بۆ ڕاپۆرتی نوێ «دروستکردنی ڕاپۆرت» دابگرە.';
}

async function buildParentReport(event) {
  event.preventDefault();
  if (!state.user || state.busy || !state.studentsLoaded) return;
  const student = state.students.find((item) => item.id === $('parent-student').value);
  const dates = weekDates($('parent-week-start').value);
  if (!student || !dates) { notify('قوتابی و بەرواری دروست هەڵبژێرە.', true); return; }
  // Only fetch this student's document, rather than entire daily attendance lists.
  const needed = dates.filter((day) => day <= localDate() && !state.dayCache.has(day) && !state.parentDayCache.has(student.id + '|' + day));
  if (needed.length && !window.confirm('بۆ ڕاپۆرتی ٧ ڕۆژە تا ' + num(needed.length) + ' داواکاری لە Firebase دەکرێت. بەردەوام بیت؟')) return;
  const activeUid = state.user.uid;
  setBusy(true);
  try {
    for (let index = 0; index < needed.length; index += 3) {
      const chunk = needed.slice(index, index + 3);
      const snapshots = await Promise.all(chunk.map((day) => getDoc(doc(state.db, 'schools', schoolId, 'days', day, 'attendance', student.id))));
      if (state.user?.uid !== activeUid) return;
      chunk.forEach((day, pos) => state.parentDayCache.set(student.id + '|' + day, snapshots[pos].exists() ? snapshots[pos].data().status : null));
    }
    const rows = dates.map((day) => ({
      date: day,
      label: day > localDate() ? 'ڕۆژی داهاتوو' : statuses[state.dayCache.has(day) ? state.dayCache.get(day).get(student.id) : state.parentDayCache.get(student.id + '|' + day)] || 'دیاری نەکراوە'
    }));
    state.parentReport = { student: { ...student }, dates, rows };
    $('parent-report-heading').textContent = student.name + ' — ' + student.className;
    $('parent-report-rows').replaceChildren();
    const tally = { present: 0, absent: 0, excused: 0 };
    for (const row of rows) {
      const tr = document.createElement('tr');
      for (const value of [row.date, row.label]) {
        const td = document.createElement('td');
        td.textContent = value;
        tr.append(td);
      }
      $('parent-report-rows').append(tr);
      const matching = Object.keys(statuses).find((status) => statuses[status] === row.label);
      if (matching) tally[matching]++;
    }
    $('parent-report-total').textContent = 'ئامادە: ' + num(tally.present) + ' | نائامادە: ' + num(tally.absent) + ' | مۆڵەت‌پێدراو: ' + num(tally.excused);
    $('parent-preview').hidden = false;
    $('parent-progress').textContent = 'ڕاپۆرتەکە تەنها بۆ ئەم قوتابییە لە پەڕەکەتدا دروست کرا؛ کەی و لەگەڵ کێ هاوبەشی دەکەیت بە دەستی خۆتە.';
    notify('ڕاپۆرتی تایبەتی قوتابی ئامادەیە.');
  } catch (error) {
    notify(readableError(error), true);
  } finally {
    setBusy(false);
  }
}

function downloadParentReport() {
  if (!state.user || !state.parentReport || state.busy) return;
  const report = state.parentReport;
  const rows = [['ناوی قوتابی', 'پۆلی ئێستا', 'بەروار', 'دۆخ'], ...report.rows.map((row) =>
    [report.student.name, report.student.className, row.date, row.label])];
  const csv = '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'daragat-parent-' + report.dates[0] + '.csv';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function printParentReport() {
  if (!state.user || !state.parentReport) return;
  document.body.classList.add('print-parent');
  const cleanup = () => document.body.classList.remove('print-parent');
  window.addEventListener('afterprint', cleanup, { once: true });
  window.print();
}

async function handleAuth(user) {
  state.user = null;
  state.role = '';
  state.students = [];
  state.studentsLoaded = false;
  state.attendance = new Map();
  state.dayCache = new Map();
  state.monthlyReport = null;
  state.parentReport = null;
  state.parentDayCache = new Map();
  state.calendar = { termStart: '', termEnd: '', workingSaturdays: [], holidays: [] };
  $('parent-preview').hidden = true;
  $('month-rows').replaceChildren();
  $('month-progress').textContent = 'مانگ هەڵبژێرە و ڕاپۆرت دروست بکە.';
  $('export-month').disabled = true;
  $('member-rows').replaceChildren();
  $('logout').hidden = !user;
  if (!user) { show('login-panel'); badge('چوونەژوورەوە پێویستە'); return; }
  try {
    const role = await authorize(user);
    state.user = user;
    state.role = role;
    $('student-entry').hidden = role !== 'admin';
    $('class-management').hidden = role !== 'admin';
    $('members-panel').hidden = role !== 'admin';
    $('calendar-settings').hidden = role !== 'admin';
    $('manage-heading').hidden = role !== 'admin';
    $('user-summary').textContent = `${user.email || 'هەژمار'} • ${role === 'admin' ? 'بەڕێوەبەر' : 'مامۆستا'} • ${schoolId}`;
    show('dashboard');
    await loadCalendar();
    await loadDay();
  } catch (error) {
    notify(error.message === 'membership-missing' ? 'هەژمارەکەت مۆڵەتی ئەم قوتابخانەیەی نییە. لەگەڵ بەڕێوەبەر قسە بکە.' : readableError(error), true);
    await signOut(state.auth);
  }
}

function start() {
  $('work-date').value = localDate();
  $('report-month').value = localDate().slice(0, 7);
  $('parent-week-start').value = localDate();
  $('login-form').addEventListener('submit', login);
  $('student-form').addEventListener('submit', addStudent);
  $('calendar-form').addEventListener('submit', saveCalendar);
  $('work-date').addEventListener('change', () => loadDay());
  $('previous-day').addEventListener('click', () => changeDate(-1));
  $('next-day').addEventListener('click', () => changeDate(1));
  $('today-button').addEventListener('click', () => { $('work-date').value = localDate(); loadDay(); });
  $('refresh').addEventListener('click', () => loadDay({ refreshStudents: true, forceDay: true }));
  $('class-rename-form').addEventListener('submit', renameClass);
  $('load-members').addEventListener('click', loadMembers);
  $('build-month').addEventListener('click', buildMonthlyReport);
  $('export-month').addEventListener('click', downloadMonthlyReport);
  $('report-month').addEventListener('change', invalidateMonthlyReport);
  $('parent-report-form').addEventListener('submit', buildParentReport);
  $('parent-student').addEventListener('change', invalidateParentReport);
  $('parent-week-start').addEventListener('change', invalidateParentReport);
  $('export-parent-report').addEventListener('click', downloadParentReport);
  $('print-parent-report').addEventListener('click', printParentReport);
  $('open-display').addEventListener('click', () => { window.open(new URL('./display.html', window.location.href).href, '_blank', 'noopener,noreferrer'); });
  $('copy-display-link').addEventListener('click', async () => {
    const url = new URL('./display.html', window.location.href).href;
    try { await navigator.clipboard.writeText(url); notify('لینکی شاشە کۆپی کرا.'); }
    catch { window.prompt('لینکەکە کۆپی بکە:', url); }
  });
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
