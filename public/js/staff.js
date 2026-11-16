import { auth, appCheck, db, functions } from './firebase-config.js';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js';
import { getToken } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-app-check.js';
import { collection, doc, onSnapshot, orderBy, query, where, limit } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-functions.js';
import { qs, qsa, show, escapeHtml, friendlyError, showToast, operationId, statusText, formatDateTime, setBusy } from './shared.js';

const getStaffSession = httpsCallable(functions, 'getStaffSession');
const staffAction = httpsCallable(functions, 'staffAction');
const undoReservationEvent = httpsCallable(functions, 'undoReservationEvent');
const setSoldOut = httpsCallable(functions, 'setSoldOut');

let profile = null;
let settings = null;
let reservations = [];
let events = [];
let unsubscribers = [];

function resetSubscriptions() {
  unsubscribers.forEach((unsubscribe) => unsubscribe());
  unsubscribers = [];
}

async function loadStaff(user) {
  try {
    const response = await getStaffSession();
    profile = response.data.profile;
    show(qs('#login-view'), false);
    show(qs('#staff-view'), true);
    qs('#staff-meta').textContent = `${profile.name}로 로그인 · ${profile.role === 'admin' ? '1급' : '2급'}`;
    show(qs('#admin-link'), profile.role === 'admin');
    subscribeData();
  } catch (error) {
    await signOut(auth);
    show(qs('#login-view'), true);
    show(qs('#staff-view'), false);
    qs('#login-error').textContent = friendlyError(error);
    show(qs('#login-error'), true);
  }
}

function subscribeData() {
  resetSubscriptions();
  unsubscribers.push(onSnapshot(doc(db, 'settings', 'event'), (snapshot) => {
    settings = snapshot.exists() ? snapshot.data() : {};
    renderSettings();
  }));
  const activeQuery = query(collection(db, 'reservations'), where('currentStatus', 'in', ['waiting', 'called', 'held']), orderBy('queueOrder'));
  unsubscribers.push(onSnapshot(activeQuery, (snapshot) => {
    reservations = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    renderQueue();
  }, (error) => showToast(friendlyError(error), 6000)));
  const recentEvents = query(collection(db, 'reservationEvents'), orderBy('occurredAt', 'desc'), limit(50));
  unsubscribers.push(onSnapshot(recentEvents, (snapshot) => {
    events = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  }));
}

function renderSettings() {
  qs('#staff-service').textContent = settings.serviceName || '먹거리 부스';
  const accepting = settings.acceptingReservations === true;
  qs('#accepting-state').textContent = accepting ? '예약 받는 중' : '새 예약 마감';
  qs('#accepting-state').classList.toggle('closed', !accepting);
  const breakBox = qs('#staff-break');
  if (settings.breakActive) {
    const end = settings.breakPlannedEndAt?.toDate?.() || new Date(settings.breakPlannedEndAt);
    const remaining = Math.ceil((end.getTime() - Date.now()) / 1000);
    breakBox.textContent = remaining > 0 ? `쉬는 중 · ${settings.breakReason} · ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}` : `쉬는 중 · ${settings.breakReason} · 예정 시간 지남`;
  }
  show(breakBox, Boolean(settings.breakActive));
}

function renderQueue() {
  const called = reservations.find((item) => item.currentStatus === 'called') || reservations[0];
  qs('#queue-count').textContent = reservations.length;
  if (called) {
    qs('#current-reservation').textContent = called.reservationNo;
    qs('#current-student').textContent = `${called.studentIdNormalized} ${called.studentName}`;
  } else {
    qs('#current-reservation').textContent = '대기 팀 없음';
    qs('#current-student').textContent = '';
  }
  qsa('[data-action]').forEach((button) => {
    button.disabled = !called || (button.dataset.action === 'hold' && reservations.length <= 1) || (button.dataset.action === 'hold' && called.holdCount >= (settings?.maxHoldCount ?? 2));
    button.dataset.reservationId = called?.id || '';
  });
  qs('#queue-list').innerHTML = reservations.length ? reservations.map((item, index) => `
    <div class="queue-item ${item.currentStatus === 'called' ? 'queue-item--called' : ''}">
      <div><strong>${index + 1}. ${escapeHtml(item.reservationNo)} · ${escapeHtml(item.studentName)}</strong><span>${escapeHtml(item.studentIdNormalized)} · ${statusText(item.currentStatus)} · 보류 ${item.holdCount || 0}회</span></div>
      <span>${item.currentStatus === 'called' ? '지금 차례' : `앞 ${index}팀`}</span>
    </div>`).join('') : '<div class="empty-state">현재 대기 중인 팀이 없습니다.</div>';
  qs('#sync-state').textContent = `마지막 갱신 ${new Date().toLocaleTimeString('ko-KR')}`;
  renderNoShows();
}

