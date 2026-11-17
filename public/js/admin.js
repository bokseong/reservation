import { functions, ensureAppCheck } from './firebase.js?v=20261117-1';
import { auth, db } from './firebase-staff.js?v=20261117-1';
import { signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js';
import { collection, doc, onSnapshot, orderBy, query, where, limit } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-functions.js';
import { qs, qsa, show, escapeHtml, friendlyError, showToast, operationId, statusText, formatDateTime, toDateTimeLocal, setBusy } from './shared.js';
import { availableMenuItems } from './menu.js';

const getStaffSession = httpsCallable(functions, 'getStaffSession');
const updateSettings = httpsCallable(functions, 'updateSettings');
const manageBreak = httpsCallable(functions, 'manageBreak');
const createStaffUser = httpsCallable(functions, 'createStaffUser');
const updateStaffProfile = httpsCallable(functions, 'updateStaffProfile');
const exportCsv = httpsCallable(functions, 'exportCsv');
const staffAction = httpsCallable(functions, 'staffAction');
const undoReservationEvent = httpsCallable(functions, 'undoReservationEvent');
const setSoldOut = httpsCallable(functions, 'setSoldOut');

let settings = {};
let profile = null;
let reservations = [];
let staff = [];
let events = [];
let unsubscribers = [];
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

async function loadAdmin() {
  try {
    const response = await getStaffSession();
    profile = response.data.profile;
    const isAdmin1 = profile.role === 'admin';
    qs('#admin-role-label').textContent = isAdmin1 ? (profile.absoluteAdmin ? '절대 관리자 · 1급' : '1급 관리자') : '2급 관리자';
    const assignedNames = availableMenuItems().filter((menu) => profile.assignedMenuIds?.includes(menu.id)).map((menu) => menu.name);
    qs('#admin-scope-label').textContent = isAdmin1 ? '전체 메뉴 예약을 관리합니다.' : assignedNames.length ? `전담 메뉴: ${assignedNames.join(', ')} · 해당 메뉴 예약만 표시됩니다.` : '전담 메뉴가 배정되지 않아 예약이 표시되지 않습니다.';
    show(qs('#settings-link'), isAdmin1);
    qsa('.admin-only-control').forEach((element) => show(element, isAdmin1));
    qsa('[data-admin-action]').forEach((button) => show(button, isAdmin1 || ['cooking_start', 'cooking_complete'].includes(button.dataset.adminAction)));
    ['#admin-history-button', '#admin-no-show-button', '#admin-sold-out-button'].forEach((selector) => show(qs(selector), isAdmin1));
    show(qs('#admin-login'), false); show(qs('#admin-view'), true); subscribeData();
  } catch (error) {
    await signOut(auth); qs('#admin-login-error').textContent = friendlyError(error); show(qs('#admin-login-error'), true);
  }
}

function subscribeData() {
  unsubscribers.forEach((unsubscribe) => unsubscribe());
  unsubscribers = [
    onSnapshot(doc(db, 'settings', 'event'), (snapshot) => { settings = snapshot.data() || {}; renderSettings(); renderOperations(); }),
    subscribeReservations()
  ];
  if (profile?.role === 'admin') {
    unsubscribers.push(onSnapshot(query(collection(db, 'reservationEvents'), orderBy('occurredAt', 'desc'), limit(50)), (snapshot) => { events = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); renderOperations(); }));
    unsubscribers.push(onSnapshot(query(collection(db, 'staffProfiles'), orderBy('name')), (snapshot) => { staff = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); renderStaff(); }));
  }
}

function subscribeReservations() {
  const assignedMenuIds = Array.isArray(profile?.assignedMenuIds) ? profile.assignedMenuIds : [];
  if (profile?.role !== 'admin' && assignedMenuIds.length === 0) {
    reservations = [];
    renderReservations(); renderStats(); renderOperations();
    return () => {};
  }
  const reservationsQuery = profile?.role === 'admin'
    ? query(collection(db, 'reservations'), orderBy('createdAt', 'desc'))
    : query(collection(db, 'reservations'), where('menuId', 'in', assignedMenuIds));
  return onSnapshot(reservationsQuery, (snapshot) => {
    reservations = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).sort((left, right) => {
      const leftTime = left.createdAt?.toMillis?.() || 0;
      const rightTime = right.createdAt?.toMillis?.() || 0;
      return rightTime - leftTime;
    });
    renderReservations(); renderStats(); renderOperations();
  }, (error) => showToast(friendlyError(error), 6000));
}

function renderStats() {
  const count = (statuses) => reservations.filter((item) => statuses.includes(item.currentStatus)).length;
  qs('#stat-waiting').textContent = count(['waiting', 'called', 'held', 'preparing', 'ready']);
  qs('#stat-picked').textContent = count(['picked_up']);
  qs('#stat-missed').textContent = count(['no_show', 'expired']);
  qs('#stat-cancelled').textContent = count(['cancelled']);
}

