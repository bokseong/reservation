import { functions } from './firebase-config.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-functions.js';
import { qs, show, escapeHtml, customerToken, operationId, friendlyError, showToast, setBusy } from './shared.js';

const STORAGE_KEY = 'bokseong-reservation-session-v1';
const getPublicSettings = httpsCallable(functions, 'getPublicSettings');
const createReservation = httpsCallable(functions, 'createReservation');
const lookupReservation = httpsCallable(functions, 'lookupReservation');
let settings = null;

async function initialize() {
  try {
    const response = await getPublicSettings();
    settings = response.data;
    qs('#reserve-subtitle').textContent = `${settings.eventName || '복성고 학술문화제'} · ${settings.serviceName || '먹거리 부스'}`;
    const menus = Array.isArray(settings.menus) ? settings.menus : [];
    qs('#menu-options').innerHTML = menus.map((menu, index) => `<label class="menu-option"><input type="radio" name="menuName" value="${escapeHtml(menu)}" ${index === 0 ? 'checked' : ''}><span>${escapeHtml(menu)}</span></label>`).join('');
    const notice = qs('#reserve-notice');
    notice.textContent = settings.notice || '';
    show(notice, Boolean(settings.notice));
    qs('#reserve-submit').disabled = !settings.acceptingNow || menus.length === 0;
    qs('#reserve-state').textContent = settings.acceptingNow ? '' : '현재 새 예약 접수가 중지되었습니다. 기존 예약은 조회할 수 있습니다.';
    show(qs('#reserve-state'), !settings.acceptingNow);
    show(qs('#reserve-card'), true);
  } catch (error) { showToast(friendlyError(error), 6000); }
  finally { show(qs('#reserve-loading'), false); }
}

qs('#reserve-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = qs('#reserve-submit');
  const menuName = qs('input[name="menuName"]:checked')?.value || '';
  const studentId = qs('#reserve-student-id').value.trim();
  const studentName = qs('#reserve-student-name').value.trim();
  const token = customerToken();
  setBusy(button, true);
  try {
    const response = await createReservation({ menuName, studentId, studentName, customerToken: token, operationId: operationId() });
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ reservationId: response.data.reservation.id, token }));
    location.href = './index.html';
  } catch (error) {
    if (error?.details?.canLookup) {
      try {
        const response = await lookupReservation({ studentId, studentName, operationId: operationId(), recordLookup: true });
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ reservationId: response.data.reservation.id, studentId, studentName, recovered: true }));
        location.href = './index.html';
      } catch (lookupError) { showToast(friendlyError(lookupError), 5000); }
    } else showToast(friendlyError(error), 5000);
  } finally { setBusy(button, false); }
});

initialize();
