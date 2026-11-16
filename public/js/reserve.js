import { functions } from './firebase-config.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-functions.js';
import { qs, show, escapeHtml, customerToken, operationId, friendlyError, showToast, setBusy } from './shared.js';

const STORAGE_KEY = 'bokseong-reservation-session-v1';
const getPublicSettings = httpsCallable(functions, 'getPublicSettings');
const createReservation = httpsCallable(functions, 'createReservation');
const lookupReservation = httpsCallable(functions, 'lookupReservation');
let settings = null;
let selectedMenu = '';
let availableMenus = [];
let currentStep = 1;

function showStep(step) {
  currentStep = step;
  document.querySelectorAll('[data-kiosk-step]').forEach((panel) => show(panel, Number(panel.dataset.kioskStep) === step));
  document.querySelectorAll('[data-progress]').forEach((item) => {
    const itemStep = Number(item.dataset.progress);
    item.classList.toggle('active', itemStep === step);
    item.classList.toggle('complete', itemStep < step);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateSummary() {
  qs('#summary-menu').textContent = selectedMenu || '메뉴를 선택해 주세요';
  const studentId = qs('#reserve-student-id').value.trim();
  const studentName = qs('#reserve-student-name').value.trim();
  qs('#summary-student').textContent = studentId || studentName ? `${studentId} ${studentName}`.trim() : '학생 정보 입력 전';
  qs('#menu-next').disabled = !selectedMenu || !settings?.acceptingNow;
}

async function initialize() {
  try {
    const response = await getPublicSettings();
    settings = response.data;
    qs('#reserve-subtitle').textContent = `${settings.eventName || '복성고 학술문화제'} · ${settings.serviceName || '먹거리 부스'}`;
    const menus = Array.isArray(settings.menus) ? settings.menus : [];
    availableMenus = menus;
    qs('#menu-options').innerHTML = menus.map((menu, index) => `<button type="button" class="kiosk-menu" data-menu-index="${index}" aria-pressed="false"><span class="kiosk-menu__body"><b class="kiosk-menu__number">${String(index + 1).padStart(2, '0')}</b><span class="kiosk-menu__icon">🍴</span><strong>${escapeHtml(menu)}</strong><small>선택하기</small></span></button>`).join('');
    const notice = qs('#reserve-notice');
    notice.textContent = settings.notice || '';
    show(notice, Boolean(settings.notice));
    qs('#reserve-submit').disabled = !settings.acceptingNow || menus.length === 0;
    qs('#reserve-state').textContent = settings.acceptingNow ? '' : '현재 새 예약 접수가 중지되었습니다. 기존 예약은 조회할 수 있습니다.';
    show(qs('#reserve-state'), !settings.acceptingNow);
    show(qs('#reserve-card'), true);
    updateSummary();
  } catch (error) { showToast(friendlyError(error), 6000); }
  finally { show(qs('#reserve-loading'), false); }
}

qs('#menu-options').addEventListener('click', (event) => {
  const button = event.target.closest('[data-menu-index]');
  if (!button) return;

  selectedMenu = availableMenus[Number(button.dataset.menuIndex)] || '';
  qs('#menu-options').querySelectorAll('.kiosk-menu').forEach((menuButton) => {
    const isSelected = menuButton === button;
    menuButton.classList.toggle('selected', isSelected);
    menuButton.setAttribute('aria-pressed', String(isSelected));
  });
  updateSummary();
});

qs('#menu-next').addEventListener('click', () => {
  if (!selectedMenu) { showToast('메뉴를 먼저 선택해 주세요.'); return; }
  showStep(2);
  setTimeout(() => qs('#reserve-student-id').focus(), 250);
});

['#reserve-student-id', '#reserve-student-name'].forEach((selector) => qs(selector).addEventListener('input', updateSummary));
qs('#info-next').addEventListener('click', () => {
  const studentId = qs('#reserve-student-id');
  const studentName = qs('#reserve-student-name');
  if (!studentId.reportValidity() || !studentName.reportValidity()) return;
  qs('#confirm-menu').textContent = selectedMenu;
  qs('#confirm-student').textContent = `${studentId.value.trim()} ${studentName.value.trim()}`;
  showStep(3);
});
document.querySelectorAll('[data-back]').forEach((button) => button.addEventListener('click', () => showStep(Number(button.dataset.back))));

qs('#reserve-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (currentStep !== 3) {
    if (currentStep === 1) qs('#menu-next').click();
    else qs('#info-next').click();
    return;
  }
  const button = qs('#reserve-submit');
  const menuName = selectedMenu;
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
