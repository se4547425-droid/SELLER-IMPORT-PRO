
const pages = ['home', 'import', 'profit', 'market'];

const labels = {
  home: 'Обзор',
  import: 'Импорт из Китая',
  profit: 'Прибыль товара',
  market: 'WB и Ozon'
};

const HISTORY_KEY = 'seller_import_pro_history';

const v = id => Number(document.getElementById(id).value || 0);

const money = n => new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  maximumFractionDigits: 2
}).format(n);

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

// Работа с историей
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

  localStorage.setItem(
    HISTORY_KEY,
    JSON.stringify(history.slice(0, 100))
  );

  renderHistory();
}

// Создание раздела истории
const historySection = document.createElement('section');
historySection.id = 'historySection';
historySection.style.cssText =
  'max-width:1100px;margin:30px auto;padding:20px';

const historyTitle = document.createElement('h2');
historyTitle.textContent = 'История расчётов';

const historyFilter = document.createElement('select');
historyFilter.id = 'historyFilter';
historyFilter.style.cssText =
  'padding:10px;margin:10px 0;border-radius:8px';

[
  ['all', 'Все расчёты'],
  ['import', 'Только импорт'],
  ['profit', 'Только прибыль']
].forEach(([value, text]) => {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = text;
  historyFilter.appendChild(option);
});

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

historyFilter.onchange = renderHistory;

historySection.append(
  historyTitle,
  historyFilter,
  historyList,
  clearButton
);

document.body.appendChild(historySection);

// Отображение истории
function renderHistory() {
  const container = document.getElementById('historyList');
  if (!container) return;

  container.replaceChildren();

  const filter = historyFilter.value;
  const history = getHistory().filter(item =>
    filter === 'all' || item.type === filter
  );

  if (!history.length) {
    container.textContent = 'История пока пуста.';
    return;
  }

  history.forEach(item => {
    const card = document.createElement('div');

    card.style.cssText =
      'padding:14px;margin:12px 0;border:1px solid #555;border-radius:12px';

    const title = document.createElement('h3');
    title.textContent = item.type === 'import'
      ? 'Импорт из Китая'
      : 'Расчёт прибыли';

    const details = document.createElement('p');
    details.textContent = item.details || '';

    const result = document.createElement('p');
    result.textContent = item.result || '';

    const date = document.createElement('small');
    date.textContent = item.date || '';

    card.append(title, details, result, date);

    // Повторное использование расчёта
    if (item.data) {
      const repeat = document.createElement('button');
      repeat.textContent = 'Повторить расчёт';
      repeat.style.marginRight = '8px';

      repeat.onclick = () => {
        const fields = item.type === 'import'
          ? item.data
          : item.data;

        Object.entries(fields).forEach(([id, value]) => {
          const input = document.getElementById(id);
          if (input) input.value = value;
        });

        openPage(item.type);

        alert(
          'Данные загружены в калькулятор. Проверьте значения и нажмите кнопку расчёта.'
        );
      };

      card.appendChild(repeat);
    }

    const remove = document.createElement('button');
    remove.textContent = 'Удалить';

    remove.onclick = () => {
      const updated = getHistory().filter(x => x.id !== item.id);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
      renderHistory();
    };

    card.appendChild(remove);
    container.appendChild(card);
  });
}

// Калькулятор импорта
document.getElementById('doImport').onclick = event => {
  const q = v('qty');
  const price = v('cny');
  const rate = v('rate');

  const extra =
    v('ship') + v('ins') + v('customs') + v('impOther');

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
        qty: q,
        cny: price,
        rate,
        ship: v('ship'),
        ins: v('ins'),
        customs: v('customs'),
        impOther: v('impOther')
      }
    });
  }
};

// Калькулятор прибыли
document.getElementById('doProfit').onclick = event => {
  const p = v('sale');
  const c = v('cost');
  const com = v('commission');
  const log = v('logistics');
  const ads = v('ads');
  const tax = v('tax');
  const other = v('other');

  if (
    p <= 0 ||
    [c, com, log, ads, tax, other].some(x => x < 0) ||
    com > 100 ||
    tax > 100
  ) {
    alert('Проверьте значения: цена больше нуля, проценты от 0 до 100.');
    return;
  }

  const cr = p * com / 100;
  const tr = p * tax / 100;
  const expenses = c + cr + log + ads + tr + other;
  const profit = p - expenses;
  const margin = profit / p * 100;

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
  document.getElementById('margin').textContent =
    margin.toFixed(1) + '%';

  if (event.isTrusted) {
    saveHistory({
      type: 'profit',
      details: `Цена продажи: ${money(p)}. Себестоимость: ${money(c)}`,
      result: `Прибыль: ${money(profit)}. Маржинальность: ${margin.toFixed(1)}%`,
      data: {
        sale: p,
        cost: c,
        commission: com,
        logistics: log,
        ads,
        tax,
        other
      }
    });
  }
};

renderHistory();
