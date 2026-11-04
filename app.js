const pages = ['home', 'import', 'profit', 'market'];

const labels = {
  home: 'Обзор',
  import: 'Импорт из Китая',
  profit: 'Прибыль товара',
  market: 'Аналитика WB и Ozon'
};

const HISTORY_KEY = 'seller_import_pro_history';
const MARKET_KEY = 'seller_import_pro_market_products';

const v = id => Number(document.getElementById(id).value || 0);
const money = n => new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  maximumFractionDigits: 2
}).format(Number.isFinite(n) ? n : 0);

function openPage(p) {
  pages.forEach(x => {
    document.getElementById(x).classList.toggle('active', x === p);
  });
  document.getElementById('crumb').textContent = labels[p];
  document.querySelectorAll('nav button').forEach(b => {
    b.classList.toggle('active', b.dataset.view === p);
  });
  scrollTo(0, 0);
}

document.querySelectorAll('[data-view]').forEach(b => {
  b.onclick = () => openPage(b.dataset.view);
});
document.querySelectorAll('[data-go]').forEach(b => {
  b.onclick = () => openPage(b.dataset.go);
});

// История расчётов: совместима с ранее сохранёнными записями.
function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveHistory(item) {
  const history = getHistory();
  history.unshift({
    id: Date.now() + Math.random(),
    date: new Date().toLocaleString('ru-RU'),
    ...item
  });
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 100)));
  renderHistory();
}

function renderHistory() {
  const container = document.getElementById('historyList');
  if (!container) return;
  container.replaceChildren();

  const filter = document.getElementById('historyFilter')?.value || 'all';
  const history = getHistory().filter(item => filter === 'all' || item.type === filter);

  if (!history.length) {
    container.textContent = 'История пока пуста.';
    return;
  }

  history.forEach(item => {
    const card = document.createElement('div');
    card.style.cssText = 'padding:14px;margin:12px 0;border:1px solid #555;border-radius:12px';

    const title = document.createElement('h3');
    title.textContent = item.type === 'import' ? 'Импорт из Китая' : 'Расчёт прибыли';
    const details = document.createElement('p');
    details.textContent = item.details || '';
    const result = document.createElement('p');
    result.textContent = item.result || '';
    const date = document.createElement('small');
    date.textContent = item.date || '';
    card.append(title, details, result, date);

    if (item.data) {
      const repeat = document.createElement('button');
      repeat.textContent = 'Повторить расчёт';
      repeat.onclick = () => {
        Object.entries(item.data).forEach(([id, value]) => {
          const input = document.getElementById(id);
          if (input) input.value = value;
        });
        openPage(item.type);
        alert('Данные загружены. Проверьте их и нажмите кнопку расчёта.');
      };
      card.appendChild(repeat);
    }

    const remove = document.createElement('button');
    remove.textContent = 'Удалить';
    remove.onclick = () => {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(getHistory().filter(x => x.id !== item.id)));
      renderHistory();
    };
    card.appendChild(remove);
    container.appendChild(card);
  });
}

const historySection = document.createElement('section');
historySection.id = 'historySection';
historySection.style.cssText = 'max-width:1100px;margin:30px auto;padding:20px';
const historyTitle = document.createElement('h2');
historyTitle.textContent = 'История расчётов';

const historyFilter = document.createElement('select');
historyFilter.id = 'historyFilter';
historyFilter.style.cssText = 'padding:10px;margin:10px 0;border-radius:8px';
[['all', 'Все расчёты'], ['import', 'Только импорт'], ['profit', 'Только прибыль']].forEach(([value, text]) => {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = text;
  historyFilter.appendChild(option);
});
historyFilter.onchange = renderHistory;

const historyList = document.createElement('div');
historyList.id = 'historyList';
const clearButton = document.createElement('button');
clearButton.textContent = 'Очистить историю';
clearButton.onclick = () => {
  if (confirm('Удалить всю историю расчётов?')) {
    localStorage.removeItem(HISTORY_KEY);
    renderHistory();
  }
};
historySection.append(historyTitle, historyFilter, historyList, clearButton);
document.body.appendChild(historySection);

// Калькулятор импорта.
document.getElementById('doImport').onclick = event => {
  const q = v('qty');
  const price = v('cny');
  const rate = v('rate');
  const extra = v('ship') + v('ins') + v('customs') + v('impOther');

  if (q <= 0 || rate <= 0 || price < 0 || extra < 0) {
    alert('Проверьте введённые числа.');
    return;
  }

  const goods = q * price * rate;
  const total = goods + extra;
  const unit = total / q;

  document.getElementById('unit').textContent = money(unit);
  document.getElementById('goods').textContent = money(goods);
  document.getElementById('extras').textContent = money(extra);
  document.getElementById('total').textContent = money(total);

  if (event.isTrusted) {
    saveHistory({
      type: 'import',
      details: `Количество: ${q} шт. Цена: ${price} CNY. Курс: ${rate}`,
      result: `Себестоимость единицы: ${money(unit)}. Партия: ${money(total)}`,
      data: {
        qty: q, cny: price, rate,
        ship: v('ship'), ins: v('ins'),
        customs: v('customs'), impOther: v('impOther')
      }
    });
  }
};

