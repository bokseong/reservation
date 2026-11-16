import { createHash } from 'node:crypto';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2/options';
import { normalizeStudentId, normalizeName, csvRows, koreaDate } from './lib.js';

if (!getApps().length) initializeApp();
setGlobalOptions({ region: 'asia-northeast3', maxInstances: 20, timeoutSeconds: 60 });

const db = getFirestore('reservation');
const auth = getAuth();
const QUEUED = ['waiting', 'called', 'held'];
const ACTIVE = [...QUEUED, 'preparing', 'ready'];
const BOOTSTRAP_ADMINS = new Set(['github.jwastro09@gmail.com']);
const SETTINGS_REF = db.doc('settings/event');

const DEFAULT_SETTINGS = {
  eventName: '2026 복성고 학술문화제',
  serviceName: '먹거리 부스',
  menus: ['떡볶이'],
  reservationStartAt: Timestamp.fromDate(new Date('2026-11-20T03:30:00.000Z')),
  reservationEndAt: Timestamp.fromDate(new Date('2026-11-20T07:30:00.000Z')),
  acceptingReservations: true,
  notice: '',
  breakActive: false,
  breakReason: null,
  breakStartedAt: null,
  breakPlannedEndAt: null,
  breakEndedAt: null,
  noShowGraceSeconds: 60,
  noShowListSeconds: 180,
  maxHoldCount: 2,
  updatedAt: FieldValue.serverTimestamp()
};

function requireAuth(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  return request.auth;
}

