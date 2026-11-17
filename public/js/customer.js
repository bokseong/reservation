import { app, functions, ensureAppCheck, webPushCertificateKey } from './firebase.js?v=20261117-1';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-functions.js';
import { qs, show, operationId, friendlyError, showToast, setBusy } from './shared.js';

const STORAGE_KEY = 'bokseong-reservation-session-v1';
const lookupReservation = httpsCallable(functions, 'lookupReservation');
const getCustomerReservation = httpsCallable(functions, 'getCustomerReservation');
const cancelReservation = httpsCallable(functions, 'cancelOwnReservation');
const getPublicSettings = httpsCallable(functions, 'getPublicSettings');
const registerNotificationDevice = httpsCallable(functions, 'registerNotificationDevice');
const startReservationPayment = httpsCallable(functions, 'startReservationPayment');

let session = readSession();
let settings = null;
let recoveredTimer = null;
let messaging = null;
let foregroundMessageListener = false;

function readSession() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return null; }
}

function saveSession(value) {
  session = value;
  if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  else localStorage.removeItem(STORAGE_KEY);
}

async function initialize() {
  try {
    await ensureAppCheck();
    await loadSettings();
    if (session?.reservationId && session?.token) startTokenPolling();
    else if (session?.studentId && session?.studentName) startRecoveredPolling();
    else showForm();
  } catch (error) {
    showForm();
    showToast(friendlyError(error), 6000);
  } finally {
    show(qs('#loading-view'), false);
  }
  if (session?.reservationId && session?.token && Notification.permission === 'granted') registerPushDevice().catch(() => {});
}

async function registerPushDevice(requestPermission = false) {
  if (!session?.reservationId || !session?.token) throw new Error('최초 예약 기기에서만 알림을 연결할 수 있습니다.');
  if (!('Notification' in window) || !('serviceWorker' in navigator)) throw new Error('이 브라우저는 푸시 알림을 지원하지 않습니다.');
  const messagingSdk = await import('https://www.gstatic.com/firebasejs/13.2.0/firebase-messaging.js');
  if (!(await messagingSdk.isSupported())) throw new Error('이 브라우저는 푸시 알림을 지원하지 않습니다.');
  let permission = Notification.permission;
  if (permission !== 'granted' && requestPermission) permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('브라우저 알림 권한이 필요합니다.');

  const registration = await navigator.serviceWorker.register('./firebase-messaging-sw.js', { scope: './' });
  messaging ||= messagingSdk.getMessaging(app);
  const fcmToken = await messagingSdk.getToken(messaging, { vapidKey: webPushCertificateKey, serviceWorkerRegistration: registration });
  if (!fcmToken) throw new Error('푸시 알림 기기를 등록하지 못했습니다.');
  await registerNotificationDevice({ reservationId: session.reservationId, customerToken: session.token, fcmToken, operationId: operationId() });
  saveSession({ ...session, notificationEnabled: true });

  if (!foregroundMessageListener) {
    messagingSdk.onMessage(messaging, (payload) => {
      const title = payload.notification?.title || `${settings?.serviceName || '먹거리 부스'} 조리 완료`;
      const body = payload.notification?.body || '음식이 준비됐어요. 지금 받아 주세요.';
      showToast(body, 6000);
      if (Notification.permission === 'granted') new Notification(title, { body });
    });
    foregroundMessageListener = true;
  }
}

async function loadSettings() {
  const response = await getPublicSettings();
  settings = response.data;
  renderSettings();
}

function renderSettings() {
  if (!settings) return;
  qs('#service-title').textContent = settings.serviceName || '먹거리 예약';
  qs('#service-subtitle').textContent = `${settings.eventName || '복성고 학술문화제'} · 줄 서지 말고 차례만 확인하세요.`;
  const notice = qs('#global-notice');
  notice.textContent = settings.notice || '';
  show(notice, Boolean(settings.notice));
  const breakNotice = qs('#break-notice');
  if (settings.breakActive) {
    const end = new Date(settings.breakPlannedEndAt);
    const overdue = end.getTime() <= Date.now();
    breakNotice.textContent = overdue
      ? `부스가 잠시 쉬는 중이에요 · ${settings.breakReason} · 곧 다시 열어요.`
      : `부스가 잠시 쉬는 중이에요 · ${settings.breakReason} · 예정 ${end.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`;
  }
  show(breakNotice, Boolean(settings.breakActive));
}

