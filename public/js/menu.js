// 메뉴를 변경할 때 이 배열만 수정하세요.
// id는 영문 소문자·숫자·하이픈만 사용하고, 한 번 사용한 id는 변경하지 않는 것이 좋습니다.
export const MENU_ITEMS = Object.freeze([
  Object.freeze({
    id: 'tteokbokki',
    name: '떡볶이',
    price: 3000,
    description: '매콤달콤한 떡볶이',
    emoji: '🍴',
    available: true
  })
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
