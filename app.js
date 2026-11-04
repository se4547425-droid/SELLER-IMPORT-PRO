
document.addEventListener("DOMContentLoaded", () => {
  const pageTitles = {
    home: "Главная",
    request: "Рассчитать заказ",
    account: "Мои заявки",
    login: "Вход в аккаунт",
    register: "Регистрация"
  };

  function showPage(name) {
    const target = document.getElementById(`page-${name}`);

    if (!target) {
      console.error("Страница не найдена:", name);
      return;
    }

    document.querySelectorAll(".page").forEach(page => {
      page.classList.toggle("active", page === target);
    });

    document.querySelectorAll("[data-page]").forEach(button => {
      button.classList.toggle(
        "active",
        button.dataset.page === name
      );
    });

    const title = document.getElementById("page-title");

    if (title) {
      title.textContent = pageTitles[name] || "SELLER IMPORT PRO";
    }

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }

  // Переходы между страницами
  document.addEventListener("click", event => {
    const button = event.target.closest("[data-page]");

    if (!button) return;

    event.preventDefault();
    showPage(button.dataset.page);
  });

  // Форма заявки
  const requestForm = document.getElementById("request-form");

  if (requestForm) {
    requestForm.addEventListener("submit", event => {
      event.preventDefault();

      const message = document.getElementById("request-message");

      if (message) {
        message.textContent =
          "Форма готова. Сохранение заявок будет подключено после настройки базы данных.";
      }
    });
  }

  // Вход
  const loginForm = document.getElementById("login-form");

  if (loginForm) {
    loginForm.addEventListener("submit", event => {
      event.preventDefault();

      const message = document.getElementById("login-message");

      if (message) {
        message.textContent =
          "Авторизация пока не подключена.";
      }
    });
  }

  // Регистрация
  const registerForm = document.getElementById("register-form");

  if (registerForm) {
    registerForm.addEventListener("submit", event => {
      event.preventDefault();

      const message = document.getElementById("register-message");

      if (message) {
        message.textContent =
          "Регистрация пока не подключена.";
      }
    });
  }

  console.log("SELLER IMPORT PRO: JavaScript загружен успешно");
});