function showForm() {
  show(qs('#form-view'), true);
  show(qs('#reservation-view'), false);
}

function startTokenPolling() {
  clearInterval(recoveredTimer);
  const refresh = async () => {
    try {
      const response = await getCustomerReservation({ reservationId: session.reservationId, customerToken: session.token });
      renderReservation(response.data.reservation, false);
    } catch (error) {
      if (error?.code?.includes('not-found') || error?.code?.includes('permission-denied')) { saveSession(null); showForm(); }
      else showToast(friendlyError(error));
    }
  };
  refresh();
  recoveredTimer = setInterval(refresh, 3000);
}

async function startRecoveredPolling() {
  const refresh = async () => {
    try {
      const response = await lookupReservation({ studentId: session.studentId, studentName: session.studentName, operationId: operationId(), recordLookup: false });
      renderReservation(response.data.reservation, true);
    } catch (error) { showToast(friendlyError(error)); }
  };
  await refresh();
  recoveredTimer = setInterval(refresh, 15000);
}

function renderReservation(reservation, recovered) {
  if (['picked_up', 'cancelled'].includes(reservation.currentStatus)) {
    saveSession(null);
    clearInterval(recoveredTimer);
    showForm();
    showToast(reservation.currentStatus === 'picked_up' ? '수령 처리가 완료되어 이 기기의 예약 표시를 정리했습니다.' : '처리된 예약이라 화면에서 정리했습니다.');
    return;
  }
  show(qs('#form-view'), false);
  show(qs('#reservation-view'), true);
  qs('#reservation-no').textContent = reservation.reservationNo;
  qs('#reservation-owner').textContent = `${reservation.studentIdNormalized} ${reservation.studentName} · ${reservation.menuName || settings?.serviceName || ''}`;
  const status = reservation.currentStatus;
  const panel = qs('#status-panel');
  const label = qs('#status-label');
  const value = qs('#status-value');
  const help = qs('#status-help');
  panel.dataset.tone = '';
  label.textContent = '예약 상태';
  help.textContent = '';

  if (status === 'payment_pending') {
    label.textContent = '결제 확인 중'; value.textContent = '대기열 등록 전'; help.textContent = '축제은행 결제 확인 후 자동으로 예약 대기열에 등록됩니다.';
  } else if (status === 'called' || status === 'preparing') {
    // `called` is retained for legacy records, but customer-facing status uses the new cooking-first flow.
    const ahead = Number(reservation.teamsAhead ?? 0);
    label.textContent = '조리 중'; value.textContent = `앞에 ${ahead}팀`; help.textContent = '음식을 조리하고 있어요. 조리가 끝나면 이 화면에서 바로 알려드려요.';
  } else if (status === 'ready') {
    label.textContent = '조리 완료'; value.textContent = '음식이 준비됐어요'; help.textContent = '지금 부스로 와서 받아 주세요.'; panel.dataset.tone = 'success';
  } else if (status === 'waiting' || status === 'held') {
    const ahead = Number(reservation.teamsAhead ?? 0);
    label.textContent = status === 'held' ? '보류 후 대기 중' : '대기 중'; value.textContent = `앞에 ${ahead}팀`; help.textContent = '화면은 자동으로 갱신됩니다.';
  } else if (status === 'no_show') {
    const missedAt = new Date(reservation.missedAt);
    const grace = Number(settings?.noShowGraceSeconds || 60);
    const elapsed = Math.floor((Date.now() - missedAt.getTime()) / 1000);
    if (elapsed <= grace) { label.textContent = '차례를 놓쳤어요'; value.textContent = `${Math.max(0, grace - elapsed)}초 남음`; help.textContent = '지금 바로 부스 직원에게 말해 주세요.'; }
    else { label.textContent = '미수령'; value.textContent = '만료됨'; help.textContent = '수령 가능 시간이 지났습니다.'; panel.dataset.tone = 'danger'; }
  } else if (status === 'picked_up') {
    label.textContent = '처리 완료'; value.textContent = '수령 완료'; help.textContent = '이용해 주셔서 감사합니다.'; panel.dataset.tone = 'success';
  } else if (status === 'cancelled') {
    label.textContent = '예약 취소'; value.textContent = '취소됨'; help.textContent = reservation.cancelMemo === '재료 소진' ? '재료가 떨어져 예약이 취소됐어요.' : '예약이 취소되었습니다.'; panel.dataset.tone = 'danger';
  }

  const canCancel = !recovered && ['waiting', 'called', 'held'].includes(status) && Boolean(session?.token);
  const canPay = !recovered && status === 'payment_pending' && Boolean(session?.token);
  show(qs('#pay-button'), canPay);
  show(qs('#cancel-button'), canCancel);
  const canNotify = Boolean(session?.token) && 'Notification' in window && ['waiting', 'called', 'held', 'preparing', 'ready'].includes(status);
  show(qs('#notify-button'), canNotify);
  if (canNotify) {
    qs('#notify-button').textContent = session.notificationEnabled ? '조리 완료 푸시 알림 켜짐' : '조리 완료 푸시 알림 켜기';
    qs('#notify-button').disabled = session.notificationEnabled;
  }
  show(qs('#readonly-hint'), recovered);
  if (status === 'no_show') setTimeout(() => renderReservation(reservation, recovered), 1000);
}

