// 메뉴를 추가할 때 아래 배열에 한 줄만 더하세요.
// 형식: menu('영문-id', '표시 이름', 가격, '설명', '이모지', 판매여부)
// 예시: menu('ramyeon', '라면', 2500, '따뜻한 국물 라면', '🍜')
// id는 영문 소문자·숫자·하이픈만 사용하고, 한 번 사용한 id는 변경하지 않는 것이 좋습니다.
const menu = (id, name, price, description = '', emoji = '🍴', available = true) => Object.freeze({
  id, name, price, description, emoji, available
});

export const MENU_ITEMS = Object.freeze([
  //menu('영문-id', '표시 이름', 가격, '설명', '이모지', 판매여부)
  menu('tteokbokki', '떡볶이', 3000, '매콤달콤한 떡볶이', '🍴')
]);

export function availableMenuItems() {
  return MENU_ITEMS.filter((menu) => menu.available !== false);
}

export function findMenu(menuId) {
  return MENU_ITEMS.find((menu) => menu.id === menuId) || null;
}

export function formatPrice(price) {
  return `${Number(price || 0).toLocaleString('ko-KR')}원`;
}
