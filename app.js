'use strict';

const menus = [
  { id: 'americano', name: '아메리카노', price: 3000, stock: 20, color: '#604435' },
  { id: 'cafe-latte', name: '카페라떼', price: 3500, stock: 15, color: '#c6a17d' },
  { id: 'vanilla-latte', name: '바닐라라떼', price: 4000, stock: 15, color: '#dbc3a1' },
  { id: 'cafe-mocha', name: '카페모카', price: 4500, stock: 10, color: '#87604b' },
  { id: 'chocolate-latte', name: '초코라떼', price: 4000, stock: 10, color: '#9b7258' },
];
// 현재 단계는 메모리 전용이다. 주문·저장은 다음 단계에서 이 상태를 확장한다.
const state = { inventory: Object.fromEntries(menus.map(menu => [menu.id, menu.stock])), cart: [] };
const won = amount => `${amount.toLocaleString('ko-KR')}원`;

function renderMenus() {
  document.querySelector('#menu-list').innerHTML = menus.map(menu => `
    <article class="menu-card" data-menu="${menu.id}" aria-labelledby="name-${menu.id}">
      <div class="drink-art" aria-hidden="true"><span class="cup" style="--drink:${menu.color}"></span></div>
      <h3 id="name-${menu.id}">${menu.name}</h3>
      <div class="menu-meta"><strong>${won(menu.price)}</strong><span class="stock">남은 재고 ${menu.stock}잔</span></div>
      <fieldset><legend>${menu.name} 옵션</legend>
        <label class="option"><input type="checkbox" data-option="shot" aria-label="${menu.name} 샷 추가 +500원">샷 추가 <span>+500원</span></label>
        <label class="option"><input type="checkbox" data-option="syrup" aria-label="${menu.name} 시럽 추가 +0원">시럽 추가 <span>+0원</span></label>
      </fieldset>
      <p class="unit-price">옵션 포함 단가 <strong data-unit-price>${won(menu.price)}</strong></p>
      <button type="button" class="primary full" data-add="${menu.id}" aria-label="${menu.name} 장바구니 담기">장바구니 담기</button>
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


function itemKey(item) { return `${item.menuId}-${Number(item.shot)}-${Number(item.syrup)}`; }
function menuFor(item) { return menus.find(menu => menu.id === item.menuId); }
function unitPrice(item) { return menuFor(item).price + (item.shot ? 500 : 0); }
function optionText(item) { return [item.shot ? '샷 추가' : '', item.syrup ? '시럽 추가' : ''].filter(Boolean).join(' · ') || '기본'; }
function menuQuantity(menuId) { return state.cart.filter(item => item.menuId === menuId).reduce((sum, item) => sum + item.quantity, 0); }
let announcementTimer;
function announce(message) {
  const output = document.querySelector('#announcement');
  clearTimeout(announcementTimer);
  output.textContent = '';
  announcementTimer = setTimeout(() => { output.textContent = message; }, 20);
}
function renderTotals() {
  document.querySelector('#cart-count').textContent = `${state.cart.reduce((sum, item) => sum + item.quantity, 0)}잔`;
  document.querySelector('#cart-total').textContent = won(state.cart.reduce((sum, item) => sum + unitPrice(item) * item.quantity, 0));
}
function renderCart() {
  document.querySelector('#cart-list').innerHTML = state.cart.length ? state.cart.map(item => {
    const key = itemKey(item);
    const label = `${menuFor(item).name} ${optionText(item)}`;
    return `<article class="cart-item" data-key="${key}">
      <h3>${menuFor(item).name}</h3><p class="muted small">${optionText(item)} · 단가 ${won(unitPrice(item))}</p>
      <div class="quantity-row"><label for="qty-${key}">수량</label><input id="qty-${key}" data-quantity="${key}" type="text" inputmode="numeric" value="${item.quantity}" aria-label="${label} 수량" autocomplete="off"><span>잔</span><button type="button" data-remove="${key}" aria-label="${label} 삭제">삭제</button></div>
      <p class="item-total">항목 금액 <strong data-item-total>${won(unitPrice(item) * item.quantity)}</strong></p>
    </article>`;
  }).join('') : '<p class="empty">장바구니가 비어 있어요.<br>마음에 드는 음료를 골라 주세요.</p>';
  renderTotals();
}
function addItem(menuId, shot, syrup) {
  const menu = menus.find(item => item.id === menuId);
  if (menuQuantity(menuId) >= state.inventory[menuId]) {
    announce(`${menu.name} 재고는 ${state.inventory[menuId]}잔입니다. 모든 옵션의 합계가 재고를 넘을 수 없습니다.`);
    return;
  }
  const candidate = { menuId, shot, syrup, quantity: 1 };
  const existing = state.cart.find(item => itemKey(item) === itemKey(candidate));
  if (existing) existing.quantity += 1;
  else state.cart.push(candidate);
  renderCart();
  announce(`${menu.name} ${optionText(candidate)} 1잔을 담았습니다. 합계 ${document.querySelector('#cart-total').textContent}.`);
}
function changeQuantity(input) {
  const item = state.cart.find(item => itemKey(item) === input.dataset.quantity);
  if (!item) return;
  const raw = input.value.trim();
  const quantity = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(quantity) || quantity < 1) {
    input.value = String(item.quantity);
    announce('수량은 1 이상의 안전한 정수로 입력해 주세요. 기존 수량을 유지합니다.');
    return;
  }
  const available = state.inventory[item.menuId] - (menuQuantity(item.menuId) - item.quantity);
  if (quantity > available) {
    input.value = String(item.quantity);
    announce(`${menuFor(item).name}의 다른 옵션 수량을 포함하면 재고를 초과합니다. 이 항목은 최대 ${available}잔까지 가능합니다.`);
    return;
  }
  if (quantity === item.quantity) { input.value = String(quantity); return; }
  item.quantity = quantity;
  input.value = String(quantity);
  // 입력 요소를 유지해 키보드 포커스와 이어지는 삭제 클릭을 보존한다.
  input.closest('.cart-item').querySelector('[data-item-total]').textContent = won(unitPrice(item) * quantity);
  renderTotals();
  announce(`${menuFor(item).name} ${optionText(item)} ${quantity}잔으로 변경했습니다. 합계 ${document.querySelector('#cart-total').textContent}.`);
}
document.querySelector('#menu-list').addEventListener('change', event => {
  if (!event.target.matches('[data-option]')) return;
  const card = event.target.closest('[data-menu]');
  const menu = menus.find(menu => menu.id === card.dataset.menu);
  card.querySelector('[data-unit-price]').textContent = won(menu.price + (card.querySelector('[data-option="shot"]').checked ? 500 : 0));
});
document.querySelector('#menu-list').addEventListener('click', event => {
  const button = event.target.closest('[data-add]');
  if (!button) return;
  const card = button.closest('[data-menu]');
  addItem(button.dataset.add, card.querySelector('[data-option="shot"]').checked, card.querySelector('[data-option="syrup"]').checked);
});
document.querySelector('#cart-list').addEventListener('change', event => {
  if (event.target.matches('[data-quantity]')) changeQuantity(event.target);
});
document.querySelector('#cart-list').addEventListener('keydown', event => {
  if (event.key === 'Enter' && event.target.matches('[data-quantity]')) {
    event.preventDefault();
    changeQuantity(event.target);
  }
});
document.querySelector('#cart-list').addEventListener('click', event => {
  const button = event.target.closest('[data-remove]');
  if (!button) return;
  const index = state.cart.findIndex(item => itemKey(item) === button.dataset.remove);
  if (index < 0) return;
  const [removed] = state.cart.splice(index, 1);
  renderCart();
  const next = state.cart[Math.min(index, state.cart.length - 1)];
  const focusTarget = next ? document.querySelector(`[data-remove="${itemKey(next)}"]`) : document.querySelector(`[data-add="${removed.menuId}"]`);
  focusTarget.focus();
  announce(`${menuFor(removed).name} ${optionText(removed)} 항목을 삭제했습니다.${state.cart.length ? '' : ' 장바구니가 비었습니다.'}`);
});
renderCart();