function activeQueue() {
  return reservations
    .filter((item) => ['waiting', 'called', 'held', 'preparing', 'ready'].includes(item.currentStatus))
    .sort((a, b) => Number(a.queueOrder || 0) - Number(b.queueOrder || 0));
}

function renderOperations() {
  const queue = activeQueue();
  const current = queue[0];
  const accepting = settings.acceptingReservations === true;
  qs('#admin-accepting-label').textContent = accepting ? '예약 접수 중' : '예약 접수 중지됨';
  qs('#admin-accepting-help').textContent = accepting ? '고객 화면에서 새 예약을 신청할 수 있습니다.' : '기존 예약 조회와 대기열 처리는 계속됩니다.';
  qs('#open-reservations').disabled = accepting;
  qs('#close-reservations').disabled = !accepting;
  qs('#admin-queue-count').textContent = queue.length;
  qs('#admin-no-show-count').textContent = events.filter((item) => item.type === 'no_show').length;

  const breakNotice = qs('#admin-break-notice');
  breakNotice.textContent = settings.breakActive ? `쉬는 중 · ${settings.breakReason || ''} · 예정 종료 ${formatDateTime(settings.breakPlannedEndAt)}` : '';
  show(breakNotice, Boolean(settings.breakActive));

  const currentLabels = { preparing: '조리 중', ready: '조리 완료 · 수령 대기', called: '지금 차례', waiting: '지금 차례', held: '보류 후 차례' };
  qs('#admin-current-label').textContent = current ? (currentLabels[current.currentStatus] || statusText(current.currentStatus)) : '지금 차례';
  qs('#admin-current-reservation').textContent = current?.reservationNo || '대기 팀 없음';
  const completion = current?.currentStatus === 'preparing' && Number(current.requiredCookUids?.length || 0) > 0 ? ` · 조리 확인 ${current.completedCookUids?.length || 0}/${current.requiredCookUids.length}` : '';
  qs('#admin-current-student').textContent = current ? `${current.studentIdNormalized} ${current.studentName} · ${current.menuName || settings.serviceName || ''}${completion}` : '';

  qsa('[data-admin-action]').forEach((button) => {
    const action = button.dataset.adminAction;
    const status = current?.currentStatus;
    const enabled = Boolean(current) && (
      (action === 'cooking_start' && (status === 'called' || (status === 'preparing' && !(current.requiredCookUids || []).length))) ||
      (action === 'cooking_complete' && status === 'preparing' && !(current.completedCookUids || []).includes(profile?.uid)) ||
      (action === 'pickup' && ['called', 'preparing', 'ready'].includes(status)) ||
      (['no_show', 'hold'].includes(action) && status === 'called') ||
      action === 'cancel'
    ) && !(action === 'hold' && (queue.length <= 1 || Number(current?.holdCount || 0) >= Number(settings.maxHoldCount || 2)));
    button.disabled = !enabled;
    button.dataset.reservationId = current?.id || '';
  });

  qs('#admin-queue-list').innerHTML = queue.length ? queue.map((item, index) => `
    <div class="queue-item ${index === 0 ? 'queue-item--called' : ''}">
      <div><strong>${index + 1}. ${escapeHtml(item.reservationNo)} · ${escapeHtml(item.studentName)}</strong><span>${escapeHtml(item.studentIdNormalized)} · ${escapeHtml(item.menuName || settings.serviceName || '')} · ${statusText(item.currentStatus)} · 보류 ${item.holdCount || 0}회</span></div>
      <span>${index === 0 ? statusText(item.currentStatus) : `앞 ${index}팀`}</span>
    </div>`).join('') : '<div class="empty-state">현재 대기 중인 팀이 없습니다.</div>';
}

function renderReservations() {
  const keyword = qs('#reservation-search').value.trim().toLowerCase();
  const menu = qs('#reservation-menu-filter').value;
  const filtered = reservations.filter((item) => (!menu || item.menuName === menu) && [item.reservationNo, item.studentIdNormalized, item.studentName, item.menuName].some((value) => String(value || '').toLowerCase().includes(keyword)));
  const visible = filtered.slice(0, 100);
  const scope = profile?.role === 'admin' ? '전체 메뉴' : '전담 메뉴만';
  qs('#reservation-result-count').textContent = filtered.length > 100 ? `${scope} · 총 ${filtered.length}건 중 최근 100건을 표시합니다.` : `${scope} · 총 ${filtered.length}건`;
  qs('#admin-reservations').innerHTML = visible.map((item) => `<article class="data-row reservation-record">
    <div><strong>${escapeHtml(item.reservationNo)}</strong><span>학번: ${escapeHtml(item.studentIdNormalized)}</span><span>이름: ${escapeHtml(item.studentName)}</span></div>
    <div class="reservation-record__details"><span>주문 음식: ${escapeHtml(item.menuName || settings.serviceName || '')}</span><span>주문 가격: ${Number.isFinite(Number(item.menuPrice)) ? `${Number(item.menuPrice).toLocaleString('ko-KR')}원` : '가격 정보 없음'}</span><span>${statusText(item.currentStatus)} · ${formatDateTime(item.createdAt)}</span></div>
  </article>`).join('') || '<div class="empty-state">검색 결과가 없습니다.</div>';
}

