import { auth, db, functions, ensureAppCheck } from './firebase.js?v=20261116-6';
import { signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js';
import { collection, doc, onSnapshot, orderBy, query } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-functions.js';
import { qs, qsa, show, escapeHtml, friendlyError, showToast, operationId, formatDateTime, toDateTimeLocal, setBusy } from './shared.js';

const getStaffSession = httpsCallable(functions, 'getStaffSession');
const updateSettings = httpsCallable(functions, 'updateSettings');
const manageBreak = httpsCallable(functions, 'manageBreak');
const createStaffUser = httpsCallable(functions, 'createStaffUser');
const updateStaffProfile = httpsCallable(functions, 'updateStaffProfile');
const exportCsv = httpsCallable(functions, 'exportCsv');
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

let settings = {};
let staff = [];
let unsubscribers = [];

async function loadSettingsPage() {
  try {
    const response = await getStaffSession();
    const profile = response.data.profile;
    if (profile.role !== 'admin') throw new Error('1급 관리자만 설정 페이지에 접근할 수 있습니다.');
    qs('#settings-role-label').textContent = profile.absoluteAdmin ? '절대 관리자 · 1급' : '1급 관리자';
    show(qs('#settings-login'), false); show(qs('#settings-view'), true);
    unsubscribers.forEach((unsubscribe) => unsubscribe());
    unsubscribers = [
      onSnapshot(doc(db, 'settings', 'event'), (snapshot) => { settings = snapshot.data() || {}; renderSettings(); }),
      onSnapshot(query(collection(db, 'staffProfiles'), orderBy('name')), (snapshot) => { staff = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); renderStaff(); })
    ];
  } catch (error) {
    qs('#settings-login-error').textContent = friendlyError(error); show(qs('#settings-login-error'), true);
    await signOut(auth);
  }
}

function renderSettings() {
  const form = qs('#event-settings-form');
  for (const name of ['eventName', 'serviceName', 'notice', 'noShowGraceSeconds', 'noShowListSeconds', 'maxHoldCount']) form.elements[name].value = settings[name] ?? '';
  form.elements.reservationStartAt.value = toDateTimeLocal(settings.reservationStartAt);
  form.elements.reservationEndAt.value = toDateTimeLocal(settings.reservationEndAt);
  form.elements.acceptingReservations.checked = settings.acceptingReservations === true;
  show(qs('#settings-break-active'), Boolean(settings.breakActive));
  show(qs('#settings-break-form'), !settings.breakActive);
  if (settings.breakActive) qs('#settings-break-text').textContent = `${settings.breakReason} · 예정 종료 ${formatDateTime(settings.breakPlannedEndAt)}`;
}

function renderStaff() {
  qs('#settings-staff-list').innerHTML = staff.map((item) => {
    const absolute = item.absoluteAdmin === true || String(item.email || '').toLowerCase() === 'github.jwastro09@gmail.com';
    const role = absolute ? '절대 관리자' : item.role === 'admin' ? '1급 관리자' : '2급 관리자';
    return `<div class="data-row"><div><strong>${escapeHtml(item.name)}</strong><span>${role} · ${item.active ? '사용 중' : '비활성'}</span></div><div class="data-row__actions">${absolute ? '<span class="state-pill">보호됨</span>' : `<button data-settings-role="${item.id}" data-next-role="${item.role === 'admin' ? 'staff' : 'admin'}">${item.role === 'admin' ? '2급으로' : '1급으로'}</button><button data-settings-active="${item.id}" data-next-active="${!item.active}">${item.active ? '비활성화' : '활성화'}</button>`}</div></div>`;
  }).join('') || '<div class="empty-state">관리자 계정이 없습니다.</div>';
}

qsa('[data-settings-tab]').forEach((button) => button.addEventListener('click', () => {
  qsa('[data-settings-tab]').forEach((item) => item.classList.toggle('active', item === button));
  qsa('[data-settings-panel]').forEach((panel) => show(panel, panel.dataset.settingsPanel === button.dataset.settingsTab));
}));

qs('#event-settings-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const button = event.submitter; const form = new FormData(event.currentTarget); setBusy(button, true);
  try {
    await updateSettings({ eventName: form.get('eventName'), serviceName: form.get('serviceName'), notice: form.get('notice'), reservationStartAt: form.get('reservationStartAt'), reservationEndAt: form.get('reservationEndAt'), noShowGraceSeconds: Number(form.get('noShowGraceSeconds')), noShowListSeconds: Number(form.get('noShowListSeconds')), maxHoldCount: Number(form.get('maxHoldCount')), acceptingReservations: event.currentTarget.elements.acceptingReservations.checked, operationId: operationId() });
    showToast('설정을 저장했습니다.');
  } catch (error) { showToast(friendlyError(error), 5000); } finally { setBusy(button, false); }
});

