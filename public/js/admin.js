import { auth, db, functions } from './firebase-config.js';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js';
import { collection, doc, onSnapshot, orderBy, query } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-functions.js';
import { qs, qsa, show, escapeHtml, friendlyError, showToast, operationId, statusText, formatDateTime, toDateTimeLocal, setBusy } from './shared.js';

const getStaffSession = httpsCallable(functions, 'getStaffSession');
const updateSettings = httpsCallable(functions, 'updateSettings');
const manageBreak = httpsCallable(functions, 'manageBreak');
const createStaffUser = httpsCallable(functions, 'createStaffUser');
const updateStaffProfile = httpsCallable(functions, 'updateStaffProfile');
const exportCsv = httpsCallable(functions, 'exportCsv');

let settings = {};
let reservations = [];
let staff = [];
let unsubscribers = [];

async function loadAdmin() {
  try {
    const response = await getStaffSession();
    if (response.data.profile.role !== 'admin') throw new Error('1급 관리자만 접근할 수 있습니다.');
    show(qs('#admin-login'), false); show(qs('#admin-view'), true); subscribeData();
  } catch (error) {
    await signOut(auth); qs('#admin-login-error').textContent = friendlyError(error); show(qs('#admin-login-error'), true);
  }
}

function subscribeData() {
  unsubscribers.forEach((unsubscribe) => unsubscribe());
  unsubscribers = [
    onSnapshot(doc(db, 'settings', 'event'), (snapshot) => { settings = snapshot.data() || {}; renderSettings(); }),
    onSnapshot(query(collection(db, 'reservations'), orderBy('createdAt', 'desc')), (snapshot) => { reservations = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); renderReservations(); renderStats(); }),
    onSnapshot(query(collection(db, 'staffProfiles'), orderBy('name')), (snapshot) => { staff = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); renderStaff(); })
  ];
}

function renderStats() {
  const count = (statuses) => reservations.filter((item) => statuses.includes(item.currentStatus)).length;
  qs('#stat-waiting').textContent = count(['waiting', 'called', 'held']);
  qs('#stat-picked').textContent = count(['picked_up']);
  qs('#stat-missed').textContent = count(['no_show', 'expired']);
  qs('#stat-cancelled').textContent = count(['cancelled']);
}

function renderReservations() {
  const keyword = qs('#reservation-search').value.trim().toLowerCase();
  const filtered = reservations.filter((item) => [item.reservationNo, item.studentIdNormalized, item.studentName].some((value) => String(value || '').toLowerCase().includes(keyword)));
  qs('#admin-reservations').innerHTML = filtered.slice(0, 100).map((item) => `<div class="data-row"><div><strong>${escapeHtml(item.reservationNo)} · ${escapeHtml(item.studentName)}</strong><span>${escapeHtml(item.studentIdNormalized)} · ${statusText(item.currentStatus)} · ${formatDateTime(item.createdAt)}</span></div></div>`).join('') || '<div class="empty-state">검색 결과가 없습니다.</div>';
}

function renderSettings() {
  const form = qs('#settings-form');
  for (const name of ['eventName', 'serviceName', 'notice', 'noShowGraceSeconds', 'noShowListSeconds', 'maxHoldCount']) if (form.elements[name]) form.elements[name].value = settings[name] ?? '';
  form.elements.reservationStartAt.value = toDateTimeLocal(settings.reservationStartAt);
  form.elements.reservationEndAt.value = toDateTimeLocal(settings.reservationEndAt);
  form.elements.acceptingReservations.checked = settings.acceptingReservations === true;
  show(qs('#break-active-panel'), Boolean(settings.breakActive));
  show(qs('#break-form'), !settings.breakActive);
  if (settings.breakActive) qs('#break-active-text').textContent = `${settings.breakReason} · 예정 종료 ${formatDateTime(settings.breakPlannedEndAt)}`;
}

function renderStaff() {
  qs('#staff-list').innerHTML = staff.map((item) => `<div class="data-row"><div><strong>${escapeHtml(item.name)}</strong><span>${item.role === 'admin' ? '1급 관리자' : '2급 직원'} · ${item.active ? '사용 중' : '비활성'}</span></div><div class="data-row__actions"><button data-staff-role="${item.id}" data-next-role="${item.role === 'admin' ? 'staff' : 'admin'}">${item.role === 'admin' ? '2급으로' : '1급으로'}</button><button data-staff-active="${item.id}" data-next-active="${!item.active}">${item.active ? '비활성화' : '활성화'}</button></div></div>`).join('') || '<div class="empty-state">직원이 없습니다.</div>';
}

