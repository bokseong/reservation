export function normalizeStudentId(input) {
  const digits = String(input ?? '').replace(/\D/g, '');
  let normalized = digits;
  if (digits.length === 5) normalized = `${digits[0]}${digits[2]}${digits.slice(3)}`;
  if (!/^[1-3][1-8]\d{2}$/.test(normalized)) throw new Error('학번은 학년 1–3, 반 1–8인 4자리 형식이어야 합니다.');
  return normalized;
}

export function normalizeName(input) {
  const value = String(input ?? '').trim().replace(/\s+/g, ' ');
  if (!/^[가-힣A-Za-z][가-힣A-Za-z ]{1,19}$/.test(value)) throw new Error('이름을 2–20자로 입력해 주세요.');
  return value;
}

export function csvEscape(value) {
  if (value == null) return '';
  const string = String(value);
  return /[",\r\n]/.test(string) ? `"${string.replace(/"/g, '""')}"` : string;
}

export function csvRows(headers, rows) {
  return [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n');
}

export function koreaDate(timestamp) {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const values = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
}

