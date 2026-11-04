
document.addEventListener("DOMContentLoaded", () => {
  const API = "/api";
  let token = localStorage.getItem("sip_token") || "";
  let currentUser = null;

  const txt = {
    home: "Главная",
    request: "Рассчитать заказ",
    account: "Мои заявки",
    login: "Вход в аккаунт",
    register: "Регистрация"
  };

  async function api(path, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {})
    };

    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(API + path, {
      ...options,
      headers
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || data.message || "Ошибка запроса");
    }

    return data;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[char]);
  }

  function showPage(name) {
    const target = document.getElementById(`page-${name}`);
    if (!target) return;

    document.querySelectorAll(".page").forEach(page => {
      page.classList.toggle("active", page === target);
    });

    document.querySelectorAll("[data-page]").forEach(button => {
      button.classList.toggle("active", button.dataset.page === name);
    });

    const title = document.getElementById("page-title");

    if (title) {
      title.textContent = currentUser?.role === "admin" && name === "account"
        ? "Кабинет поставщика"
        : txt[name] || "SELLER IMPORT PRO";
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function message(id, text, error = false) {
    const element = document.getElementById(id);
    if (!element) return;

    element.textContent = text;
    element.style.color = error ? "#e05252" : "#35b88a";
  }

  function updateAccountButtons() {
    document.querySelectorAll('[data-page="login"]').forEach(button => {
      button.textContent = token ? "Выйти" : "Войти в аккаунт";
      button.dataset.action = token ? "logout" : "";
    });

    document.querySelectorAll('[data-page="account"]').forEach(button => {
      button.textContent = currentUser?.role === "admin"
        ? "Кабинет поставщика"
        : "Мои заявки";
    });
  }

  function money(value) {
    return Number(value || 0).toLocaleString("ru-RU", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function statusName(status) {
    const names = {
      new: "Новая заявка",
      calculated: "Ожидает подтверждения",
      confirmed: "Подтверждён",
      purchased: "Выкуплен в Китае",
      in_transit: "В пути",
      arrived: "Прибыл на склад",
      shipped: "Отправлен покупателю",
      delivered: "Доставлен"
    };

    return names[status] || status || "Неизвестно";
  }

  // УВЕДОМЛЕНИЯ

  function notificationsPanel() {
    return `
      <div class="content-card notifications-panel">
        <div class="notifications-heading">
          <div>
            <h2>Уведомления</h2>
            <p>Важные сообщения по вашим заказам.</p>
          </div>

          <div class="notifications-actions">
            <span class="notification-count" id="notifications-count">0</span>

            <button
              type="button"
              class="button button-outline notifications-read-all">
              Отметить все прочитанными
            </button>
          </div>
        </div>

        <div class="notifications-list" id="notifications-list">
          Загрузка уведомлений...
        </div>
      </div>
    `;
  }

  function notificationDate(value) {
    if (!value) return "Дата не указана";

    const raw = String(value);

    const normalized = raw.includes("Z") || /[+-]\d{2}:?\d{2}$/.test(raw)
      ? raw
      : raw.replace(" ", "T") + "Z";

    const date = new Date(normalized);

    return Number.isNaN(date.getTime())
      ? raw
      : date.toLocaleString("ru-RU");
  }

  async function loadNotifications(container = document) {
    const panel = container.querySelector("#notifications-list");
    const count = container.querySelector("#notifications-count");

    if (!panel) return;

    try {
      const data = await api("/notifications");
      const notifications = data.notifications || [];

      const unread = Number(
        data.unread_count ??
        notifications.filter(item => !Number(item.is_read)).length
      );

      if (count) {
        count.textContent = String(unread);
      }

      panel.innerHTML = notifications.length
        ? notifications.map(item => `
            <article class="notification-item ${Number(item.is_read) ? "is-read" : "is-unread"}">

              <div class="notification-content">
                <strong>${escapeHtml(item.title)}</strong>

                <p>${escapeHtml(item.message)}</p>

                <small>
                  ${escapeHtml(notificationDate(item.created_at))}
                </small>
              </div>

              ${!Number(item.is_read) ? `
                <button
                  type="button"
                  class="button button-outline notification-read-button"
                  data-notification-id="${escapeHtml(item.id)}">
                  Прочитано
                </button>
              ` : `
                <span class="notification-read-label">
                  Прочитано
                </span>
              `}

            </article>
          `).join("")
        : `
            <p class="notifications-empty">
              Уведомлений пока нет.
            </p>
          `;

    } catch (error) {
      panel.innerHTML = `
        <p class="notifications-error">
          Не удалось загрузить уведомления:
          ${escapeHtml(error.message)}
        </p>
      `;
    }
  }

  // ОТМЕТКА УВЕДОМЛЕНИЙ ПРОЧИТАННЫМИ

  document.addEventListener("click", async event => {
    const readButton = event.target.closest(".notification-read-button");
    const readAllButton = event.target.closest(".notifications-read-all");

    if (!readButton && !readAllButton) return;

    event.preventDefault();

    const panel = event.target.closest(".notifications-panel");
    const button = readButton || readAllButton;

    button.disabled = true;

    try {
      if (readButton) {
        await api(
          `/notifications/${encodeURIComponent(readButton.dataset.notificationId)}/read`,
          {
            method: "PATCH"
          }
        );
      } else {
        await api("/notifications/read-all", {
          method: "PATCH"
        });
      }

      await loadNotifications(panel || document);

    } catch (error) {
      button.disabled = false;
      alert(error.message);
    }
  });

  // ОТОБРАЖЕНИЕ ИСТОРИИ СТАТУСОВ

  function renderHistory(history) {
    if (!history || !history.length) {
      return `<p class="history-empty">История изменений пока пуста.</p>`;
    }

    return history.map(item => {
      const date = item.created_at
        ? new Date(
            item.created_at.includes("Z") || item.created_at.includes("+")
              ? item.created_at
              : item.created_at.replace(" ", "T") + "Z"
          )
        : null;

      const dateText = date && !Number.isNaN(date.getTime())
        ? date.toLocaleString("ru-RU")
        : item.created_at || "Дата не указана";

      return `
        <div class="history-item">
          <strong>${escapeHtml(statusName(item.new_status))}</strong>

          <p>
            Предыдущий статус:
            <span>${escapeHtml(
              item.old_status
                ? statusName(item.old_status)
                : "Создание заявки"
            )}</span>
          </p>

          <p>
            Дата:
            <span>${escapeHtml(dateText)}</span>
          </p>

          <p>
            Изменил:
            <span>${escapeHtml(item.changed_by || "Не указано")}</span>
          </p>
        </div>
      `;
    }).join("");
  }

  // ЗАГРУЗКА ИСТОРИИ ДЛЯ КАРТОЧЕК

  async function loadOrderHistories(container) {
    if (!container) return;

    const placeholders = Array.from(
      container.querySelectorAll(".order-history")
    );

    await Promise.all(placeholders.map(async placeholder => {
      const orderId = placeholder.dataset.orderId;

      try {
        const data = await api(`/orders/${orderId}/history`);

        if (!placeholder.isConnected) return;

        placeholder.innerHTML = renderHistory(data.history || []);

      } catch (error) {
        if (!placeholder.isConnected) return;

        placeholder.innerHTML = `
          <p class="history-error">
            Не удалось загрузить историю:
            ${escapeHtml(error.message)}
          </p>
        `;
      }
    }));
  }

  function calculationDetails(order) {
    if (order.total_price_rub == null) return "";

    return `
      <div class="calculation-details">
        <h4>Расшифровка стоимости</h4>

        <p>
          Стоимость товара:
          <strong>${money(order.product_price_rub)} RUB</strong>
        </p>

        <p>
          Доставка:
          <strong>${money(order.delivery_cost_rub)} RUB</strong>
        </p>

        <p>
          Страховка:
          <strong>${money(order.insurance_cost_rub)} RUB</strong>
        </p>

        <p>
          Комиссия:
          <strong>${money(order.commission_cost_rub)} RUB</strong>
        </p>

        <p>
          Дополнительные расходы:
          <strong>${money(order.extra_costs_rub)} RUB</strong>
        </p>

        <p>
          Наценка:
          <strong>${money(order.markup_rub)} RUB</strong>
        </p>

        <p>
          <strong>Итого: ${money(order.total_price_rub)} RUB</strong>
        </p>
      </div>
    `;
  }

  function nextStatus(status) {
    const statuses = {
      confirmed: {
        value: "purchased",
        label: "Выкуплен в Китае"
      },
      purchased: {
        value: "in_transit",
        label: "В пути"
      },
      in_transit: {
        value: "arrived",
        label: "Прибыл на склад"
      },
      arrived: {
        value: "shipped",
        label: "Отправлен покупателю"
      },
      shipped: {
        value: "delivered",
        label: "Доставлен"
      }
    };

    return statuses[status] || null;
  }

  function supplierStatusControl(order) {
    const next = nextStatus(order.status);

    if (!next) {
      if (order.status === "delivered") {
        return `<p class="confirmation-success">Заказ полностью доставлен.</p>`;
      }

      if (order.status === "new") {
        return `<p>Ожидается проверка веса и расчёт стоимости.</p>`;
      }

      if (order.status === "calculated") {
        return `<p>Ожидается подтверждение заказа покупателем.</p>`;
      }

      return "";
    }

    return `
      <div class="supplier-status-control">
        <p>
          Следующий этап:
          <strong>${escapeHtml(next.label)}</strong>
        </p>

        <button
          class="button button-primary update-order-status"
          type="button"
          data-order-id="${escapeHtml(order.id)}"
          data-next-status="${escapeHtml(next.value)}">
          Перевести в статус «${escapeHtml(next.label)}»
        </button>

        <p class="status-update-message" aria-live="polite"></p>
      </div>
    `;
  }

  // КАБИНЕТ ПОКУПАТЕЛЯ

  async function loadCustomerOrders() {
    const account = document.getElementById("page-account");
    if (!account) return;

    account.innerHTML = `
      <div class="content-card">
        <h2>Мои заявки</h2>
        <p>Загрузка...</p>
      </div>
    `;

    try {
      const data = await api("/orders");
      const orders = data.orders || [];

      if (!orders.length) {
        account.innerHTML = `
          ${notificationsPanel()}

          <div class="empty-state content-card">
            <div class="empty-icon">▤</div>
            <h2>Заявок пока нет</h2>
            <p>Создайте первую заявку на товар из Китая.</p>

            <button class="button button-primary" data-page="request">
              Создать заявку
            </button>
          </div>
        `;

        await loadNotifications(account);
        return;
      }

      account.innerHTML = `
        ${notificationsPanel()}

        <div class="content-card">
          <h2>Мои заявки</h2>

          <div class="orders-list">
            ${orders.map(order => `
              <article class="step-card">
                <h3>Заявка №${escapeHtml(order.id)}</h3>

                <p>
                  Цена товара:
                  ${escapeHtml(order.product_price_cny)} CNY
                </p>

                <p>
                  Вес:
                  ${
                    order.weight_kg == null
                      ? "Ожидает проверки"
                      : escapeHtml(order.weight_kg) + " кг"
                  }
                </p>

                <p>
                  Итого:
                  ${
                    order.total_price_rub == null
                      ? "Готовится расчёт"
                      : money(order.total_price_rub) + " RUB"
                  }
                </p>

                <p>
                  Статус:
                  <strong>${escapeHtml(statusName(order.status))}</strong>
                </p>

                ${calculationDetails(order)}

                ${order.status === "calculated" ? `
                  <button
                    class="button button-primary confirm-order-button"
                    data-order-id="${escapeHtml(order.id)}"
                    type="button">
                    Подтвердить заказ
                  </button>

                  <p class="confirm-order-message" aria-live="polite"></p>
                ` : ""}

                ${order.status === "confirmed" ? `
                  <p class="confirmation-success">
                    Заказ подтверждён. Поставщик получил информацию.
                  </p>
                ` : ""}

                ${order.status === "purchased" ? `
                  <p>Товар выкуплен в Китае.</p>
                ` : ""}

                ${order.status === "in_transit" ? `
                  <p>Товар находится в пути.</p>
                ` : ""}

                ${order.status === "arrived" ? `
                  <p>Товар прибыл на склад.</p>
                ` : ""}

                ${order.status === "shipped" ? `
                  <p>Товар отправлен покупателю.</p>
                ` : ""}

                ${order.status === "delivered" ? `
                  <p class="confirmation-success">Заказ доставлен.</p>
                ` : ""}

                <div class="order-history-block">
                  <h4>История заказа</h4>

                  <div
                    class="order-history"
                    data-order-id="${escapeHtml(order.id)}">
                    Загрузка истории...
                  </div>
                </div>

                <p>
                  <a
                    href="${escapeHtml(order.product_url)}"
                    target="_blank"
                    rel="noopener noreferrer">
                    Открыть товар
                  </a>
                </p>
              </article>
            `).join("")}
          </div>
        </div>
      `;

      await Promise.all([
        loadOrderHistories(account),
        loadNotifications(account)
      ]);

    } catch (error) {
      account.innerHTML = `
        <div class="content-card">
          <h2>Ошибка</h2>
          <p>${escapeHtml(error.message)}</p>
        </div>
      `;
    }
  }

  // ПОДТВЕРЖДЕНИЕ ЗАКАЗА ПОКУПАТЕЛЕМ

  document.addEventListener("click", async event => {
    const button = event.target.closest(".confirm-order-button");
    if (!button) return;

    event.preventDefault();

    const orderId = button.dataset.orderId;
    const card = button.closest(".step-card");
    const result = card?.querySelector(".confirm-order-message");

    if (!confirm(
      `Подтвердить заявку №${orderId}?\nПосле подтверждения поставщик сможет приступить к заказу товара.`
    )) {
      return;
    }

    button.disabled = true;
    button.textContent = "Подтверждение...";

    if (result) {
      result.textContent = "";
      result.style.color = "";
    }

    try {
      await api(`/orders/${orderId}/confirm`, {
        method: "POST"
      });

      await loadCustomerOrders();

    } catch (error) {
      if (result) {
        result.textContent = error.message;
        result.style.color = "#e05252";
      }

      button.disabled = false;
      button.textContent = "Подтвердить заказ";
    }
  });

  // ИЗМЕНЕНИЕ СТАТУСА ПОСТАВЩИКОМ

  document.addEventListener("click", async event => {
    const button = event.target.closest(".update-order-status");
    if (!button) return;

    event.preventDefault();

    const orderId = button.dataset.orderId;
    const newStatus = button.dataset.nextStatus;
    const card = button.closest(".step-card");
    const result = card?.querySelector(".status-update-message");
    const next = statusName(newStatus);

    if (!confirm(
      `Изменить статус заявки №${orderId} на «${next}»?`
    )) {
      return;
    }

    button.disabled = true;
    button.textContent = "Сохранение...";

    try {
      await api(`/admin/orders/${orderId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: newStatus })
      });

      await loadAdminPanel();

    } catch (error) {
      if (result) {
        result.textContent = error.message;
        result.style.color = "#e05252";
      }

      button.disabled = false;
      button.textContent = `Перевести в статус «${next}»`;
    }
  });

  // ФИЛЬТРАЦИЯ И СОРТИРОВКА ЗАЯВОК
  function filterAdminOrders() {
    const search = document
      .getElementById("orders-search")?.value
      .trim()
      .toLowerCase() || "";

    const status = document.getElementById("orders-status")?.value || "all";
    const sort = document.getElementById("orders-sort")?.value || "newest";

    const list = document.querySelector("#admin-orders-list");
    if (!list) return;

    const cards = Array.from(list.querySelectorAll(".admin-order-card"));

    cards.forEach(card => {
      const matchesSearch = (card.dataset.search || "").includes(search);
      const matchesStatus = status === "all" || card.dataset.status === status;

      card.hidden = !(matchesSearch && matchesStatus);
    });

    const sorted = cards.sort((a, b) => {
      if (sort === "oldest") {
        return Number(a.dataset.id) - Number(b.dataset.id);
      }

      if (sort === "price-high") {
        return Number(b.dataset.total) - Number(a.dataset.total);
      }

      if (sort === "price-low") {
        return Number(a.dataset.total) - Number(b.dataset.total);
      }

      return Number(b.dataset.id) - Number(a.dataset.id);
    });

    sorted.forEach(card => list.appendChild(card));

    const visible = cards.filter(card => !card.hidden).length;
    const counter = document.getElementById("orders-filter-count");

    if (counter) {
      counter.textContent = `Показано: ${visible} из ${cards.length}`;
    }
  }

  document.addEventListener("input", event => {
    if (event.target.id === "orders-search") {
      filterAdminOrders();
    }
  });

  document.addEventListener("change", event => {
    if (
      event.target.id === "orders-status" ||
      event.target.id === "orders-sort"
    ) {
      filterAdminOrders();
    }
  });

  
  // КАБИНЕТ ПОСТАВЩИКА

  async function loadAdminPanel() {
    const account = document.getElementById("page-account");
    if (!account) return;

    account.innerHTML = `
      <div class="content-card">
        <h2>Кабинет поставщика</h2>
        <p>Загрузка заявок и тарифов...</p>
      </div>
    `;

    try {
      const [ordersData, settingsData] = await Promise.all([
        api("/admin/orders"),
        api("/admin/settings")
      ]);

      const orders = ordersData.orders || [];
      const settings = settingsData.settings;

      if (!settings) {
        throw new Error("Настройки тарифов не найдены");
      }

      account.innerHTML = `
        ${notificationsPanel()}

        <div class="content-card">
          <h2>Кабинет поставщика</h2>
          <p>Администратор: ${escapeHtml(currentUser.email)}</p>
          <p>Всего заявок: ${orders.length}</p>
        </div>

        <div class="content-card">
          <h2>Настройки тарифов</h2>

          <form id="admin-settings-form" class="form">
            <label>Курс юаня (CNY → RUB)</label>

            <input
              name="exchange_rate"
              type="number"
              min="0.01"
              step="0.01"
              required
              value="${escapeHtml(settings.exchange_rate)}">

            <label>Доставка за 1 кг (RUB)</label>

            <input
              name="delivery_price_per_kg"
              type="number"
              min="0"
              step="0.01"
              required
              value="${escapeHtml(settings.delivery_price_per_kg)}">

            <label>Страховка (%)</label>

            <input
              name="insurance_percent"
              type="number"
              min="0"
              step="0.01"
              required
              value="${escapeHtml(settings.insurance_percent)}">

            <label>Комиссия (%)</label>

            <input
              name="commission_percent"
              type="number"
              min="0"
              step="0.01"
              required
              value="${escapeHtml(settings.commission_percent)}">

            <label>Дополнительные расходы (RUB)</label>

            <input
              name="extra_costs"
              type="number"
              min="0"
              step="0.01"
              required
              value="${escapeHtml(settings.extra_costs)}">

            <label>Наценка (%)</label>

            <input
              name="markup_percent"
              type="number"
              min="0"
              step="0.01"
              required
              value="${escapeHtml(settings.markup_percent)}">

            <button class="button button-primary" type="submit">
              Сохранить тарифы
            </button>

            <p id="admin-settings-message"></p>
          </form>
        </div>

        <div class="content-card">
          <h2>Все заявки покупателей</h2>

          <div class="orders-list">
            ${
              orders.length
                ? orders.map(order => `
                  <article class="step-card">
                    <h3>Заявка №${escapeHtml(order.id)}</h3>

                    <p>
                      Покупатель:
                      ${escapeHtml(order.email)}
                    </p>

                    <p>
                      Цена товара:
                      ${escapeHtml(order.product_price_cny)} CNY
                    </p>

                    <p>
                      Вес:
                      ${
                        order.weight_kg == null
                          ? "Не указан"
                          : escapeHtml(order.weight_kg) + " кг"
                      }
                    </p>

                    <p>
                      Итого:
                      ${
                        order.total_price_rub == null
                          ? "Не рассчитано"
                          : money(order.total_price_rub) + " RUB"
                      }
                    </p>

                    <p>
                      Статус:
                      <strong>${escapeHtml(statusName(order.status))}</strong>
                    </p>

                    ${calculationDetails(order)}

                    <p>
                      <a
                        href="${escapeHtml(order.product_url)}"
                        target="_blank"
                        rel="noopener noreferrer">
                        Открыть товар
                      </a>
                    </p>

                    <form
                      class="admin-order-form"
                      data-order-id="${escapeHtml(order.id)}">

                      <label>Вес товара (кг)</label>

                      <input
                        name="weight_kg"
                        type="number"
                        min="0.001"
                        step="0.001"
                        required
                        placeholder="Например, 2.5"
                        value="${order.weight_kg == null ? "" : escapeHtml(order.weight_kg)}">

                      <button class="button button-primary" type="submit">
                        Рассчитать стоимость
                      </button>

                      <p class="admin-order-message"></p>
                    </form>

                    ${supplierStatusControl(order)}

                    <div class="order-history-block">
                      <h4>История заказа</h4>

                      <div
                        class="order-history"
                        data-order-id="${escapeHtml(order.id)}">
                        Загрузка истории...
                      </div>
                    </div>
                  </article>
                `).join("")
                : "<p>Пока заявок нет.</p>"
            }
          </div>
        </div>
      `;

      await Promise.all([
        loadOrderHistories(account),
        loadNotifications(account)
      ]);

    } catch (error) {
      account.innerHTML = `
        <div class="content-card">
          <h2>Ошибка кабинета поставщика</h2>
          <p>${escapeHtml(error.message)}</p>

          <button
            class="button button-primary"
            data-action="reload-admin">
            Повторить загрузку
          </button>
        </div>
      `;
    }
  }

  async function loadAccount() {
    if (!token) {
      showPage("login");
      return;
    }

    if (currentUser?.role === "admin") {
      await loadAdminPanel();
    } else {
      await loadCustomerOrders();
    }
  }

  // СОХРАНЕНИЕ ТАРИФОВ

  document.addEventListener("submit", async event => {
    const settingsForm = event.target.closest("#admin-settings-form");
    if (!settingsForm) return;

    event.preventDefault();

    const formData = new FormData(settingsForm);
    const body = {};

    for (const field of [
      "exchange_rate",
      "delivery_price_per_kg",
      "insurance_percent",
      "commission_percent",
      "extra_costs",
      "markup_percent"
    ]) {
      body[field] = Number(formData.get(field));
    }

    const button = settingsForm.querySelector('button[type="submit"]');
    button.disabled = true;

    try {
      await api("/admin/settings", {
        method: "PUT",
        body: JSON.stringify(body)
      });

      message("admin-settings-message", "Тарифы успешно сохранены.");

    } catch (error) {
      message("admin-settings-message", error.message, true);

    } finally {
      button.disabled = false;
    }
  });

  // РАСЧЁТ ЗАЯВКИ

  document.addEventListener("submit", async event => {
    const form = event.target.closest(".admin-order-form");
    if (!form) return;

    event.preventDefault();

    const orderId = form.dataset.orderId;
    const weight = Number(form.elements.weight_kg.value);
    const button = form.querySelector('button[type="submit"]');
    const result = form.querySelector(".admin-order-message");

    button.disabled = true;
    result.textContent = "Выполняется расчёт...";

    try {
      const data = await api(`/admin/orders/${orderId}`, {
        method: "PATCH",
        body: JSON.stringify({ weight_kg: weight })
      });

      result.textContent =
        `Расчёт сохранён. Итог: ${money(data.calculation.total_price_rub)} RUB`;

      await loadAdminPanel();

    } catch (error) {
      result.textContent = error.message;
      result.style.color = "#e05252";
      button.disabled = false;
    }
  });

  // НАВИГАЦИЯ И ВЫХОД

  document.addEventListener("click", async event => {
    const button = event.target.closest("[data-page], [data-action]");
    if (!button) return;

    event.preventDefault();

    if (button.dataset.action === "logout") {
      try {
        await api("/logout", { method: "POST" });
      } catch (error) {
        console.warn(error);
      }

      token = "";
      currentUser = null;
      localStorage.removeItem("sip_token");

      updateAccountButtons();
      showPage("home");
      return;
    }

    if (button.dataset.action === "reload-admin") {
      await loadAdminPanel();
      return;
    }

    const page = button.dataset.page;
    if (!page) return;

    showPage(page);

    if (page === "account" && token) {
      await loadAccount();
    }
  });

  // РЕГИСТРАЦИЯ

  const registerForm = document.getElementById("register-form");

  if (registerForm) {
    registerForm.addEventListener("submit", async event => {
      event.preventDefault();

      message("register-message", "Создаём аккаунт...");

      try {
        const data = await api("/register", {
          method: "POST",
          body: JSON.stringify({
            email: document.getElementById("register-email").value.trim(),
            password: document.getElementById("register-password").value
          })
        });

        token = data.token;
        currentUser = data.user;

        localStorage.setItem("sip_token", token);

        updateAccountButtons();
        showPage("account");
        await loadAccount();

      } catch (error) {
        message("register-message", error.message, true);
      }
    });
  }

  // ВХОД

  const loginForm = document.getElementById("login-form");

  if (loginForm) {
    loginForm.addEventListener("submit", async event => {
      event.preventDefault();

      message("login-message", "Вход...");

      try {
        const data = await api("/login", {
          method: "POST",
          body: JSON.stringify({
            email: document.getElementById("login-email").value.trim(),
            password: document.getElementById("login-password").value
          })
        });

        token = data.token;
        currentUser = data.user;

        localStorage.setItem("sip_token", token);

        updateAccountButtons();
        showPage("account");
        await loadAccount();

      } catch (error) {
        message("login-message", error.message, true);
      }
    });
  }

  // СОЗДАНИЕ ЗАЯВКИ

  const requestForm = document.getElementById("request-form");

  if (requestForm) {
    requestForm.addEventListener("submit", async event => {
      event.preventDefault();

      message("request-message", "Отправляем заявку...");

      if (!token) {
        message("request-message", "Сначала войдите в аккаунт.", true);
        showPage("login");
        return;
      }

      try {
        await api("/orders", {
          method: "POST",
          body: JSON.stringify({
            product_url: document.getElementById("product-url").value.trim(),
            product_price_cny: Number(
              document.getElementById("product-price").value
            )
          })
        });

        requestForm.reset();
        message("request-message", "Заявка успешно отправлена.");

      } catch (error) {
        message("request-message", error.message, true);
      }
    });
  }

  // ПРОВЕРКА СЕССИИ

  async function checkSession() {
    if (!token) {
      updateAccountButtons();
      return;
    }

    try {
      const data = await api("/me");
      currentUser = data.user;
      updateAccountButtons();

    } catch (error) {
      token = "";
      currentUser = null;

      localStorage.removeItem("sip_token");
      updateAccountButtons();
    }
  }

  async function start() {
    await checkSession();

    if (token && currentUser) {
      showPage("account");
      await loadAccount();
    } else {
      updateAccountButtons();
    }

    console.log("SELLER IMPORT PRO: JavaScript loaded");
  }

  start();
});
