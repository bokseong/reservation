import { functions, ensureAppCheck } from './firebase.js?v=20261117-1';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-functions.js';
import { qs, show, escapeHtml, customerToken, operationId, friendlyError, showToast, setBusy } from './shared.js';
import { availableMenuItems, formatPrice } from './menu.js';

const STORAGE_KEY = 'bokseong-reservation-sessions-v2';
const LEGACY_STORAGE_KEY = 'bokseong-reservation-session-v1';
const getPublicSettings = httpsCallable(functions, 'getPublicSettings');
const createReservation = httpsCallable(functions, 'createReservation');
const startReservationPayment = httpsCallable(functions, 'startReservationPayment');
let settings = null;
let selectedItems = new Map();
let availableMenus = [];
let currentStep = 1;

function rememberReservation(value) {
  let sessions = [];
  try { sessions = JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { sessions = []; }
  if (!Array.isArray(sessions)) sessions = [];
  sessions = [value, ...sessions.filter((item) => item?.reservationId !== value.reservationId)].slice(0, 10);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  localStorage.removeItem(LEGACY_STORAGE_KEY);
}

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
  const items = orderItems();
  const count = items.reduce((total, item) => total + item.quantity, 0);
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  qs('#summary-menu').textContent = items.length ? `${items.length}종류 · ${count}개 선택` : '메뉴를 선택해 주세요';
  qs('#summary-items').innerHTML = items.map((item) => `<div class="kiosk-summary__item"><span>${escapeHtml(item.name)} <b>×${item.quantity}</b></span><span>${formatPrice(item.price * item.quantity)}</span><div class="kiosk-quantity"><button type="button" data-cart-minus="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.name)} 수량 줄이기">−</button><button type="button" data-cart-plus="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.name)} 수량 늘리기">+</button></div></div>`).join('');
  qs('#summary-count').textContent = `${count}개`;
  qs('#summary-total').textContent = formatPrice(total);
  const studentId = qs('#reserve-student-id').value.trim();
  const studentName = qs('#reserve-student-name').value.trim();
  qs('#summary-student').textContent = studentId || studentName ? `${studentId} ${studentName}`.trim() : '학생 정보 입력 전';
  qs('#menu-next').disabled = items.length === 0 || !settings?.acceptingNow;
}

function orderItems() {
  return availableMenus
    .filter((menu) => selectedItems.has(menu.id))
    .map((menu) => ({ ...menu, quantity: selectedItems.get(menu.id) }));
}

function renderMenus() {
  qs('#menu-options').innerHTML = availableMenus.map((menu, index) => {
    const quantity = selectedItems.get(menu.id) || 0;
    return `<button type="button" class="kiosk-menu ${quantity ? 'selected' : ''}" data-menu-id="${escapeHtml(menu.id)}" aria-pressed="${quantity > 0}"><span class="kiosk-menu__body"><b class="kiosk-menu__number">${String(index + 1).padStart(2, '0')}</b><span class="kiosk-menu__icon">${escapeHtml(menu.emoji || '🍴')}</span><strong>${escapeHtml(menu.name)}</strong><span class="kiosk-menu__price">${formatPrice(menu.price)}</span><small>${escapeHtml(menu.description || '눌러서 담기')}</small><em class="kiosk-menu__quantity">${quantity ? `${quantity}개 선택` : '담기'}</em></span></button>`;
  }).join('');
}

function changeQuantity(menuId, delta) {
  const current = selectedItems.get(menuId) || 0;
  const next = Math.max(0, Math.min(10, current + delta));
  if (next === 0) selectedItems.delete(menuId);
  else selectedItems.set(menuId, next);
  renderMenus();
  updateSummary();
}

async function initialize() {
  try {
    await ensureAppCheck();
    const response = await getPublicSettings();
    settings = response.data;
    qs('#reserve-subtitle').textContent = `${settings.eventName || '복성고 학술문화제'} · ${settings.serviceName || '먹거리 부스'}`;
    const menus = availableMenuItems();
    availableMenus = menus;
    renderMenus();
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
  const button = event.target.closest('[data-menu-id]');
  if (!button) return;
  changeQuantity(button.dataset.menuId, 1);
});

qs('#summary-items').addEventListener('click', (event) => {
  const minus = event.target.closest('[data-cart-minus]');
  const plus = event.target.closest('[data-cart-plus]');
  if (minus) changeQuantity(minus.dataset.cartMinus, -1);
  if (plus) changeQuantity(plus.dataset.cartPlus, 1);
});

qs('#menu-next').addEventListener('click', () => {
  if (!orderItems().length) { showToast('메뉴를 먼저 선택해 주세요.'); return; }
  showStep(2);
  setTimeout(() => qs('#reserve-student-id').focus(), 250);
});

['#reserve-student-id', '#reserve-student-name'].forEach((selector) => qs(selector).addEventListener('input', updateSummary));
qs('#info-next').addEventListener('click', () => {
  const studentId = qs('#reserve-student-id');
  const studentName = qs('#reserve-student-name');
  if (!studentId.reportValidity() || !studentName.reportValidity()) return;
  const items = orderItems();
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  qs('#confirm-menu').textContent = `${items.map((item) => `${item.name} ×${item.quantity}`).join(', ')} · ${formatPrice(total)}`;
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
  const items = orderItems().map((item) => ({ menuId: item.id, quantity: item.quantity }));
  if (!items.length) { showToast('메뉴를 먼저 선택해 주세요.'); return; }
  const studentId = qs('#reserve-student-id').value.trim();
  const studentName = qs('#reserve-student-name').value.trim();
  const token = customerToken();
  setBusy(button, true);
  try {
    const response = await createReservation({ items, studentId, studentName, customerToken: token, operationId: operationId() });
    rememberReservation({ reservationId: response.data.reservation.id, token, reservationNo: response.data.reservation.reservationNo, menuName: response.data.reservation.menuName });
    const payment = await startReservationPayment({ reservationId: response.data.reservation.id, customerToken: token });
    location.assign(payment.data.paymentUrl);
  } catch (error) { showToast(friendlyError(error), 5000); }
  finally { setBusy(button, false); }
});

initialize();
