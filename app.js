'use strict';

const menus = [
  { id: 'americano', name: '아메리카노', price: 3000, stock: 20, color: '#604435' },
  { id: 'cafe-latte', name: '카페라떼', price: 3500, stock: 15, color: '#c6a17d' },
  { id: 'vanilla-latte', name: '바닐라라떼', price: 4000, stock: 15, color: '#dbc3a1' },
  { id: 'cafe-mocha', name: '카페모카', price: 4500, stock: 10, color: '#87604b' },
  { id: 'chocolate-latte', name: '초코라떼', price: 4000, stock: 10, color: '#9b7258' },
];
const won = amount => `${amount.toLocaleString('ko-KR')}원`;

function renderMenus() {
  document.querySelector('#menu-list').innerHTML = menus.map(menu => `
    <article class="menu-card" data-menu="${menu.id}" aria-labelledby="name-${menu.id}">
      <div class="drink-art" aria-hidden="true"><span class="cup" style="--drink:${menu.color}"></span></div>
      <h3 id="name-${menu.id}">${menu.name}</h3>
      <div class="menu-meta"><strong>${won(menu.price)}</strong><span class="stock">남은 재고 ${menu.stock}잔</span></div>
      <button type="button" class="full" disabled>메뉴 선택 준비 중</button>
    </article>`).join('');
  document.querySelector('#inventory-list').innerHTML = menus.map(menu => `<li><span>${menu.name}</span><strong>${menu.stock}잔</strong></li>`).join('');
}

document.querySelectorAll('[data-view]').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-view]').forEach(item => {
      const selected = item === button;
      item.setAttribute('aria-pressed', String(selected));
      document.querySelector(`#${item.dataset.view}-view`).hidden = !selected;
    });
  });
});
renderMenus();