// Калькулятор прибыли.
document.getElementById('doProfit').onclick = event => {
  const p = v('sale');
  const c = v('cost');
  const com = v('commission');
  const log = v('logistics');
  const ads = v('ads');
  const tax = v('tax');
  const other = v('other');

  if (p <= 0 || [c, com, log, ads, tax, other].some(x => x < 0) || com > 100 || tax > 100) {
    alert('Проверьте значения: цена больше нуля, проценты от 0 до 100.');
    return;
  }

  const cr = p * com / 100;
  const tr = p * tax / 100;
  const expenses = c + cr + log + ads + tr + other;
  const profit = p - expenses;
  const margin = profit / p * 100;

  document.getElementById('net').textContent = money(profit);
  document.getElementById('net').style.color = profit >= 0 ? '#b4a5ff' : '#ff8998';
  document.getElementById('status').textContent = profit >= 0
    ? 'Положительная прибыль по введённым данным'
    : 'Убыток по введённым данным';
  document.getElementById('commRub').textContent = money(cr);
  document.getElementById('taxRub').textContent = money(tr);
  document.getElementById('expenses').textContent = money(expenses);
  document.getElementById('margin').textContent = margin.toFixed(1) + '%';

  if (event.isTrusted) {
    saveHistory({
      type: 'profit',
      details: `Цена продажи: ${money(p)}. Себестоимость: ${money(c)}`,
      result: `Прибыль: ${money(profit)}. Маржинальность: ${margin.toFixed(1)}%`,
      data: { sale: p, cost: c, commission: com, logistics: log, ads, tax, other }
    });
  }
};

