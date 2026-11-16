import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStudentId, normalizeName, csvEscape, csvRows } from '../functions/lib.js';

test('4자리 학번을 그대로 정규화한다', () => {
  assert.equal(normalizeStudentId('2315'), '2315');
});

test('5자리 학번을 4자리로 정규화한다', () => {
  assert.equal(normalizeStudentId('20205'), '2205');
});

test('허용 범위를 벗어난 학년과 반을 거부한다', () => {
  assert.throws(() => normalizeStudentId('4912'));
  assert.throws(() => normalizeStudentId('1901'));
});

test('이름의 앞뒤 공백과 중복 공백을 정리한다', () => {
  assert.equal(normalizeName('  김  복성  '), '김 복성');
});

test('CSV 특수문자를 Excel 호환 형식으로 이스케이프한다', () => {
  assert.equal(csvEscape('가,나'), '"가,나"');
  assert.equal(csvEscape('"확인"'), '"""확인"""');
  assert.equal(csvRows(['이름', '메모'], [['김복성', '가,나']]), '이름,메모\r\n김복성,"가,나"');
});

