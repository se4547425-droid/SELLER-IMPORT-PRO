
document.addEventListener("DOMContentLoaded", () => {
  const API = "/api";
  let token = localStorage.getItem("sip_token") || "";

  const pageTitles = {
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
    if (title) title.textContent = pageTitles[name] || "SELLER IMPORT PRO";

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function message(id, text, error = false) {
    const element = document.getElementById(id);
    if (!element) return;
    element.textContent = text;
    element.style.color = error ? "#e05252" : "#35b88a";
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

  function updateAccountButtons() {
    document.querySelectorAll('[data-page="login"]').forEach(button => {
      button.textContent = token ? "Выйти" : "Войти в аккаунт";
      button.dataset.action = token ? "logout" : "";
    });
  }

  async function loadOrders() {
    const account = document.getElementById("page-account");
    if (!account) return;

    account.innerHTML = `
      <div class="content-card">
        <h2>Мои заявки</h2>
        <p>Загружаем ваши заявки...</p>
      </div>`;

    try {
      const data = await api("/orders");
      const orders = data.orders || [];

      if (!orders.length) {
        account.innerHTML = `
          <div class="empty-state content-card">
            <div class="empty-icon">▤</div>
            <h2>Заявок пока нет</h2>
            <p>Создайте первую заявку на товар из Китая.</p>
            <button class="button button-primary" data-page="request">Создать заявку</button>
          </div>`;
        return;
      }

      account.innerHTML = `
        <div class="content-card">
          <h2>Мои заявки</h2>
          <div class="orders-list">
            ${orders.map(order => `
              <article class="step-card">
                <h3>Заявка №${escapeHtml(order.id)}</h3>
                <p>Цена товара: ${escapeHtml(order.product_price_cny)} ¥</p>
                <p>Вес: ${order.weight_kg == null ? "Ожидает проверки" : escapeHtml(order.weight_kg + " кг")}</p>
                <p>Итоговая стоимость: ${order.total_price_rub == null ? "Готовится расчёт" : escapeHtml(order.total_price_rub + " ₽")}</p>
                <p>Статус: ${escapeHtml(order.status)}</p>
                <a href="${escapeHtml(order.product_url)}" target="_blank" rel="noopener noreferrer">Открыть товар</a>
              </article>
            `).join("")}
          </div>
        </div>`;
    } catch (error) {
      account.innerHTML = `
        <div class="content-card">
          <h2>Не удалось загрузить заявки</h2>
          <p>${escapeHtml(error.message)}</p>
        </div>`;
    }
  }

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
      localStorage.removeItem("sip_token");
      updateAccountButtons();
      showPage("home");
      return;
    }

    showPage(button.dataset.page);

    if (button.dataset.page === "account" && token) {
      loadOrders();
    }
  });

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
        localStorage.setItem("sip_token", token);
        updateAccountButtons();
        showPage("account");
        loadOrders();
      } catch (error) {
        message("register-message", error.message, true);
      }
    });
  }

  const loginForm = document.getElementById("login-form");

  if (loginForm) {
    loginForm.addEventListener("submit", async event => {
      event.preventDefault();
      message("login-message", "Выполняем вход...");

      try {
        const data = await api("/login", {
          method: "POST",
          body: JSON.stringify({
            email: document.getElementById("login-email").value.trim(),
            password: document.getElementById("login-password").value
          })
        });

        token = data.token;
        localStorage.setItem("sip_token", token);
        updateAccountButtons();
        showPage("account");
        loadOrders();
      } catch (error) {
        message("login-message", error.message, true);
      }
    });
  }

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
            product_price_cny: Number(document.getElementById("product-price").value)
          })
        });

        requestForm.reset();
        message("request-message", "Заявка успешно отправлена.");
      } catch (error) {
        message("request-message", error.message, true);
      }
    });
  }

  async function checkSession() {
    if (!token) return;

    try {
      await api("/me");
      updateAccountButtons();
    } catch (error) {
      token = "";
      localStorage.removeItem("sip_token");
      updateAccountButtons();
    }
  }

  updateAccountButtons();
  checkSession();

  console.log("SELLER IMPORT PRO: JavaScript загружен успешно");
});