qs('#reservation-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = qs('#lookup-button');
  const studentId = qs('#student-id').value.trim();
  const studentName = qs('#student-name').value.trim();
  setBusy(button, true);
  try {
    const response = await lookupReservation({ studentId, studentName, operationId: operationId(), recordLookup: true });
    saveSession({ reservationId: response.data.reservation.id, studentId, studentName, recovered: true });
    renderReservation(response.data.reservation, true);
    startRecoveredPolling();
    showToast('예약 정보를 불러왔어요.');
  } catch (error) { showToast(friendlyError(error), 5000); }
  finally { setBusy(button, false); }
});

qs('#cancel-button').addEventListener('click', () => qs('#cancel-dialog').showModal());
qs('#pay-button').addEventListener('click', async () => {
  try {
    setBusy(qs('#pay-button'), true, '결제 페이지 준비 중…');
    const result = await startReservationPayment({ reservationId: session.reservationId, customerToken: session.token });
    location.assign(result.data.paymentUrl);
  } catch (error) { showToast(friendlyError(error), 5000); }
  finally { setBusy(qs('#pay-button'), false); }
});
qs('#notify-button').addEventListener('click', async () => {
  try {
    setBusy(qs('#notify-button'), true, '알림 연결 중…');
    await registerPushDevice(true);
    qs('#notify-button').textContent = '조리 완료 푸시 알림 켜짐';
    qs('#notify-button').disabled = true;
    showToast('이 기기에 조리 완료 푸시 알림을 연결했습니다.');
  } catch (error) { showToast(error.message || '푸시 알림을 연결하지 못했습니다.', 5000); }
  finally { if (!session?.notificationEnabled) setBusy(qs('#notify-button'), false); }
});
qs('#cancel-dialog').addEventListener('close', async () => {
  if (qs('#cancel-dialog').returnValue !== 'confirm') return;
  try {
    setBusy(qs('#cancel-button'), true);
    await cancelReservation({ reservationId: session.reservationId, customerToken: session.token, operationId: operationId() });
    saveSession(null);
    showForm();
    showToast('예약이 취소되었습니다.');
  } catch (error) { showToast(friendlyError(error), 5000); }
  finally { setBusy(qs('#cancel-button'), false); }
});

qs('#forget-button').addEventListener('click', () => {
  saveSession(null); clearInterval(recoveredTimer); showForm(); showToast('이 폰에 저장된 예약 정보를 지웠어요.');
});

initialize();

