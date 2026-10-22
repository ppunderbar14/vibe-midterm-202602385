'use strict';

const menus = [
  { id: 'americano', name: '아메리카노', price: 3000, stock: 20, color: '#604435' },
  { id: 'cafe-latte', name: '카페라떼', price: 3500, stock: 15, color: '#c6a17d' },
  { id: 'vanilla-latte', name: '바닐라라떼', price: 4000, stock: 15, color: '#dbc3a1' },
  { id: 'cafe-mocha', name: '카페모카', price: 4500, stock: 10, color: '#87604b' },
  { id: 'chocolate-latte', name: '초코라떼', price: 4000, stock: 10, color: '#9b7258' },
];
const STORAGE_KEY = 'cafe-order-app';
let state = null;
let storageError = '';
let processing = false;
let quantityProblem = null;
const won = amount => `${amount.toLocaleString('ko-KR')}원`;
const clone = value => JSON.parse(JSON.stringify(value));
const menuFor = item => menus.find(menu => menu.id === item.menuId);
const itemKey = item => `${item.menuId}-${Number(item.shot)}-${Number(item.syrup)}`;
const unitPrice = item => menuFor(item).price + (item.shot ? 500 : 0);
const optionText = item => [item.shot ? '샷 추가' : '', item.syrup ? '시럽 추가' : ''].filter(Boolean).join(' · ') || '기본';
const orderId = number => `ORD-${String(number).padStart(4, '0')}`;
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

