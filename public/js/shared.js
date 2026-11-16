export const ACTIVE_STATUSES = ['waiting', 'called', 'held'];

export function qs(selector, root = document) {
  return root.querySelector(selector);
}

export function qsa(selector, root = document) {
  return [...root.querySelectorAll(selector)];
}

export function show(element, visible = true) {
  element?.classList.toggle('hidden', !visible);
}

export function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

export function operationId() {
  return crypto.randomUUID();
}

export function customerToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function formatDateTime(timestamp) {
  if (!timestamp) return '-';
  const date = typeof timestamp.toDate === 'function' ? timestamp.toDate() : new Date(timestamp);
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).format(date);
}

export function toDateTimeLocal(timestamp) {
  if (!timestamp) return '';
  const date = typeof timestamp.toDate === 'function' ? timestamp.toDate() : new Date(timestamp);
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function showToast(message, timeout = 3200) {
  const toast = qs('#toast');
  if (!toast) return;
  toast.textContent = message;
  show(toast, true);
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => show(toast, false), timeout);
}

export function friendlyError(error) {
  const code = error?.code?.replace('functions/', '') || '';
  const messages = {
    'invalid-argument': '입력 내용을 다시 확인해 주세요.',
    'failed-precondition': error?.message || '현재 상태에서는 처리할 수 없습니다.',
    'already-exists': error?.message || '이미 예약되어 있습니다.',
    'not-found': '예약 정보를 찾지 못했습니다.',
    'permission-denied': '이 작업을 할 권한이 없습니다.',
    'unauthenticated': '로그인이 필요합니다.',
    'resource-exhausted': '요청이 너무 많습니다. 잠시 뒤 다시 시도해 주세요.',
    'auth/invalid-credential': '이메일 또는 비밀번호가 맞지 않습니다.',
    'auth/user-disabled': '사용이 중지된 계정입니다.',
    'auth/unauthorized-domain': '이 도메인은 Firebase Authentication에 승인되지 않았습니다. 관리자에게 문의해 주세요.',
    'auth/operation-not-allowed': 'Google 로그인 제공업체가 아직 활성화되지 않았습니다.',
    'auth/argument-error': 'Google 로그인 초기화에 실패했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.',
    'auth/popup-blocked': '브라우저가 Google 로그인 창을 차단했습니다. 팝업을 허용해 주세요.',
    'auth/popup-closed-by-user': 'Google 로그인 창이 닫혔습니다. 다시 시도해 주세요.',
    'auth/cancelled-popup-request': '다른 Google 로그인 요청이 진행 중입니다.',
    'app-check-token-is-invalid': '기기 확인에 실패했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.'
  };
  return messages[code] || messages[error?.code] || error?.message || '처리 중 오류가 발생했습니다.';
}

export function setBusy(button, busy, label = '처리 중…') {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = label;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

export function statusText(status) {
  return ({ waiting: '대기 중', called: '지금 차례', held: '보류', preparing: '조리 중', ready: '조리 완료', picked_up: '수령 완료', no_show: '미수령', cancelled: '취소됨', expired: '만료됨', apply: '신청', cooking_start: '조리 시작', cooking_complete: '조리 완료', pickup: '수령', cancel: '취소', undo: '되돌리기', relookup: '다시조회' })[status] || status;
}