// Аналитика товаров: локальное сохранение в браузере.
function getMarketProducts() {
  try {
    return JSON.parse(localStorage.getItem(MARKET_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveMarketProducts(items) {
  localStorage.setItem(MARKET_KEY, JSON.stringify(items));
}

function readMarketForm() {
  const name = document.getElementById('mName').value.trim();
  const price = v('mPrice');
  const cost = v('mCost');
  const commission = v('mCommission');
  const logistics = v('mLogistics');
  const ads = v('mAds');
  const tax = v('mTax');
  const other = v('mOther');
  const sales = v('mSales');

  if (!name) {
    alert('Введите название товара.');
    return null;
  }
  if (price <= 0 || [cost, commission, logistics, ads, tax, other, sales].some(x => x < 0) || commission > 100 || tax > 100) {
    alert('Проверьте значения. Цена должна быть больше нуля, проценты — от 0 до 100, остальные расходы и продажи — неотрицательными.');
    return null;
  }

  return {
    platform: document.getElementById('mPlatform').value,
    name,
    article: document.getElementById('mArticle').value.trim(),
    price, cost, commission, logistics, ads, tax, other, sales
  };
}

function calculateProduct(item) {
  const commissionRub = item.price * item.commission / 100;
  const taxRub = item.price * item.tax / 100;
  const expenses = item.cost + commissionRub + item.logistics + item.ads + taxRub + item.other;
  const unitProfit = item.price - expenses;
  const margin = item.price ? unitProfit / item.price * 100 : 0;

  return {
    commissionRub,
    taxRub,
    expenses,
    unitProfit,
    margin,
    monthlyRevenue: item.price * item.sales,
    monthlyProfit: unitProfit * item.sales
  };
}

let editingMarketId = null;

function resetMarketForm() {
  editingMarketId = null;
  document.getElementById('marketFormTitle').textContent = 'Добавить товар';
  document.getElementById('saveMarketProduct').textContent = 'Добавить товар в сравнение →';
  document.getElementById('cancelMarketEdit').classList.add('hidden');
  document.getElementById('mPlatform').value = 'Wildberries';
  document.getElementById('mName').value = '';
  document.getElementById('mArticle').value = '';
  document.getElementById('mPrice').value = '';
  document.getElementById('mCost').value = '';
  document.getElementById('mCommission').value = '15';
  document.getElementById('mLogistics').value = '80';
  document.getElementById('mAds').value = '100';
  document.getElementById('mTax').value = '6';
  document.getElementById('mOther').value = '0';
  document.getElementById('mSales').value = '30';
}

function editMarketProduct(id) {
  const item = getMarketProducts().find(x => x.id === id);
  if (!item) return;
  editingMarketId = id;
  document.getElementById('marketFormTitle').textContent = 'Редактировать товар';
  document.getElementById('saveMarketProduct').textContent = 'Сохранить изменения →';
  document.getElementById('cancelMarketEdit').classList.remove('hidden');

  const fields = {
    mPlatform: item.platform, mName: item.name, mArticle: item.article || '',
    mPrice: item.price, mCost: item.cost, mCommission: item.commission,
    mLogistics: item.logistics, mAds: item.ads, mTax: item.tax,
    mOther: item.other, mSales: item.sales
  };
  Object.entries(fields).forEach(([id, value]) => {
    document.getElementById(id).value = value;
  });
  openPage('market');
  document.getElementById('marketFormTitle').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function renderMarketProducts() {
  const products = getMarketProducts();
  const rows = document.getElementById('marketRows');
  rows.replaceChildren();

  let totalRevenue = 0;
  let totalProfit = 0;

  if (!products.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 8;
    td.className = 'empty-row';
    td.textContent = 'Пока нет товаров. Добавьте первый товар выше.';
    tr.appendChild(td);
    rows.appendChild(tr);
  }

  products.forEach(item => {
    const result = calculateProduct(item);
    totalRevenue += result.monthlyRevenue;
    totalProfit += result.monthlyProfit;

    const tr = document.createElement('tr');
    const name = document.createElement('td');
    name.className = 'product-name';
    name.textContent = item.name;
    if (item.article) {
      const sub = document.createElement('span');
      sub.className = 'product-sub';
      sub.textContent = 'Артикул: ' + item.article;
      name.appendChild(sub);
    }

    const values = [
      item.platform,
      money(item.price),
      money(result.unitProfit),
      result.margin.toFixed(1) + '%',
      String(item.sales),
      money(result.monthlyProfit)
    ];

    tr.appendChild(name);
    values.forEach((value, index) => {
      const td = document.createElement('td');
      td.textContent = value;
      if ((index === 2 || index === 5) && result.unitProfit < 0) td.className = 'negative';
      if ((index === 2 || index === 5) && result.unitProfit >= 0) td.className = 'positive';
      tr.appendChild(td);
    });

    const actions = document.createElement('td');
    actions.className = 'row-actions';
    const edit = document.createElement('button');
    edit.textContent = 'Изменить';
    edit.onclick = () => editMarketProduct(item.id);
    const remove = document.createElement('button');
    remove.textContent = 'Удалить';
    remove.onclick = () => {
      if (confirm(`Удалить товар «${item.name}» из сравнения?`)) {
        saveMarketProducts(getMarketProducts().filter(x => x.id !== item.id));
        renderMarketProducts();
      }
    };
    actions.append(edit, remove);
    tr.appendChild(actions);
    rows.appendChild(tr);
  });

  document.getElementById('mCount').textContent = String(products.length);
  document.getElementById('mRevenue').textContent = money(totalRevenue);
  document.getElementById('mProfit').textContent = money(totalProfit);
}

document.getElementById('saveMarketProduct').onclick = () => {
  const data = readMarketForm();
  if (!data) return;

  const products = getMarketProducts();
  if (editingMarketId !== null) {
    const index = products.findIndex(x => x.id === editingMarketId);
    if (index !== -1) products[index] = { ...products[index], ...data };
  } else {
    products.unshift({ id: Date.now() + Math.random(), createdAt: new Date().toISOString(), ...data });
  }

  saveMarketProducts(products);
  resetMarketForm();
  renderMarketProducts();
};

document.getElementById('cancelMarketEdit').onclick = resetMarketForm;

document.getElementById('exportMarket').onclick = () => {
  const products = getMarketProducts();
  if (!products.length) {
    alert('Сначала добавьте хотя бы один товар.');
    return;
  }

  const header = ['Площадка', 'Название', 'Артикул', 'Цена', 'Себестоимость', 'Комиссия %', 'Логистика', 'Реклама', 'Налог %', 'Прочие расходы', 'Продажи в месяц', 'Прибыль за единицу', 'Маржа %', 'Выручка в месяц', 'Прибыль в месяц'];
  const rows = products.map(item => {
    const r = calculateProduct(item);
    return [
      item.platform, item.name, item.article, item.price, item.cost,
      item.commission, item.logistics, item.ads, item.tax, item.other,
      item.sales, r.unitProfit.toFixed(2), r.margin.toFixed(2),
      r.monthlyRevenue.toFixed(2), r.monthlyProfit.toFixed(2)
    ];
  });
  const csv = [header, ...rows].map(row =>
    row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(';')
  ).join('\r\n');

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'seller-import-pro-products.csv';
  link.click();
  URL.revokeObjectURL(url);
};

renderHistory();
renderMarketProducts();
