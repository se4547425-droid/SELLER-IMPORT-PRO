const pageTitles={home:"Главная",request:"Рассчитать заказ",account:"Мои заявки",login:"Вход в аккаунт",register:"Регистрация"};
function showPage(name){
  document.querySelectorAll(".page").forEach(p=>p.classList.toggle("active",p.id===`page-${name}`));
  document.querySelectorAll(".nav-link[data-page]").forEach(b=>b.classList.toggle("active",b.dataset.page===name));
  const title=document.getElementById("page-title"); if(title) title.textContent=pageTitles[name]||"SELLER IMPORT PRO";
  window.scrollTo({top:0,behavior:"smooth"});
}
document.addEventListener("click",e=>{
  const button=e.target.closest("[data-page]");
  if(button){e.preventDefault();showPage(button.dataset.page);}
});
document.getElementById("request-form")?.addEventListener("submit",e=>{
  e.preventDefault();
  document.getElementById("request-message").textContent="Интерфейс заявки готов. Отправка и сохранение заявок будут подключены после настройки серверной базы данных.";
});
document.getElementById("login-form")?.addEventListener("submit",e=>{
  e.preventDefault();
  document.getElementById("login-message").textContent="Авторизация ещё не подключена. Это будет сделано на следующем этапе.";
});
document.getElementById("register-form")?.addEventListener("submit",e=>{
  e.preventDefault();
  document.getElementById("register-message").textContent="Регистрация ещё не подключена. Сначала настроим безопасное хранение аккаунтов.";
});