function renderSettings() {
  const form = qs('#settings-form');
  for (const name of ['eventName', 'serviceName', 'notice', 'noShowGraceSeconds', 'noShowListSeconds', 'maxHoldCount']) if (form.elements[name]) form.elements[name].value = settings[name] ?? '';
  const currentFilter = qs('#reservation-menu-filter').value;
  const menus = availableMenuItems().map((menu) => menu.name);
  qs('#reservation-menu-filter').innerHTML = '<option value="">전체 메뉴</option>' + menus.map((menu) => `<option value="${escapeHtml(menu)}">${escapeHtml(menu)}</option>`).join('');
  if (menus.includes(currentFilter)) qs('#reservation-menu-filter').value = currentFilter;
  form.elements.reservationStartAt.value = toDateTimeLocal(settings.reservationStartAt);
  form.elements.reservationEndAt.value = toDateTimeLocal(settings.reservationEndAt);
  form.elements.acceptingReservations.checked = settings.acceptingReservations === true;
  show(qs('#break-active-panel'), false);
  show(qs('#break-form'), false);
}

function renderStaff() {
  qs('#staff-list').innerHTML = staff.map((item) => {
    const absolute = item.absoluteAdmin === true || String(item.email || '').toLowerCase() === 'github.jwastro09@gmail.com';
    return `<div class="data-row"><div><strong>${escapeHtml(item.name)}</strong><span>${absolute ? '절대 관리자' : item.role === 'admin' ? '1급 관리자' : '2급 관리자'} · ${item.active ? '사용 중' : '비활성'}</span></div><div class="data-row__actions">${absolute ? '<span class="state-pill">보호됨</span>' : `<button data-staff-role="${item.id}" data-next-role="${item.role === 'admin' ? 'staff' : 'admin'}">${item.role === 'admin' ? '2급으로' : '1급으로'}</button><button data-staff-active="${item.id}" data-next-active="${!item.active}">${item.active ? '비활성화' : '활성화'}</button>`}</div></div>`;
  }).join('') || '<div class="empty-state">직원이 없습니다.</div>';
}

qsa('[data-tab]').forEach((button) => button.addEventListener('click', () => {
  qsa('[data-tab]').forEach((item) => item.classList.toggle('active', item === button));
  qsa('[data-panel]').forEach((panel) => show(panel, panel.dataset.panel === button.dataset.tab));
}));
qs('#reservation-search').addEventListener('input', renderReservations);
qs('#reservation-menu-filter').addEventListener('change', renderReservations);

qsa('[data-admin-action]').forEach((button) => button.addEventListener('click', async () => {
  if (!button.dataset.reservationId) return;
  const labels = { cooking_start: '조리 시작', cooking_complete: '조리 완료', pickup: '수령 완료', no_show: '미수령', hold: '보류', cancel: '취소' };
  if (!confirm(`${labels[button.dataset.adminAction]} 처리할까요?`)) return;
  setBusy(button, true);
  try {
    const response = await staffAction({ reservationId: button.dataset.reservationId, action: button.dataset.adminAction, operationId: operationId() });
    showToast(button.dataset.adminAction === 'cooking_complete' && !response.data.allCompleted ? `조리 완료를 확인했습니다. 남은 담당자 ${response.data.remainingCount}명` : `${labels[button.dataset.adminAction]} 처리했습니다.`);
  } catch (error) { showToast(friendlyError(error), 5000); }
  finally { setBusy(button, false); }
}));

qs('#open-reservations').addEventListener('click', async () => {
  try { await setSoldOut({ mode: 'reopen', operationId: operationId() }); showToast('예약 접수를 시작했습니다.'); }
  catch (error) { showToast(friendlyError(error), 5000); }
});
qs('#close-reservations').addEventListener('click', async () => {
  if (!confirm('새 예약 접수를 중지할까요? 기존 대기 팀은 유지됩니다.')) return;
  try { await setSoldOut({ mode: 'stop_new', operationId: operationId() }); showToast('새 예약 접수를 중지했습니다.'); }
  catch (error) { showToast(friendlyError(error), 5000); }
});