function renderNoShows() {
  const noShowEvents = events.filter((event) => event.type === 'no_show');
  qs('#no-show-count').textContent = noShowEvents.length;
}

qsa('[data-action]').forEach((button) => button.addEventListener('click', async () => {
  if (!button.dataset.reservationId) return;
  const labels = { pickup: '수령', no_show: '미수령', hold: '보류', cancel: '취소' };
  if (!confirm(`${labels[button.dataset.action]} 처리할까요?`)) return;
  try {
    setBusy(button, true);
    await staffAction({ reservationId: button.dataset.reservationId, action: button.dataset.action, operationId: operationId() });
    showToast(`${labels[button.dataset.action]} 처리했습니다.`);
  } catch (error) { showToast(friendlyError(error), 5000); }
  finally { setBusy(button, false); }
}));

qs('#history-button').addEventListener('click', () => {
  qs('#dialog-title').textContent = '최근 기록';
  qs('#dialog-content').innerHTML = events.length ? events.map((event) => `
    <div class="data-row"><div><strong>${escapeHtml(event.eventNo)} · ${escapeHtml(event.reservationNo)} · ${statusText(event.type)}</strong><span>${formatDateTime(event.occurredAt)} · ${escapeHtml(event.actorNameSnapshot || '')}</span></div>
    ${event.undoable ? `<button class="button button--secondary" data-undo="${event.id}">되돌리기</button>` : ''}</div>`).join('') : '<div class="empty-state">기록이 없습니다.</div>';
  qs('#list-dialog').showModal();
});

qs('#no-show-button').addEventListener('click', () => {
  const recent = events.filter((event) => event.type === 'no_show');
  qs('#dialog-title').textContent = '미수령';
  qs('#dialog-content').innerHTML = recent.length ? recent.map((event) => {
    const occurred = event.occurredAt?.toDate?.() || new Date(event.occurredAt);
    const elapsed = Math.floor((Date.now() - occurred.getTime()) / 1000);
    const canPickup = elapsed <= Number(settings?.noShowGraceSeconds || 60);
    return `<div class="data-row"><div><strong>${escapeHtml(event.reservationNo)}</strong><span>${formatDateTime(event.occurredAt)} · ${canPickup ? `${Math.max(0, Number(settings?.noShowGraceSeconds || 60) - elapsed)}초 남음` : '만료됨'}</span></div>${canPickup ? `<button class="button button--primary" data-late-pickup="${event.reservationId}">수령</button>` : ''}</div>`;
  }).join('') : '<div class="empty-state">미수령 팀이 없습니다.</div>';
  qs('#list-dialog').showModal();
});

qs('#dialog-content').addEventListener('click', async (event) => {
  const undoButton = event.target.closest('[data-undo]');
  const pickupButton = event.target.closest('[data-late-pickup]');
  try {
    if (undoButton) {
      if (!confirm('이 기록을 되돌릴까요? 기존 기록은 삭제되지 않습니다.')) return;
      await undoReservationEvent({ eventId: undoButton.dataset.undo, operationId: operationId() });
      qs('#list-dialog').close(); showToast('되돌리기 기록을 추가했습니다.');
    }
    if (pickupButton) {
      await staffAction({ reservationId: pickupButton.dataset.latePickup, action: 'pickup', operationId: operationId() });
      qs('#list-dialog').close(); showToast('늦은 수령으로 처리했습니다.');
    }
  } catch (error) { showToast(friendlyError(error), 5000); }
});

qs('#sold-out-button').addEventListener('click', () => {
  qs('#sold-out-summary').textContent = `지금 대기 ${reservations.length}팀 · ${settings?.acceptingReservations ? '예약 받는 중' : '새 예약 마감'}`;
  qs('#sold-out-dialog').showModal();
});
qsa('[data-mode]').forEach((button) => button.addEventListener('click', async () => {
  if (!confirm(button.dataset.mode === 'cancel_waiting' ? `대기 ${reservations.length}팀을 모두 취소할까요?` : '새 예약만 막을까요?')) return;
  try {
    await setSoldOut({ mode: button.dataset.mode, operationId: operationId() });
    qs('#sold-out-dialog').close(); showToast('재료 소진 상태를 반영했습니다.');
  } catch (error) { showToast(friendlyError(error), 5000); }
}));

qsa('[data-close]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
qs('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault(); show(qs('#login-error'), false);
  try { await getToken(appCheck, false); await signInWithEmailAndPassword(auth, qs('#email').value.trim(), qs('#password').value); }
  catch (error) { qs('#login-error').textContent = friendlyError(error); show(qs('#login-error'), true); }
});
qs('#logout-button').addEventListener('click', () => signOut(auth));
onAuthStateChanged(auth, (user) => {
  resetSubscriptions();
  if (user && !user.isAnonymous) loadStaff(user);
  else { profile = null; show(qs('#login-view'), true); show(qs('#staff-view'), false); }
});