async function ensureSettings() {
  const snapshot = await SETTINGS_REF.get();
  if (snapshot.exists) {
    const settings = snapshot.data();
    if (!Array.isArray(settings.menus) || !settings.menus.length) {
      settings.menus = DEFAULT_SETTINGS.menus;
      await SETTINGS_REF.set({ menus: settings.menus, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    return settings;
  }
  await SETTINGS_REF.set(DEFAULT_SETTINGS);
  return (await SETTINGS_REF.get()).data();
}

async function getProfile(request, role = 'staff') {
  const user = requireAuth(request);
  const ref = db.doc(`staffProfiles/${user.uid}`);
  let snapshot = await ref.get();
  const email = String(user.token.email || '').toLowerCase();
  const absoluteAdmin = BOOTSTRAP_ADMINS.has(email);
  if (absoluteAdmin && (!snapshot.exists || snapshot.data().role !== 'admin' || snapshot.data().active !== true)) {
    await ref.set({ name: user.token.name || snapshot.data()?.name || '총괄 관리자', email, role: 'admin', active: true, createdAt: snapshot.data()?.createdAt || FieldValue.serverTimestamp(), bootstrap: true, absoluteAdmin: true }, { merge: true });
    snapshot = await ref.get();
  }
  if (!snapshot.exists || snapshot.data().active !== true) throw new HttpsError('permission-denied', '활성화된 직원 계정이 아닙니다.');
  const profile = snapshot.data();
  if (!['staff', 'admin'].includes(profile.role)) throw new HttpsError('permission-denied', '직원 권한이 없습니다.');
  if (role === 'admin' && profile.role !== 'admin') throw new HttpsError('permission-denied', '1급 관리자만 사용할 수 있습니다.');
  return { uid: user.uid, email, ...profile, absoluteAdmin };
}

function normalizeMenus(value, fallback = []) {
  const input = Array.isArray(value) ? value : fallback;
  const menus = [...new Set(input.map((item) => String(item || '').trim()).filter(Boolean))];
  if (!menus.length || menus.length > 20 || menus.some((item) => item.length > 30)) throw new HttpsError('invalid-argument', '메뉴는 1–20개, 메뉴 이름은 30자 이하로 입력해 주세요.');
  return menus;
}

function parseOperationId(value) {
  const id = String(value || '');
  if (!/^[0-9a-f-]{20,64}$/i.test(id)) throw new HttpsError('invalid-argument', '올바른 operationId가 필요합니다.');
  return id;
}

function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

function publicReservation(id, data) {
  return {
    id,
    reservationNo: data.reservationNo,
    studentIdNormalized: data.studentIdNormalized,
    studentName: data.studentName,
    menuName: data.menuName || null,
    currentStatus: data.currentStatus,
    teamsAhead: data.teamsAhead ?? 0,
    holdCount: data.holdCount ?? 0,
    cancelMemo: data.cancelMemo || null,
    missedAt: data.missedAt?.toDate?.().toISOString() || null,
    cookingStartedAt: data.cookingStartedAt?.toDate?.().toISOString() || null,
    cookingCompletedAt: data.cookingCompletedAt?.toDate?.().toISOString() || null,
    createdAt: data.createdAt?.toDate?.().toISOString() || null
  };
}

async function allocateNumber(counterName, prefix) {
  const ref = db.doc(`counters/${counterName}`);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const value = (snapshot.exists ? Number(snapshot.data().value) : 0) + 1;
    transaction.set(ref, { value }, { merge: true });
    return `${prefix}-${String(value).padStart(4, '0')}`;
  });
}

async function addReservationEvent(transaction, reservationRef, reservation, input) {
  if (reservation.lastEventId) transaction.set(db.doc(`reservationEvents/${reservation.lastEventId}`), { undoable: false }, { merge: true });
  const eventRef = db.collection('reservationEvents').doc();
  const event = {
    eventNo: input.eventNo,
    reservationId: reservationRef.id,
    reservationNo: reservation.reservationNo,
    type: input.type,
    occurredAt: FieldValue.serverTimestamp(),
    actorType: input.actorType,
    actorUid: input.actorUid || null,
    actorNameSnapshot: input.actorName,
    targetEventId: input.targetEventId || null,
    lateSeconds: input.lateSeconds ?? null,
    memo: input.memo || null,
    operationId: input.operationId,
    previousSnapshot: input.previousSnapshot || null,
    undoable: Boolean(input.undoable)
  };
  transaction.set(eventRef, event);
  return { eventRef, eventNo: input.eventNo };
}

function snapshotState(data) {
  return {
    currentStatus: data.currentStatus,
    queueOrder: data.queueOrder ?? null,
    teamsAhead: data.teamsAhead ?? null,
    holdCount: data.holdCount ?? 0,
    pickupAt: data.pickupAt || null,
    missedAt: data.missedAt || null,
    cookingStartedAt: data.cookingStartedAt || null,
    cookingCompletedAt: data.cookingCompletedAt || null,
    cancelMemo: data.cancelMemo || null
  };
}

async function normalizeQueue(transaction, mutation = null) {
  const snapshot = await transaction.get(db.collection('reservations').where('currentStatus', 'in', ACTIVE).orderBy('queueOrder'));
  let queue = snapshot.docs.map((item) => ({ ref: item.ref, id: item.id, ...item.data() }));
  if (mutation?.removeId) queue = queue.filter((item) => item.id !== mutation.removeId);
  if (mutation?.moveToEndId) {
    const item = queue.find((entry) => entry.id === mutation.moveToEndId);
    queue = queue.filter((entry) => entry.id !== mutation.moveToEndId);
    if (item) queue.push({ ...item, queueOrder: mutation.queueOrder });
  }
  if (mutation?.restore) {
    queue = queue.filter((item) => item.id !== mutation.restore.id);
    queue.push(mutation.restore);
    queue.sort((a, b) => Number(a.queueOrder || 0) - Number(b.queueOrder || 0));
  }
  queue.forEach((item, index) => {
    const currentStatus = index === 0 && ['preparing', 'ready'].includes(item.currentStatus) ? item.currentStatus : index === 0 ? 'called' : 'waiting';
    transaction.set(item.ref, { currentStatus, teamsAhead: index, queueOrder: item.queueOrder }, { merge: true });
  });
  return queue;
}

async function writeOperationEvent(data) {
  await db.collection('operationEvents').add({ ...data, occurredAt: FieldValue.serverTimestamp() });
}

export const getPublicSettings = onCall(async () => {
  const settings = await ensureSettings();
  const now = Date.now();
  const end = settings.reservationEndAt?.toMillis?.() || Number.MAX_SAFE_INTEGER;
  return {
    eventName: settings.eventName,
    serviceName: settings.serviceName,
    menus: Array.isArray(settings.menus) && settings.menus.length ? settings.menus : DEFAULT_SETTINGS.menus,
    acceptingReservations: settings.acceptingReservations === true,
    acceptingNow: settings.acceptingReservations === true && now <= end,
    reservationStartAt: settings.reservationStartAt?.toDate?.().toISOString(),
    reservationEndAt: settings.reservationEndAt?.toDate?.().toISOString(),
    notice: settings.notice || '',
    breakActive: settings.breakActive === true,
    breakReason: settings.breakReason || null,
    breakPlannedEndAt: settings.breakPlannedEndAt?.toDate?.().toISOString() || null,
    noShowGraceSeconds: settings.noShowGraceSeconds || 60,
    noShowListSeconds: settings.noShowListSeconds || 180
  };
});

export const createReservation = onCall(async (request) => {
  let studentId;
  let studentName;
  try { studentId = normalizeStudentId(request.data?.studentId); studentName = normalizeName(request.data?.studentName); }
  catch (error) { throw new HttpsError('invalid-argument', error.message); }
  const token = String(request.data?.customerToken || '');
  const menuName = String(request.data?.menuName || '').trim();
  if (!/^[0-9a-f]{64}$/i.test(token)) throw new HttpsError('invalid-argument', '고객 token 형식이 올바르지 않습니다.');
  const operationId = parseOperationId(request.data?.operationId);
  const reservationNo = await allocateNumber('reservation', 'R');
  const eventNo = await allocateNumber('reservationEvent', 'H');
  const queueNo = await allocateNumber('queue', 'Q');
  const result = await db.runTransaction(async (transaction) => {
    const operationRef = db.doc(`operations/${operationId}`);
    const operationSnapshot = await transaction.get(operationRef);
    if (operationSnapshot.exists) return operationSnapshot.data().result;
    const settingsSnapshot = await transaction.get(SETTINGS_REF);
    if (!settingsSnapshot.exists) throw new HttpsError('failed-precondition', '행사 설정이 아직 준비되지 않았습니다.');
    const settings = settingsSnapshot.data();
    const menus = normalizeMenus(settings.menus, DEFAULT_SETTINGS.menus);
    if (!menus.includes(menuName)) throw new HttpsError('invalid-argument', '선택한 메뉴를 찾을 수 없습니다.');
    const now = Date.now();
    if (settings.acceptingReservations !== true || now > settings.reservationEndAt.toMillis()) {
      throw new HttpsError('failed-precondition', '현재는 새 예약을 받고 있지 않습니다.', { canLookup: true });
    }
    const duplicate = await transaction.get(db.collection('reservations').where('studentIdNormalized', '==', studentId).limit(1));
    if (!duplicate.empty) {
      const existing = duplicate.docs[0];
      if (existing.data().studentName !== studentName) throw new HttpsError('already-exists', '이 학번으로 이미 다른 이름의 예약이 있습니다.');
      throw new HttpsError('already-exists', '이미 예약되어 있습니다.', { canLookup: true });
    }
    const active = await transaction.get(db.collection('reservations').where('currentStatus', 'in', ACTIVE).orderBy('queueOrder'));
    const queueOrderNumber = Number(queueNo.split('-')[1]);
    const ref = db.collection('reservations').doc();
    const reservation = {
      reservationNo, studentIdNormalized: studentId, studentName, menuName,
      createdAt: FieldValue.serverTimestamp(), queueIndexAtCreation: active.size,
      estimatedWaitMinutes: null, test: false,
      currentStatus: active.empty ? 'called' : 'waiting', queueOrder: queueOrderNumber, teamsAhead: active.size,
      holdCount: 0, customerUid: null, customerTokenHash: hashToken(token),
      pickupAt: null, missedAt: null, cancelMemo: null, lastEventId: null
    };
    const added = await addReservationEvent(transaction, ref, reservation, { eventNo, type: 'apply', actorType: 'customer', actorUid: null, actorName: '본인', operationId, undoable: false });
    reservation.lastEventId = added.eventRef.id;
    transaction.set(ref, reservation);
    const publicData = { ...publicReservation(ref.id, { ...reservation, createdAt: Timestamp.now() }) };
    const operationResult = { created: true, reservation: publicData };
    transaction.set(operationRef, { result: operationResult, createdAt: FieldValue.serverTimestamp() });
    return operationResult;
  });
  return result;
});

export const lookupReservation = onCall(async (request) => {
  let studentId;
  let studentName;
  try { studentId = normalizeStudentId(request.data?.studentId); studentName = normalizeName(request.data?.studentName); }
  catch (error) { throw new HttpsError('invalid-argument', error.message); }
  const snapshot = await db.collection('reservations').where('studentIdNormalized', '==', studentId).limit(1).get();
  if (snapshot.empty || snapshot.docs[0].data().studentName !== studentName) throw new HttpsError('not-found', '학번과 이름이 일치하는 예약이 없습니다.');
  const document = snapshot.docs[0];
  if (request.data?.recordLookup !== false) {
    const operationId = parseOperationId(request.data?.operationId);
    const eventNo = await allocateNumber('reservationEvent', 'H');
    await db.runTransaction(async (transaction) => {
      const current = (await transaction.get(document.ref)).data();
      const added = await addReservationEvent(transaction, document.ref, current, { eventNo, type: 'relookup', actorType: 'customer', actorUid: request.auth?.uid || null, actorName: '본인', operationId, undoable: false });
      transaction.update(document.ref, { lastEventId: added.eventRef.id, relookupCount: FieldValue.increment(1) });
    });
  }
  return { reservation: publicReservation(document.id, document.data()), recoveredViewOnly: true };
});

export const getCustomerReservation = onCall(async (request) => {
  const reservationId = String(request.data?.reservationId || '');
  const token = String(request.data?.customerToken || '');
  if (!reservationId || !/^[0-9a-f]{64}$/i.test(token)) throw new HttpsError('invalid-argument', '예약 token이 올바르지 않습니다.');
  const snapshot = await db.doc(`reservations/${reservationId}`).get();
  if (!snapshot.exists) throw new HttpsError('not-found', '예약이 없습니다.');
  if (snapshot.data().customerTokenHash !== hashToken(token)) throw new HttpsError('permission-denied', '예약 token이 일치하지 않습니다.');
  return { reservation: publicReservation(snapshot.id, snapshot.data()) };
});

export const cancelOwnReservation = onCall(async (request) => {
  const id = String(request.data?.reservationId || '');
  const token = String(request.data?.customerToken || '');
  const operationId = parseOperationId(request.data?.operationId);
  const eventNo = await allocateNumber('reservationEvent', 'H');
  await db.runTransaction(async (transaction) => {
    const ref = db.doc(`reservations/${id}`);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new HttpsError('not-found', '예약이 없습니다.');
    const reservation = snapshot.data();
    if (reservation.customerTokenHash !== hashToken(token)) throw new HttpsError('permission-denied', '최초 예약 기기에서만 취소할 수 있습니다.');
    if (!QUEUED.includes(reservation.currentStatus)) throw new HttpsError('failed-precondition', '조리가 시작되기 전 예약만 취소할 수 있습니다.');
    const previousSnapshot = snapshotState(reservation);
    await normalizeQueue(transaction, { removeId: id });
    const added = await addReservationEvent(transaction, ref, reservation, { eventNo, type: 'cancel', actorType: 'customer', actorUid: null, actorName: '본인', operationId, previousSnapshot, undoable: false });
    transaction.update(ref, { currentStatus: 'cancelled', teamsAhead: null, cancelMemo: '본인 취소', lastEventId: added.eventRef.id, updatedAt: FieldValue.serverTimestamp() });
  });
  return { ok: true };
});

export const getStaffSession = onCall(async (request) => {
  const profile = await getProfile(request);
  await ensureSettings();
  return { profile: { uid: profile.uid, name: profile.name, email: profile.email, role: profile.role, active: profile.active, absoluteAdmin: profile.absoluteAdmin === true } };
});

export const staffAction = onCall(async (request) => {
  const profile = await getProfile(request);
  const reservationId = String(request.data?.reservationId || '');
  const action = String(request.data?.action || '');
  if (!['cooking_start', 'cooking_complete', 'pickup', 'no_show', 'hold', 'cancel'].includes(action)) throw new HttpsError('invalid-argument', '지원하지 않는 처리입니다.');
  const operationId = parseOperationId(request.data?.operationId);
  const eventNo = await allocateNumber('reservationEvent', 'H');
  const queueNo = action === 'hold' ? await allocateNumber('queue', 'Q') : null;
  await db.runTransaction(async (transaction) => {
    const operationRef = db.doc(`operations/${operationId}`);
    if ((await transaction.get(operationRef)).exists) return;
    const ref = db.doc(`reservations/${reservationId}`);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new HttpsError('not-found', '예약이 없습니다.');
    const reservation = snapshot.data();
    const settings = (await transaction.get(SETTINGS_REF)).data();
    const previousSnapshot = snapshotState(reservation);
    let nextStatus = action === 'cooking_start' ? 'preparing' : action === 'cooking_complete' ? 'ready' : action === 'pickup' ? 'picked_up' : action === 'no_show' ? 'no_show' : action === 'cancel' ? 'cancelled' : 'waiting';
    let lateSeconds = null;
    if (action === 'cooking_start' && reservation.currentStatus !== 'called') {
      throw new HttpsError('failed-precondition', '지금 차례인 예약만 조리를 시작할 수 있습니다.');
    } else if (action === 'cooking_complete' && reservation.currentStatus !== 'preparing') {
      throw new HttpsError('failed-precondition', '조리 중인 예약만 조리 완료할 수 있습니다.');
    } else if (reservation.currentStatus === 'no_show' && action === 'pickup') {
      lateSeconds = Math.floor((Date.now() - reservation.missedAt.toMillis()) / 1000);
      if (lateSeconds > Number(settings.noShowGraceSeconds || 60)) throw new HttpsError('failed-precondition', '미수령 후 수령 가능 시간이 지났습니다.');
    } else if (!ACTIVE.includes(reservation.currentStatus)) throw new HttpsError('failed-precondition', '현재 상태에서는 처리할 수 없습니다.');
    if (['no_show', 'hold'].includes(action) && reservation.currentStatus !== 'called') throw new HttpsError('failed-precondition', '지금 차례인 예약만 처리할 수 있습니다.');
    if (action === 'hold') {
      if (reservation.holdCount >= Number(settings.maxHoldCount || 2)) throw new HttpsError('failed-precondition', '보류 최대 횟수를 넘었습니다.');
      const active = await transaction.get(db.collection('reservations').where('currentStatus', 'in', ACTIVE));
      if (active.size <= 1) throw new HttpsError('failed-precondition', '대기 팀이 1팀뿐이라 보류할 수 없습니다.');
    }
    const type = action === 'pickup' ? 'pickup' : action;
    const updates = { currentStatus: nextStatus, updatedAt: FieldValue.serverTimestamp() };
    if (action !== 'hold') updates.teamsAhead = null;
    if (action === 'pickup') updates.pickupAt = FieldValue.serverTimestamp();
    if (action === 'no_show') updates.missedAt = FieldValue.serverTimestamp();
    if (action === 'cooking_start') updates.cookingStartedAt = FieldValue.serverTimestamp();
    if (action === 'cooking_complete') updates.cookingCompletedAt = FieldValue.serverTimestamp();
    if (action === 'cancel') updates.cancelMemo = '직원 취소';
    if (action === 'hold') {
      updates.queueOrder = Number(queueNo.split('-')[1]); updates.holdCount = FieldValue.increment(1);
      await normalizeQueue(transaction, { moveToEndId: reservationId, queueOrder: updates.queueOrder });
    } else if (['pickup', 'no_show', 'cancel'].includes(action) && ACTIVE.includes(reservation.currentStatus)) await normalizeQueue(transaction, { removeId: reservationId });
    const added = await addReservationEvent(transaction, ref, reservation, { eventNo, type, actorType: 'staff', actorUid: profile.uid, actorName: profile.name, operationId, previousSnapshot, lateSeconds, memo: action === 'cancel' ? '직원 취소' : null, undoable: true });
    updates.lastEventId = added.eventRef.id;
    transaction.update(ref, updates);
    transaction.set(operationRef, { result: { ok: true }, createdAt: FieldValue.serverTimestamp() });
  });
  return { ok: true };
});

export const undoReservationEvent = onCall(async (request) => {
  const profile = await getProfile(request);
  const eventId = String(request.data?.eventId || '');
  const operationId = parseOperationId(request.data?.operationId);
  const eventNo = await allocateNumber('reservationEvent', 'H');
  await db.runTransaction(async (transaction) => {
    const eventRef = db.doc(`reservationEvents/${eventId}`);
    const eventSnapshot = await transaction.get(eventRef);
    if (!eventSnapshot.exists) throw new HttpsError('not-found', '기록이 없습니다.');
    const event = eventSnapshot.data();
    const reservationRef = db.doc(`reservations/${event.reservationId}`);
    const reservationSnapshot = await transaction.get(reservationRef);
    const reservation = reservationSnapshot.data();
    if (reservation.lastEventId !== eventId || event.undoable !== true || !event.previousSnapshot) throw new HttpsError('failed-precondition', '가장 최근 상태 변경 기록만 되돌릴 수 있습니다.');
    if (ACTIVE.includes(event.previousSnapshot.currentStatus)) await normalizeQueue(transaction, { restore: { id: reservationRef.id, ref: reservationRef, ...event.previousSnapshot } });
    else if (ACTIVE.includes(reservation.currentStatus)) await normalizeQueue(transaction, { removeId: reservationRef.id });
    const added = await addReservationEvent(transaction, reservationRef, reservation, { eventNo, type: 'undo', actorType: 'staff', actorUid: profile.uid, actorName: profile.name, operationId, targetEventId: eventId, undoable: false });
    const restored = { ...event.previousSnapshot, lastEventId: added.eventRef.id, updatedAt: FieldValue.serverTimestamp() };
    transaction.update(reservationRef, restored);
  });
  return { ok: true };
});

export const setSoldOut = onCall(async (request) => {
  const profile = await getProfile(request);
  const mode = String(request.data?.mode || '');
  if (!['stop_new', 'cancel_waiting', 'reopen'].includes(mode)) throw new HttpsError('invalid-argument', '지원하지 않는 모드입니다.');
  const operationId = parseOperationId(request.data?.operationId);
  await SETTINGS_REF.set({ acceptingReservations: mode === 'reopen', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  let cancelled = 0;
  if (mode === 'cancel_waiting') {
    const active = await db.collection('reservations').where('currentStatus', 'in', QUEUED).get();
    for (const document of active.docs) {
      const eventNo = await allocateNumber('reservationEvent', 'H');
      await db.runTransaction(async (transaction) => {
        const fresh = await transaction.get(document.ref);
        if (!fresh.exists || !QUEUED.includes(fresh.data().currentStatus)) return;
        const reservation = fresh.data();
        const added = await addReservationEvent(transaction, document.ref, reservation, { eventNo, type: 'cancel', actorType: 'staff', actorUid: profile.uid, actorName: profile.name, operationId, previousSnapshot: snapshotState(reservation), memo: '재료 소진', undoable: true });
        transaction.update(document.ref, { currentStatus: 'cancelled', teamsAhead: null, cancelMemo: '재료 소진', lastEventId: added.eventRef.id, updatedAt: FieldValue.serverTimestamp() });
        cancelled += 1;
      });
    }
  }
  await writeOperationEvent({ type: mode === 'reopen' ? '예약 다시 받기' : mode === 'stop_new' ? '새 예약 막음' : '재료 소진', actorUid: profile.uid, actorNameSnapshot: profile.name, content: mode === 'cancel_waiting' ? `대기 ${cancelled}팀 취소` : '', operationId });
  return { ok: true, cancelled };
});

export const updateSettings = onCall(async (request) => {
  const profile = await getProfile(request, 'admin');
  const data = request.data || {};
  const start = new Date(data.reservationStartAt);
  const end = new Date(data.reservationEndAt);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) throw new HttpsError('invalid-argument', '접수 시작·마감 시각을 확인해 주세요.');
  let serviceName;
  let eventName;
  try { serviceName = normalizeName(data.serviceName); eventName = String(data.eventName || '').trim(); } catch (error) { throw new HttpsError('invalid-argument', error.message); }
  if (eventName.length < 2 || eventName.length > 50) throw new HttpsError('invalid-argument', '행사 이름은 2–50자로 입력해 주세요.');
  const updates = {
    eventName, serviceName, menus: normalizeMenus(data.menus, [serviceName]), notice: String(data.notice || '').trim().slice(0, 100),
    reservationStartAt: Timestamp.fromDate(start), reservationEndAt: Timestamp.fromDate(end), acceptingReservations: data.acceptingReservations === true,
    noShowGraceSeconds: Math.max(10, Math.min(600, Number(data.noShowGraceSeconds) || 60)),
    noShowListSeconds: Math.max(30, Math.min(3600, Number(data.noShowListSeconds) || 180)),
    maxHoldCount: Math.max(0, Math.min(10, Number(data.maxHoldCount) || 2)), updatedAt: FieldValue.serverTimestamp()
  };
  await SETTINGS_REF.set(updates, { merge: true });
  await writeOperationEvent({ type: '설정 변경', actorUid: profile.uid, actorNameSnapshot: profile.name, content: JSON.stringify({ ...updates, reservationStartAt: start.toISOString(), reservationEndAt: end.toISOString(), updatedAt: undefined }), operationId: parseOperationId(data.operationId) });
  return { ok: true };
});

export const manageBreak = onCall(async (request) => {
  const profile = await getProfile(request, 'admin');
  const action = String(request.data?.action || '');
  const operationId = parseOperationId(request.data?.operationId);
  const settings = await ensureSettings();
  const now = Timestamp.now();
  let update;
  if (action === 'start') {
    const reason = String(request.data?.reason || '').trim().slice(0, 30);
    const minutes = Math.max(1, Math.min(60, Number(request.data?.minutes) || 10));
    if (!reason) throw new HttpsError('invalid-argument', '쉬는 시간 사유를 입력해 주세요.');
    update = { breakActive: true, breakReason: reason, breakStartedAt: now, breakPlannedEndAt: Timestamp.fromMillis(now.toMillis() + minutes * 60000), breakEndedAt: null };
  } else if (action === 'extend') {
    if (!settings.breakActive) throw new HttpsError('failed-precondition', '현재 쉬는 시간이 아닙니다.');
    update = { breakPlannedEndAt: Timestamp.fromMillis(settings.breakPlannedEndAt.toMillis() + 5 * 60000) };
  } else if (action === 'end') {
    if (!settings.breakActive) throw new HttpsError('failed-precondition', '현재 쉬는 시간이 아닙니다.');
    update = { breakActive: false, breakEndedAt: now };
  } else throw new HttpsError('invalid-argument', '지원하지 않는 쉬는 시간 작업입니다.');
  await SETTINGS_REF.set({ ...update, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await writeOperationEvent({ type: action === 'start' ? '쉬는 시간 시작' : action === 'extend' ? '쉬는 시간 연장' : '쉬는 시간 끝', actorUid: profile.uid, actorNameSnapshot: profile.name, content: action === 'start' ? `${update.breakReason} · ${request.data.minutes}분` : '', operationId });
  return { ok: true };
});

export const createStaffUser = onCall(async (request) => {
  const profile = await getProfile(request, 'admin');
  const email = String(request.data?.email || '').trim().toLowerCase();
  const password = String(request.data?.password || '');
  const name = String(request.data?.name || '').trim().slice(0, 30);
  const role = request.data?.role === 'admin' ? 'admin' : 'staff';
  if (!email.includes('@') || password.length < 8 || name.length < 2) throw new HttpsError('invalid-argument', '직원 이름, 이메일, 8자 이상 임시 비밀번호를 확인해 주세요.');
  const user = await auth.createUser({ email, password, displayName: name, disabled: false });
  await db.doc(`staffProfiles/${user.uid}`).set({ name, email, role, active: true, createdAt: FieldValue.serverTimestamp(), createdBy: profile.uid });
  await writeOperationEvent({ type: '직원 계정 추가', actorUid: profile.uid, actorNameSnapshot: profile.name, content: `${name} · ${role}`, operationId: parseOperationId(request.data?.operationId) });
  return { uid: user.uid };
});

export const updateStaffProfile = onCall(async (request) => {
  const profile = await getProfile(request, 'admin');
  const uid = String(request.data?.uid || '');
  if (!uid) throw new HttpsError('invalid-argument', '직원 UID가 필요합니다.');
  const target = await db.doc(`staffProfiles/${uid}`).get();
  const targetEmail = String(target.data()?.email || '').toLowerCase();
  if (BOOTSTRAP_ADMINS.has(targetEmail) && (request.data.role === 'staff' || request.data.active === false)) throw new HttpsError('failed-precondition', '절대 관리자는 강등하거나 비활성화할 수 없습니다.');
  const updates = { updatedAt: FieldValue.serverTimestamp() };
  if (request.data.role != null) updates.role = request.data.role === 'admin' ? 'admin' : 'staff';
  if (request.data.active != null) updates.active = request.data.active === true;
  await db.doc(`staffProfiles/${uid}`).set(updates, { merge: true });
  if (request.data.active != null) await auth.updateUser(uid, { disabled: request.data.active !== true });
  await writeOperationEvent({ type: request.data.active === false ? '직원 계정 비활성화' : '직원 정보 변경', actorUid: profile.uid, actorNameSnapshot: profile.name, content: uid, operationId: parseOperationId(request.data?.operationId) });
  return { ok: true };
});

export const exportCsv = onCall({ timeoutSeconds: 120, memory: '512MiB' }, async (request) => {
  await getProfile(request, 'admin');
  const type = String(request.data?.type || '');
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  if (type === 'events') {
    const snapshot = await db.collection('reservationEvents').orderBy('occurredAt').get();
    const headers = ['기록번호', '예약번호', '종류', '시각', '처리자', '대상기록', '늦음(초)', '메모'];
    const rows = snapshot.docs.map((item) => { const value = item.data(); return [value.eventNo, value.reservationNo, value.type, koreaDate(value.occurredAt), value.actorNameSnapshot, value.targetEventId, value.lateSeconds, value.memo]; });
    return { filename: `이력_${date}.csv`, content: csvRows(headers, rows) };
  }
  if (type === 'operations') {
    const snapshot = await db.collection('operationEvents').orderBy('occurredAt').get();
    const headers = ['시각', '일', '처리자', '내용'];
    const rows = snapshot.docs.map((item) => { const value = item.data(); return [koreaDate(value.occurredAt), value.type, value.actorNameSnapshot, value.content]; });
    return { filename: `운영기록_${date}.csv`, content: csvRows(headers, rows) };
  }
  if (type === 'summary') {
    const snapshot = await db.collection('reservations').orderBy('createdAt').get();
    const headers = ['예약번호', '학번', '이름', '메뉴', '신청시각', '신청 때 앞 팀 수', '예상 대기(분)', '수령시각', '최종상태', '걸린 시간(분)', '보류 횟수', '늦음(초)', '다시조회 횟수', '테스트'];
    const rows = await Promise.all(snapshot.docs.map(async (item) => {
      const value = item.data();
      const events = await db.collection('reservationEvents').where('reservationId', '==', item.id).get();
      const pickup = events.docs.map((entry) => entry.data()).find((entry) => entry.type === 'pickup' && entry.lateSeconds != null);
      const duration = value.pickupAt && value.createdAt ? ((value.pickupAt.toMillis() - value.createdAt.toMillis()) / 60000).toFixed(1) : '';
      return [value.reservationNo, value.studentIdNormalized, value.studentName, value.menuName || '', koreaDate(value.createdAt), value.queueIndexAtCreation, value.estimatedWaitMinutes, koreaDate(value.pickupAt), value.currentStatus, duration, value.holdCount, pickup?.lateSeconds ?? '', value.relookupCount || 0, value.test ? '예' : '아니오'];
    }));
    return { filename: `요약_${date}.csv`, content: csvRows(headers, rows) };
  }
  throw new HttpsError('invalid-argument', 'CSV 종류가 올바르지 않습니다.');
});

