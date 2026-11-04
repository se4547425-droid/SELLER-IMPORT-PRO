
const pages = ['home', 'import', 'profit', 'market'];
const labels = {
  home: 'Обзор',
  import: 'Импорт из Китая',
  profit: 'Прибыль товара',
  market: 'WB и Ozon'
};

const HISTORY_KEY = 'seller_import_pro_history';

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

  const history = getHistory();

  if (!history.length) {
    container.textContent = 'История пока пуста.';
    return;
  }

  history.forEach(item => {
    const card = document.createElement('div');
    card.style.cssText =
      'padding:12px;margin:10px 0;border:1px solid #444;border-radius:10px';

    const title = document.createElement('strong');
    title.textContent = item.type === 'import'
      ? 'Импорт из Китая'
      : 'Расчёт прибыли';

    const details = document.createElement('p');
    details.textContent = item.details;

    const result = document.createElement('p');
    result.textContent = item.result;

    const date = document.createElement('small');
    date.textContent = item.date;

    const remove = document.createElement('button');
    remove.textContent = 'Удалить';
    remove.style.cssText = 'margin-top:8px;cursor:pointer';
    remove.onclick = () => {
      localStorage.setItem(
        HISTORY_KEY,
        JSON.stringify(getHistory().filter(x => x.id !== item.id))
      );
      renderHistory();
    };

    card.append(title, details, result, date, remove);
    container.appendChild(card);
  });
}

function openPage(p) {
  pages.forEach(x =>
    document.getElementById(x).classList.toggle('active', x === p)
  );

  document.getElementById('crumb').textContent = labels[p];

  document.querySelectorAll('nav button').forEach(b =>
    b.classList.toggle('active', b.dataset.view === p)
  );

  scrollTo(0, 0);
}

document.querySelectorAll('[data-view]').forEach(b =>
  b.onclick = () => openPage(b.dataset.view)
);

document.querySelectorAll('[data-go]').forEach(b =>
  b.onclick = () => openPage(b.dataset.go)
);

const v = id => Number(document.getElementById(id).value || 0);

const money = n => new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  maximumFractionDigits: 2
}).format(n);

// Создаём раздел истории автоматически
const historySection = document.createElement('section');
historySection.id = 'historySection';
historySection.style.cssText =
  'padding:20px;margin:20px 0;border:1px solid #444;border-radius:14px';

const historyTitle = document.createElement('h2');
historyTitle.textContent = 'История расчётов';

const historyList = document.createElement('div');
historyList.id = 'historyList';

const clearButton = document.createElement('button');
clearButton.textContent = 'Очистить историю';
clearButton.style.cssText = 'padding:10px;cursor:pointer';

clearButton.onclick = () => {
  if (confirm('Удалить всю историю расчётов?')) {
    localStorage.removeItem(HISTORY_KEY);
    renderHistory();
  }
};

historySection.append(historyTitle, historyList, clearButton);
document.body.appendChild(historySection);

// Расчёт импорта
document.getElementById('doImport').onclick = () => {
  let q = v('qty');
  let price = v('cny');
  let rate = v('rate');
  let extra = v('ship') + v('ins') + v('customs') + v('impOther');

  if (q <= 0 || rate <= 0 || price < 0 || extra < 0)
    return alert('Проверьте введённые числа.');

  let goods = q * price * rate;
  let total = goods + extra;
  let unit = total / q;

  document.getElementById('unit').textContent = money(unit);
  document.getElementById('goods').textContent = money(goods);
  document.getElementById('extras').textContent = money(extra);
  document.getElementById('total').textContent = money(total);

  if (event.isTrusted) {
    saveHistory({
      type: 'import',
      details: `Количество: ${q} шт. Цена: ${price} CNY. Курс: ${rate}`,
      result: `Себестоимость единицы: ${money(unit)}. Партия: ${money(total)}`
    });
  }
};

// Расчёт прибыли
document.getElementById('doProfit').onclick = () => {
  let p = v('sale');
  let c = v('cost');
  let com = v('commission');
  let log = v('logistics');
  let ads = v('ads');
  let tax = v('tax');
  let other = v('other');

  if (
    p <= 0 ||
    [c, com, log, ads, tax, other].some(x => x < 0) ||
    com > 100 ||
    tax > 100
  ) {
    return alert('Проверьте значения: цена больше нуля, проценты от 0 до 100.');
  }

  let cr = p * com / 100;
  let tr = p * tax / 100;
  let expenses = c + cr + log + ads + tr + other;
  let profit = p - expenses;
  let margin = profit / p * 100;

  document.getElementById('net').textContent = money(profit);
  document.getElementById('net').style.color =
    profit >= 0 ? '#b4a5ff' : '#ff8998';

  document.getElementById('status').textContent =
    profit >= 0
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
      result: `Прибыль: ${money(profit)}. Маржинальность: ${margin.toFixed(1)}%`
    });
  }
};

renderHistory();
