// GENERATED FROM public/js/menu.js. Run `npm run sync:menu` after editing the menu.
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