qs('#admin-history-button').addEventListener('click', () => {
  qs('#admin-dialog-title').textContent = '최근 처리 기록';
  qs('#admin-dialog-content').innerHTML = events.length ? events.map((item) => `
    <div class="data-row"><div><strong>${escapeHtml(item.eventNo)} · ${escapeHtml(item.reservationNo)} · ${statusText(item.type)}</strong><span>${formatDateTime(item.occurredAt)} · ${escapeHtml(item.actorNameSnapshot || '')}</span></div>
    ${item.undoable ? `<button class="button button--secondary" data-admin-undo="${item.id}">되돌리기</button>` : ''}</div>`).join('') : '<div class="empty-state">기록이 없습니다.</div>';
  qs('#admin-list-dialog').showModal();
});

qs('#admin-no-show-button').addEventListener('click', () => {
  const recent = events.filter((item) => item.type === 'no_show');
  qs('#admin-dialog-title').textContent = '미수령 목록';
  qs('#admin-dialog-content').innerHTML = recent.length ? recent.map((item) => {
    const occurred = item.occurredAt?.toDate?.() || new Date(item.occurredAt);
    const elapsed = Math.floor((Date.now() - occurred.getTime()) / 1000);
    const canPickup = elapsed <= Number(settings.noShowGraceSeconds || 60);
    return `<div class="data-row"><div><strong>${escapeHtml(item.reservationNo)}</strong><span>${formatDateTime(item.occurredAt)} · ${canPickup ? `${Math.max(0, Number(settings.noShowGraceSeconds || 60) - elapsed)}초 남음` : '만료됨'}</span></div>${canPickup ? `<button class="button button--primary" data-admin-late-pickup="${item.reservationId}">수령</button>` : ''}</div>`;
  }).join('') : '<div class="empty-state">미수령 팀이 없습니다.</div>';
  qs('#admin-list-dialog').showModal();
});

qs('#admin-dialog-content').addEventListener('click', async (event) => {
  const undoButton = event.target.closest('[data-admin-undo]');
  const pickupButton = event.target.closest('[data-admin-late-pickup]');
  try {
    if (undoButton) {
      if (!confirm('이 기록을 되돌릴까요? 원래 기록은 삭제되지 않습니다.')) return;
      await undoReservationEvent({ eventId: undoButton.dataset.adminUndo, operationId: operationId() });
      qs('#admin-list-dialog').close(); showToast('되돌리기 기록을 추가했습니다.');
    }
    if (pickupButton) {
      await staffAction({ reservationId: pickupButton.dataset.adminLatePickup, action: 'pickup', operationId: operationId() });
      qs('#admin-list-dialog').close(); showToast('늦은 수령으로 처리했습니다.');
    }
  } catch (error) { showToast(friendlyError(error), 5000); }
});

qs('#admin-sold-out-button').addEventListener('click', () => {
  qs('#admin-sold-out-summary').textContent = `현재 대기 ${activeQueue().length}팀 · ${settings.acceptingReservations ? '예약 접수 중' : '새 예약 마감'}`;
  qs('#admin-sold-out-dialog').showModal();
});
qsa('[data-admin-mode]').forEach((button) => button.addEventListener('click', async () => {
  const cancelWaiting = button.dataset.adminMode === 'cancel_waiting';
  if (!confirm(cancelWaiting ? '대기 팀을 모두 재료 소진으로 취소할까요?' : '새 예약만 막을까요?')) return;
  try {
    await setSoldOut({ mode: button.dataset.adminMode, operationId: operationId() });
    qs('#admin-sold-out-dialog').close(); showToast('재료 소진 상태를 반영했습니다.');
  } catch (error) { showToast(friendlyError(error), 5000); }
}));
qsa('[data-admin-close]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));

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
  try { await ensureAppCheck(true); await signInWithEmailAndPassword(auth, qs('#admin-email').value.trim(), qs('#admin-password').value); }
  catch (error) { qs('#admin-login-error').textContent = friendlyError(error); show(qs('#admin-login-error'), true); }
});
qs('#admin-google-login').addEventListener('click', async () => {
  show(qs('#admin-login-error'), false); setBusy(qs('#admin-google-login'), true, 'Google 로그인 중…');
  try { await ensureAppCheck(true); await signInWithPopup(auth, googleProvider); }
  catch (error) { qs('#admin-login-error').textContent = friendlyError(error); show(qs('#admin-login-error'), true); }
  finally { setBusy(qs('#admin-google-login'), false); }
});
qs('#admin-logout').addEventListener('click', () => signOut(auth));
onAuthStateChanged(auth, async (user) => {
  unsubscribers.forEach((unsubscribe) => unsubscribe()); unsubscribers = [];
  if (user && !user.isAnonymous) { try { await ensureAppCheck(); await loadAdmin(); } catch (error) { qs('#admin-login-error').textContent = friendlyError(error); show(qs('#admin-login-error'), true); } }
  else { profile = null; show(qs('#admin-login'), true); show(qs('#admin-view'), false); }
});

