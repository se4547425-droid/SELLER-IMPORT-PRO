
document.addEventListener("DOMContentLoaded", () => {
  const API = "/api";
  let token = localStorage.getItem("sip_token") || "";

  const txt = {
    home: "\u0413\u043b\u0430\u0432\u043d\u0430\u044f",
    request: "\u0420\u0430\u0441\u0441\u0447\u0438\u0442\u0430\u0442\u044c \u0437\u0430\u043a\u0430\u0437",
    account: "\u041c\u043e\u0438 \u0437\u0430\u044f\u0432\u043a\u0438",
    login: "\u0412\u0445\u043e\u0434 \u0432 \u0430\u043a\u043a\u0430\u0443\u043d\u0442",
    register: "\u0420\u0435\u0433\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u044f"
  };

  async function api(path, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {})
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(API + path, { ...options, headers });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || data.message || "Request failed");
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
    if (title) title.textContent = txt[name] || "SELLER IMPORT PRO";
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
      "&": "&amp;", "<": "&lt;", ">": "&gt;",
      '"': "&quot;", "'": "&#039;"
    })[char]);
  }

  function updateAccountButtons() {
    document.querySelectorAll('[data-page="login"]').forEach(button => {
      button.textContent = token ? "\u0412\u044b\u0439\u0442\u0438" : "\u0412\u043e\u0439\u0442\u0438 \u0432 \u0430\u043a\u043a\u0430\u0443\u043d\u0442";
      button.dataset.action = token ? "logout" : "";
    });
  }

  async function loadOrders() {
    const account = document.getElementById("page-account");
    if (!account) return;

    account.innerHTML = `<div class="content-card"><h2>${txt.account}</h2><p>\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430...</p></div>`;

    try {
      const data = await api("/orders");
      const orders = data.orders || [];

      if (!orders.length) {
        account.innerHTML = `
          <div class="empty-state content-card">
            <div class="empty-icon">▤</div>
            <h2>\u0417\u0430\u044f\u0432\u043e\u043a \u043f\u043e\u043a\u0430 \u043d\u0435\u0442</h2>
            <p>\u0421\u043e\u0437\u0434\u0430\u0439\u0442\u0435 \u043f\u0435\u0440\u0432\u0443\u044e \u0437\u0430\u044f\u0432\u043a\u0443 \u043d\u0430 \u0442\u043e\u0432\u0430\u0440 \u0438\u0437 \u041a\u0438\u0442\u0430\u044f.</p>
            <button class="button button-primary" data-page="request">\u0421\u043e\u0437\u0434\u0430\u0442\u044c \u0437\u0430\u044f\u0432\u043a\u0443</button>
          </div>`;
        return;
      }

      account.innerHTML = `
        <div class="content-card">
          <h2>${txt.account}</h2>
          <div class="orders-list">
            ${orders.map(order => `
              <article class="step-card">
                <h3>\u0417\u0430\u044f\u0432\u043a\u0430 \u2116${escapeHtml(order.id)}</h3>
                <p>\u0426\u0435\u043d\u0430 \u0442\u043e\u0432\u0430\u0440\u0430: ${escapeHtml(order.product_price_cny)} CNY</p>
                <p>\u0412\u0435\u0441: ${order.weight_kg == null ? "\u041e\u0436\u0438\u0434\u0430\u0435\u0442 \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0438" : escapeHtml(order.weight_kg + " \u043a\u0433")}</p>
                <p>\u0418\u0442\u043e\u0433\u043e: ${order.total_price_rub == null ? "\u0413\u043e\u0442\u043e\u0432\u0438\u0442\u0441\u044f \u0440\u0430\u0441\u0447\u0451\u0442" : escapeHtml(order.total_price_rub + " RUB")}</p>
                <p>\u0421\u0442\u0430\u0442\u0443\u0441: ${escapeHtml(order.status)}</p>
                <a href="${escapeHtml(order.product_url)}" target="_blank" rel="noopener noreferrer">\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u0442\u043e\u0432\u0430\u0440</a>
              </article>
            `).join("")}
          </div>
        </div>`;
    } catch (error) {
      account.innerHTML = `<div class="content-card"><h2>\u041e\u0448\u0438\u0431\u043a\u0430</h2><p>${escapeHtml(error.message)}</p></div>`;
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
    if (button.dataset.page === "account" && token) loadOrders();
  });

  const registerForm = document.getElementById("register-form");
  if (registerForm) {
    registerForm.addEventListener("submit", async event => {
      event.preventDefault();
      message("register-message", "\u0421\u043e\u0437\u0434\u0430\u0451\u043c \u0430\u043a\u043a\u0430\u0443\u043d\u0442...");

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
      message("login-message", "\u0412\u0445\u043e\u0434...");
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
      message("request-message", "\u041e\u0442\u043f\u0440\u0430\u0432\u043b\u044f\u0435\u043c \u0437\u0430\u044f\u0432\u043a\u0443...");

      if (!token) {
        message("request-message", "\u0421\u043d\u0430\u0447\u0430\u043b\u0430 \u0432\u043e\u0439\u0434\u0438\u0442\u0435 \u0432 \u0430\u043a\u043a\u0430\u0443\u043d\u0442.", true);
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
        message("request-message", "\u0417\u0430\u044f\u0432\u043a\u0430 \u0443\u0441\u043f\u0435\u0448\u043d\u043e \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u0430.");
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
  console.log("SELLER IMPORT PRO: JavaScript loaded");
});
