import test from 'node:test';
import assert from 'node:assert/strict';
import { MENU_ITEMS, availableMenuItems, findMenu } from '../functions/menu.js';

test('메뉴 설정의 id, 이름, 가격 형식이 올바르다', () => {
  assert.ok(MENU_ITEMS.length > 0);
  const ids = new Set();
  const names = new Set();

  for (const menu of MENU_ITEMS) {
    assert.match(menu.id, /^[a-z0-9-]+$/);
    assert.ok(!ids.has(menu.id), `중복 메뉴 id: ${menu.id}`);
    assert.ok(typeof menu.name === 'string' && menu.name.trim().length > 0);
    assert.ok(!names.has(menu.name), `중복 메뉴 이름: ${menu.name}`);
    assert.ok(Number.isInteger(menu.price) && menu.price >= 0);
    ids.add(menu.id);
    names.add(menu.name);
  }
});

test('판매 가능한 메뉴만 조회하고 id로 찾을 수 있다', () => {
  const available = availableMenuItems();
  assert.ok(available.every((menu) => menu.available !== false));
  assert.equal(findMenu(MENU_ITEMS[0].id)?.name, MENU_ITEMS[0].name);
  assert.equal(findMenu('missing-menu'), null);
});