qs('#settings-break-minutes').addEventListener('input', (event) => { qs('#settings-break-output').textContent = `${event.target.value}분`; });
qsa('.quick-reasons button').forEach((button) => button.addEventListener('click', () => { qs('#settings-break-reason').value = button.textContent; }));
qs('#settings-break-form').addEventListener('submit', async (event) => { event.preventDefault(); try { await manageBreak({ action: 'start', reason: qs('#settings-break-reason').value.trim(), minutes: Number(qs('#settings-break-minutes').value), operationId: operationId() }); showToast('휴식시간을 시작했습니다.'); } catch (error) { showToast(friendlyError(error), 5000); } });
qs('#settings-extend-break').addEventListener('click', async () => { try { await manageBreak({ action: 'extend', minutes: 5, operationId: operationId() }); showToast('5분 연장했습니다.'); } catch (error) { showToast(friendlyError(error), 5000); } });
qs('#settings-end-break').addEventListener('click', async () => { try { await manageBreak({ action: 'end', operationId: operationId() }); showToast('휴식시간을 끝냈습니다.'); } catch (error) { showToast(friendlyError(error), 5000); } });

qs('#settings-staff-create').addEventListener('submit', async (event) => { event.preventDefault(); const button = event.submitter; setBusy(button, true); try { await createStaffUser({ ...Object.fromEntries(new FormData(event.currentTarget)), operationId: operationId() }); event.currentTarget.reset(); showToast('관리자 계정을 만들었습니다.'); } catch (error) { showToast(friendlyError(error), 5000); } finally { setBusy(button, false); } });
qs('#settings-staff-list').addEventListener('click', async (event) => {
  const roleButton = event.target.closest('[data-settings-role]'); const activeButton = event.target.closest('[data-settings-active]');
  try {
    if (roleButton) await updateStaffProfile({ uid: roleButton.dataset.settingsRole, role: roleButton.dataset.nextRole, operationId: operationId() });
    if (activeButton) await updateStaffProfile({ uid: activeButton.dataset.settingsActive, active: activeButton.dataset.nextActive === 'true', operationId: operationId() });
    if (roleButton || activeButton) showToast('관리자 등급을 변경했습니다.');
  } catch (error) { showToast(friendlyError(error), 5000); }
});

qsa('[data-settings-export]').forEach((button) => button.addEventListener('click', async () => {
  setBusy(button, true, '생성 중…');
  try { const response = await exportCsv({ type: button.dataset.settingsExport }); const blob = new Blob(['\uFEFF', response.data.content], { type: 'text/csv;charset=utf-8' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = response.data.filename; link.click(); URL.revokeObjectURL(url); showToast(`${response.data.filename}을 내려받았습니다.`); }
  catch (error) { showToast(friendlyError(error), 5000); } finally { setBusy(button, false); }
}));

qs('#settings-login-form').addEventListener('submit', async (event) => { event.preventDefault(); show(qs('#settings-login-error'), false); try { await ensureAppCheck(true); await signInWithEmailAndPassword(auth, qs('#settings-email').value.trim(), qs('#settings-password').value); } catch (error) { qs('#settings-login-error').textContent = friendlyError(error); show(qs('#settings-login-error'), true); } });
qs('#settings-google-login').addEventListener('click', async () => { show(qs('#settings-login-error'), false); setBusy(qs('#settings-google-login'), true, 'Google 로그인 중…'); try { await ensureAppCheck(true); await signInWithPopup(auth, googleProvider); } catch (error) { qs('#settings-login-error').textContent = friendlyError(error); show(qs('#settings-login-error'), true); } finally { setBusy(qs('#settings-google-login'), false); } });
qs('#settings-logout').addEventListener('click', () => signOut(auth));
onAuthStateChanged(auth, async (user) => { unsubscribers.forEach((unsubscribe) => unsubscribe()); unsubscribers = []; if (user && !user.isAnonymous) { try { await ensureAppCheck(); await loadSettingsPage(); } catch (error) { qs('#settings-login-error').textContent = friendlyError(error); show(qs('#settings-login-error'), true); } } else { show(qs('#settings-login'), true); show(qs('#settings-view'), false); } });