qsa('[data-tab]').forEach((button) => button.addEventListener('click', () => {
  qsa('[data-tab]').forEach((item) => item.classList.toggle('active', item === button));
  qsa('[data-panel]').forEach((panel) => show(panel, panel.dataset.panel === button.dataset.tab));
}));
qs('#reservation-search').addEventListener('input', renderReservations);

qs('#settings-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const button = event.submitter; setBusy(button, true);
  const form = new FormData(event.currentTarget);
  try {
    await updateSettings({
      eventName: form.get('eventName'), serviceName: form.get('serviceName'), notice: form.get('notice'),
      reservationStartAt: form.get('reservationStartAt'), reservationEndAt: form.get('reservationEndAt'),
      noShowGraceSeconds: Number(form.get('noShowGraceSeconds')), noShowListSeconds: Number(form.get('noShowListSeconds')),
      maxHoldCount: Number(form.get('maxHoldCount')), acceptingReservations: event.currentTarget.elements.acceptingReservations.checked,
      operationId: operationId()
    }); showToast('설정을 저장했습니다.');
  } catch (error) { showToast(friendlyError(error), 5000); } finally { setBusy(button, false); }
});

qs('#break-minutes').addEventListener('input', (event) => { qs('#break-minutes-output').textContent = `${event.target.value}분`; });
qsa('.quick-reasons button').forEach((button) => button.addEventListener('click', () => { qs('#break-reason').value = button.textContent; }));
qs('#break-form').addEventListener('submit', async (event) => {
  event.preventDefault(); try { await manageBreak({ action: 'start', reason: qs('#break-reason').value.trim(), minutes: Number(qs('#break-minutes').value), operationId: operationId() }); showToast('쉬는 시간을 시작했습니다.'); } catch (error) { showToast(friendlyError(error), 5000); }
});
qs('#extend-break').addEventListener('click', async () => { try { await manageBreak({ action: 'extend', minutes: 5, operationId: operationId() }); showToast('5분 연장했습니다.'); } catch (error) { showToast(friendlyError(error)); } });
qs('#end-break').addEventListener('click', async () => { try { await manageBreak({ action: 'end', operationId: operationId() }); showToast('쉬는 시간을 끝냈습니다.'); } catch (error) { showToast(friendlyError(error)); } });

qs('#staff-create-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const button = event.submitter; setBusy(button, true);
  const form = Object.fromEntries(new FormData(event.currentTarget));
  try { await createStaffUser({ ...form, operationId: operationId() }); event.currentTarget.reset(); showToast('직원 계정을 만들었습니다.'); }
  catch (error) { showToast(friendlyError(error), 5000); } finally { setBusy(button, false); }
});

qs('#staff-list').addEventListener('click', async (event) => {
  const roleButton = event.target.closest('[data-staff-role]');
  const activeButton = event.target.closest('[data-staff-active]');
  try {
    if (roleButton) await updateStaffProfile({ uid: roleButton.dataset.staffRole, role: roleButton.dataset.nextRole, operationId: operationId() });
    if (activeButton) await updateStaffProfile({ uid: activeButton.dataset.staffActive, active: activeButton.dataset.nextActive === 'true', operationId: operationId() });
    if (roleButton || activeButton) showToast('직원 정보를 변경했습니다.');
  } catch (error) { showToast(friendlyError(error), 5000); }
});

qsa('[data-export]').forEach((button) => button.addEventListener('click', async () => {
  setBusy(button, true, '생성 중…');
  try {
    const response = await exportCsv({ type: button.dataset.export });
    const blob = new Blob(['\uFEFF', response.data.content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = response.data.filename; link.click(); URL.revokeObjectURL(url);
    showToast(`${response.data.filename}을 내려받았습니다.`);
  } catch (error) { showToast(friendlyError(error), 5000); } finally { setBusy(button, false); }
}));

qs('#admin-login-form').addEventListener('submit', async (event) => {
  event.preventDefault(); show(qs('#admin-login-error'), false);
  try { await signInWithEmailAndPassword(auth, qs('#admin-email').value.trim(), qs('#admin-password').value); }
  catch (error) { qs('#admin-login-error').textContent = friendlyError(error); show(qs('#admin-login-error'), true); }
});
qs('#admin-logout').addEventListener('click', () => signOut(auth));
onAuthStateChanged(auth, (user) => {
  unsubscribers.forEach((unsubscribe) => unsubscribe()); unsubscribers = [];
  if (user && !user.isAnonymous) loadAdmin();
  else { show(qs('#admin-login'), true); show(qs('#admin-view'), false); }
});