function initialState() {
  return { schemaVersion: 1, inventory: Object.fromEntries(menus.map(menu => [menu.id, menu.stock])), cart: [], orders: [], nextOrderNumber: 1 };
}
function requireData(condition, message) {
  if (!condition) throw new Error(`저장 데이터 오류: ${message}`);
}
function keysAre(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function safeInteger(value, min = 0) { return Number.isSafeInteger(value) && value >= min; }
function safeSum(values) {
  return values.reduce((sum, value) => {
    requireData(safeInteger(value) && safeInteger(sum + value), '합계가 안전한 정수 범위를 벗어났습니다.');
    return sum + value;
  }, 0);
}
function validTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}
function validateCartItem(item) {
  requireData(keysAre(item, ['menuId', 'shot', 'syrup', 'quantity']), '장바구니 항목 구조가 올바르지 않습니다.');
  requireData(Boolean(menuFor(item)), '알 수 없는 메뉴입니다.');
  requireData(typeof item.shot === 'boolean' && typeof item.syrup === 'boolean', '옵션은 선택값이어야 합니다.');
  requireData(safeInteger(item.quantity, 1), '수량은 1 이상의 안전한 정수여야 합니다.');
  requireData(safeInteger(unitPrice(item) * item.quantity), '장바구니 금액이 너무 큽니다.');
}
function validateState(value) {
  requireData(keysAre(value, ['schemaVersion', 'inventory', 'cart', 'orders', 'nextOrderNumber']), '필수 저장 구조가 올바르지 않습니다.');
  requireData(value.schemaVersion === 1, '지원하지 않는 버전입니다.');
  requireData(keysAre(value.inventory, menus.map(menu => menu.id)), '재고 메뉴 구성이 올바르지 않습니다.');
  requireData(Object.values(value.inventory).every(stock => safeInteger(stock)), '재고는 0 이상의 안전한 정수여야 합니다.');
  requireData(Array.isArray(value.cart) && Array.isArray(value.orders), '장바구니와 주문은 목록이어야 합니다.');
  requireData(safeInteger(value.nextOrderNumber, 1), '다음 주문번호가 올바르지 않습니다.');
  value.cart.forEach(validateCartItem);
  requireData(new Set(value.cart.map(itemKey)).size === value.cart.length, '중복 장바구니 항목입니다.');
  // 재고보다 많은 정상 형태의 장바구니도 복원하며, 주문 단계에서 부족을 차단한다.
  menus.forEach(menu => safeSum(value.cart.filter(item => item.menuId === menu.id).map(item => item.quantity)));
  safeSum(value.cart.map(item => unitPrice(item) * item.quantity));
  const numbers = new Set();
  let maxNumber = 0;
  for (const order of value.orders) {
    requireData(keysAre(order, ['id', 'createdAt', 'items', 'total', 'status', 'completedAt']), '주문 구조가 올바르지 않습니다.');
    requireData(typeof order.id === 'string' && /^ORD-\d{4,}$/.test(order.id), '주문번호 형식이 올바르지 않습니다.');
    const number = Number(order.id.slice(4));
    requireData(safeInteger(number, 1) && orderId(number) === order.id && !numbers.has(number), '주문번호가 잘못되었거나 중복됩니다.');
    numbers.add(number);
    maxNumber = Math.max(maxNumber, number);
    requireData(validTime(order.createdAt), '주문 시각이 올바르지 않습니다.');
    requireData(['pending', 'completed'].includes(order.status), '주문 상태가 올바르지 않습니다.');
    requireData(order.status === 'pending' ? order.completedAt === null : validTime(order.completedAt) && order.completedAt >= order.createdAt, '완료 시각이 올바르지 않습니다.');
    requireData(Array.isArray(order.items) && order.items.length > 0, '빈 주문 또는 잘못된 주문 항목입니다.');
    const itemKeys = new Set();
    for (const item of order.items) {
      requireData(keysAre(item, ['menuId', 'menuName', 'basePrice', 'shot', 'syrup', 'optionPrice', 'unitPrice', 'quantity', 'lineTotal']), '주문 항목 구조가 올바르지 않습니다.');
      requireData(Boolean(menuFor(item)) && typeof item.menuName === 'string' && item.menuName.trim().length > 0 && item.menuName.length <= 100, '주문 메뉴가 올바르지 않습니다.');
      requireData(typeof item.shot === 'boolean' && typeof item.syrup === 'boolean' && safeInteger(item.quantity, 1), '주문 옵션·수량이 올바르지 않습니다.');
      requireData(safeInteger(item.basePrice, 1) && item.optionPrice === (item.shot ? 500 : 0), '주문 기본 가격·옵션 금액이 올바르지 않습니다.');
      requireData(safeInteger(item.unitPrice, 1) && item.unitPrice === item.basePrice + item.optionPrice, '확정 단가가 올바르지 않습니다.');
      requireData(safeInteger(item.lineTotal, 1) && item.lineTotal === item.unitPrice * item.quantity, '주문 항목 금액이 올바르지 않습니다.');
      requireData(!itemKeys.has(itemKey(item)), '중복 주문 항목입니다.');
      itemKeys.add(itemKey(item));
    }
    requireData(safeInteger(order.total, 1) && order.total === safeSum(order.items.map(item => item.lineTotal)), '주문 총액이 올바르지 않습니다.');
  }
  requireData(maxNumber < Number.MAX_SAFE_INTEGER && value.nextOrderNumber === maxNumber + 1, '주문번호 순서가 올바르지 않습니다.');
  return value;
}
function readState() {
  let raw;
  try { raw = localStorage.getItem(STORAGE_KEY); }
  catch { throw new Error('저장소를 읽을 수 없습니다. 브라우저 저장소 설정을 확인해 주세요.'); }
  if (raw === null) return null;
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error('저장 데이터의 JSON이 손상되었습니다. 자동 초기화하지 않습니다.'); }
  return validateState(parsed);
}
function latestState() {
  const latest = readState();
  if (!latest) throw new Error('기존 저장 데이터가 없어졌습니다. 새로고침해 상태를 확인해 주세요.');
  return latest;
}
function writeState(candidate) {
  validateState(candidate);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(candidate)); }
  catch { throw new Error('저장에 실패했습니다. 기존 주문·재고·장바구니를 유지합니다. 저장소 설정이나 용량을 확인한 뒤 새로고침해 주세요.'); }
  state = candidate;
}
function blockStorage(error) {
  storageError = `${error.message} 데이터 보호를 위해 변경 작업을 중지했습니다.`;
  document.querySelector('#storage-error').textContent = storageError;
  document.querySelector('#storage-error').hidden = false;
  document.querySelector('#announcement').textContent = '';
  syncControls();
}
let announcementTimer;
function announce(message) {
  const output = document.querySelector('#announcement');
  clearTimeout(announcementTimer);
  output.textContent = '';
  announcementTimer = setTimeout(() => { if (!storageError) output.textContent = message; }, 20);
}
function menuQuantity(menuId, source = state) {
  return safeSum(source.cart.filter(item => item.menuId === menuId).map(item => item.quantity));
}
function shortages(source) {
  return menus.filter(menu => menuQuantity(menu.id, source) > source.inventory[menu.id]).map(menu =>
    `${menu.name}: 요청 ${menuQuantity(menu.id, source)}잔, 가용 ${source.inventory[menu.id]}잔`);
}
function syncControls() {
  const blocked = Boolean(storageError) || !state || processing;
  document.querySelectorAll('[data-add]').forEach(button => {
    const soldOut = state?.inventory[button.dataset.add] === 0;
    button.disabled = blocked || soldOut;
    button.textContent = soldOut ? '품절' : '장바구니 담기';
  });
  document.querySelectorAll('[data-option], [data-quantity], [data-remove]').forEach(input => { input.disabled = blocked; });
  document.querySelectorAll('[data-complete-order]').forEach(button => { button.disabled = blocked; });
  const button = document.querySelector('#place-order');
  button.disabled = blocked || !state.cart.length;
  button.textContent = processing ? '주문 처리 중…' : '주문 확정';
}
function renderMenus() {
  // 메뉴와 옵션 DOM은 최초 한 번만 만들고 이후 재고와 버튼만 갱신한다.
  document.querySelector('#menu-list').innerHTML = menus.map(menu => `
    <article class="menu-card" data-menu="${menu.id}" aria-labelledby="name-${menu.id}">
      <div class="drink-art" aria-hidden="true"><span class="cup" style="--drink:${menu.color}"></span></div>
      <h3 id="name-${menu.id}">${menu.name}</h3>
      <div class="menu-meta"><strong>${won(menu.price)}</strong><span class="stock"></span></div>
      <fieldset><legend>${menu.name} 옵션</legend>
        <label class="option"><input type="checkbox" data-option="shot" aria-label="${menu.name} 샷 추가 +500원">샷 추가 <span>+500원</span></label>
        <label class="option"><input type="checkbox" data-option="syrup" aria-label="${menu.name} 시럽 추가 +0원">시럽 추가 <span>+0원</span></label>
      </fieldset>
      <p class="unit-price">옵션 포함 단가 <strong data-unit-price>${won(menu.price)}</strong></p>
      <button type="button" class="primary full" data-add="${menu.id}" aria-label="${menu.name} 장바구니 담기">장바구니 담기</button>
    </article>`).join('');
}
function renderInventory() {
  menus.forEach(menu => {
    const stock = state?.inventory[menu.id];
    document.querySelector(`[data-menu="${menu.id}"] .stock`).textContent = stock === undefined ? '재고 확인 불가' : stock === 0 ? '품절 · 남은 재고 0잔' : `남은 재고 ${stock}잔`;
  });
  document.querySelector('#inventory-list').innerHTML = menus.map(menu => {
    const stock = state?.inventory[menu.id];
    return `<li><span>${menu.name}</span><strong>${stock === undefined ? '확인 불가' : stock === 0 ? '품절 · 0잔' : `${stock}잔`}</strong></li>`;
  }).join('');
  syncControls();
}
function renderTotals() {
  const cart = state?.cart || [];
  document.querySelector('#cart-count').textContent = `${safeSum(cart.map(item => item.quantity))}잔`;
  document.querySelector('#cart-total').textContent = won(safeSum(cart.map(item => unitPrice(item) * item.quantity)));
  const shortage = state ? shortages(state) : [];
  document.querySelector('#cart-error').textContent = shortage.length ? `재고 부족으로 주문할 수 없습니다. ${shortage.join(' / ')}. 수량을 줄이거나 항목을 삭제해 주세요.` : '';
  document.querySelector('#cart-error').hidden = !shortage.length;
  syncControls();
}
function renderCart() {
  document.querySelector('#cart-list').innerHTML = state?.cart.length ? state.cart.map(item => {
    const key = itemKey(item);
    const label = `${menuFor(item).name} ${optionText(item)}`;
    return `<article class="cart-item" data-key="${key}">
      <h3>${menuFor(item).name}</h3><p class="muted small">${optionText(item)} · 단가 ${won(unitPrice(item))}</p>
      <div class="quantity-row"><label for="qty-${key}">수량</label><input id="qty-${key}" data-quantity="${key}" type="text" inputmode="numeric" value="${item.quantity}" aria-label="${label} 수량" autocomplete="off"><span>잔</span><button type="button" data-remove="${key}" aria-label="${label} 삭제">삭제</button></div>
      <p class="item-total">항목 금액 <strong data-item-total>${won(unitPrice(item) * item.quantity)}</strong></p>
    </article>`;
  }).join('') : `<p class="empty">${state ? '장바구니가 비어 있어요.<br>마음에 드는 음료를 골라 주세요.' : '저장 데이터를 확인할 수 없습니다.'}</p>`;
  quantityProblem = null;
  renderTotals();
}
function orderedOrders() {
  return state ? [...state.orders].sort((first, second) => {
    if (first.status !== second.status) return first.status === 'pending' ? -1 : 1;
    const byTime = Date.parse(second.createdAt) - Date.parse(first.createdAt);
    return byTime || Number(second.id.slice(4)) - Number(first.id.slice(4));
  }) : [];
}
function renderOrderCards(target, admin = false) {
  target.innerHTML = state?.orders.length ? orderedOrders().map(order => `
    <article class="order-card" data-order="${order.id}">
      <div class="order-heading"><h3 tabindex="-1" data-order-heading="${order.id}" data-order-id="${order.id}">${order.id}</h3><strong class="order-status">${order.status === 'pending' ? '접수' : '제조 완료'}</strong></div>
      <p class="muted small"><time datetime="${order.createdAt}">주문 ${escapeHtml(new Date(order.createdAt).toLocaleString('ko-KR'))}</time></p>
      <ul class="order-items">${order.items.map(item => `<li><div><strong>${escapeHtml(item.menuName)}</strong><p class="small">${optionText(item)} · ${item.quantity}잔</p><p class="muted small">기본 ${won(item.basePrice)} + 옵션 ${won(item.optionPrice)} · 확정 단가 ${won(item.unitPrice)}</p></div><strong>${won(item.lineTotal)}</strong></li>`).join('')}</ul>
      <p class="order-total">총액 <strong>${won(order.total)}</strong></p>
      ${order.completedAt ? `<p class="muted small completion-time"><time datetime="${order.completedAt}">제조 완료 ${escapeHtml(new Date(order.completedAt).toLocaleString('ko-KR'))}</time></p>` : ''}
      ${admin && order.status === 'pending' ? `<button type="button" class="primary completion-button" data-complete-order="${order.id}" aria-label="${order.id} 제조 완료"${processing || storageError ? ' disabled' : ''}>제조 완료</button>` : ''}
    </article>`).join('') : `<p class="empty">${state ? '아직 접수된 주문이 없습니다.' : '저장된 주문을 확인할 수 없습니다.'}</p>`;
}
function renderOrders() {
  renderOrderCards(document.querySelector('#customer-orders'));
  renderOrderCards(document.querySelector('#admin-orders'), true);
  syncControls();
}
function completeOrder(id) {
  if (storageError || processing) return;
  const visibleOrder = state?.orders.find(order => order.id === id);
  if (!visibleOrder || visibleOrder.status !== 'pending') return;
  processing = true;
  syncControls();
  try {
    const candidate = clone(latestState());
    const order = candidate.orders.find(entry => entry.id === id);
    if (!order || order.status !== 'pending') return;
    order.status = 'completed';
    order.completedAt = new Date().toISOString();
    writeState(candidate);
    renderOrders();
    document.querySelector(`#admin-orders [data-order-heading="${id}"]`)?.focus();
    announce(`${id} 주문을 제조 완료 처리했습니다. 재고와 주문 금액은 변경하지 않았습니다.`);
  } catch (error) { blockStorage(error); }
  finally { processing = false; syncControls(); }
}
function addItem(menuId, shot, syrup) {
  if (storageError || processing) return;
  try {
    const candidate = clone(latestState());
    const menu = menus.find(item => item.id === menuId);
    if (menuQuantity(menuId, candidate) >= candidate.inventory[menuId]) {
      announce(`${menu.name} 재고는 ${candidate.inventory[menuId]}잔입니다. 모든 옵션의 합계가 재고를 넘을 수 없습니다.`);
      return;
    }
    const item = { menuId, shot, syrup, quantity: 1 };
    const existing = candidate.cart.find(entry => itemKey(entry) === itemKey(item));
    if (existing) existing.quantity += 1;
    else candidate.cart.push(item);
    writeState(candidate);
    renderCart();
    renderInventory();
    announce(`${menu.name} ${optionText(item)} 1잔을 담았습니다. 합계 ${document.querySelector('#cart-total').textContent}.`);
  } catch (error) { blockStorage(error); }
}
function changeQuantity(input) {
  if (storageError || processing) return false;
  const key = input.dataset.quantity;
  const previous = state.cart.find(item => itemKey(item) === key);
  if (!previous) return false;
  const raw = input.value.trim();
  const quantity = Number(raw);
  function reject(message) {
    input.value = String(previous.quantity);
    quantityProblem = input;
    announce(message);
    return false;
  }
  if (!/^\d+$/.test(raw) || !safeInteger(quantity, 1)) return reject('수량은 1 이상의 안전한 정수로 입력해 주세요. 기존 수량을 유지합니다.');
  try {
    const candidate = clone(latestState());
    const item = candidate.cart.find(item => itemKey(item) === key);
    if (!item) throw new Error('저장된 장바구니가 변경되었습니다. 새로고침해 주세요.');
    const available = candidate.inventory[item.menuId] - (menuQuantity(item.menuId, candidate) - item.quantity);
    // 재고 초과로 복원된 항목은 아직 부족하더라도 줄이는 조작을 허용한다.
    if (quantity > available && quantity > item.quantity) return reject(`${menuFor(item).name}의 옵션 합계가 재고를 초과합니다. 수량을 줄이거나 항목을 삭제해 주세요.`);
    if (quantity !== item.quantity) {
      item.quantity = quantity;
      writeState(candidate);
    }
    input.value = String(quantity);
    quantityProblem = null;
    input.closest('.cart-item').querySelector('[data-item-total]').textContent = won(unitPrice(item) * quantity);
    renderTotals();
    renderInventory();
    announce(`${menuFor(item).name} ${optionText(item)} ${quantity}잔입니다. 합계 ${document.querySelector('#cart-total').textContent}.`);
    return true;
  } catch (error) {
    input.value = String(previous.quantity);
    blockStorage(error);
    return false;
  }
}
function flushQuantities() {
  for (const input of document.querySelectorAll('[data-quantity]')) {
    const item = state.cart.find(item => itemKey(item) === input.dataset.quantity);
    if (item && input.value !== String(item.quantity) && !changeQuantity(input)) {
      input.focus();
      return false;
    }
  }
  if (quantityProblem?.isConnected) {
    const input = quantityProblem;
    quantityProblem = null;
    input.focus();
    announce('잘못된 수량을 기존 값으로 되돌렸습니다. 수량을 확인한 뒤 다시 주문해 주세요.');
    return false;
  }
  return !storageError;
}
function placeOrder() {
  if (processing || storageError || !state?.cart.length || !flushQuantities()) return;
  processing = true;
  syncControls();
  try {
    const candidate = clone(latestState());
    if (!candidate.cart.length) { announce('저장된 장바구니가 비어 있어 주문하지 않았습니다. 새로고침해 주세요.'); return; }
    const shortage = shortages(candidate);
    if (shortage.length) { announce(`주문을 접수하지 않았습니다. 재고 부족: ${shortage.join(' / ')}.`); return; }
    if (candidate.nextOrderNumber >= Number.MAX_SAFE_INTEGER) throw new Error('주문번호가 안전한 범위를 넘어 새 주문을 저장할 수 없습니다.');
    const order = {
      id: orderId(candidate.nextOrderNumber), createdAt: new Date().toISOString(),
      items: candidate.cart.map(item => ({
        menuId: item.menuId, menuName: menuFor(item).name, basePrice: menuFor(item).price,
        shot: item.shot, syrup: item.syrup, optionPrice: item.shot ? 500 : 0,
        unitPrice: unitPrice(item), quantity: item.quantity, lineTotal: unitPrice(item) * item.quantity,
      })),
      total: safeSum(candidate.cart.map(item => unitPrice(item) * item.quantity)), status: 'pending', completedAt: null,
    };
    menus.forEach(menu => { candidate.inventory[menu.id] -= menuQuantity(menu.id, candidate); });
    candidate.orders.push(order);
    candidate.cart = [];
    candidate.nextOrderNumber += 1;
    // 주문과 재고를 한 번에 저장하며 성공할 때까지 메모리를 변경하지 않는다.
    writeState(candidate);
    renderCart();
    renderInventory();
    renderOrders();
    document.querySelector(`[data-order-id="${order.id}"]`).focus();
    announce(`${order.id} 주문을 접수했습니다. 총액 ${won(order.total)}입니다.`);
  } catch (error) { blockStorage(error); }
  finally { processing = false; syncControls(); }
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
  if (!button || storageError || processing) return;
  try {
    const candidate = clone(latestState());
    const index = candidate.cart.findIndex(item => itemKey(item) === button.dataset.remove);
    if (index < 0) throw new Error('저장된 장바구니가 변경되었습니다. 새로고침해 주세요.');
    const [removed] = candidate.cart.splice(index, 1);
    writeState(candidate);
    renderCart();
    renderInventory();
    const next = state.cart[Math.min(index, state.cart.length - 1)];
    const focusTarget = next ? document.querySelector(`[data-remove="${itemKey(next)}"]`) : document.querySelector(`[data-add="${removed.menuId}"]`);
    if (!focusTarget.disabled) focusTarget.focus();
    else document.querySelector('#cart-title').focus();
    announce(`${menuFor(removed).name} ${optionText(removed)} 항목을 삭제했습니다.${state.cart.length ? '' : ' 장바구니가 비었습니다.'}`);
  } catch (error) { blockStorage(error); }
});
document.querySelector('#admin-orders').addEventListener('click', event => {
  const button = event.target.closest('[data-complete-order]');
  if (button) completeOrder(button.dataset.completeOrder);
});
document.querySelector('#place-order').addEventListener('click', placeOrder);
renderMenus();
try {
  const saved = readState();
  if (saved) state = saved;
  else writeState(initialState());
} catch (error) { blockStorage(error); }
renderCart();
renderInventory();
renderOrders();
