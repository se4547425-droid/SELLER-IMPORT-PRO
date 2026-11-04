# SELLER IMPORT PRO — Web MVP

Первая веб-версия: калькулятор импорта из Китая и калькулятор прибыли с продажи. Адаптирована для компьютера и телефона.

## Локальный запуск
Откройте `index.html` двойным щелчком в браузере. Python и Node.js не требуются.

## Публикация через GitHub + Cloudflare Pages
1. Создайте новый репозиторий GitHub `seller-import-pro-web`.
2. Загрузите в корень репозитория файлы `index.html`, `styles.css`, `app.js`, `README.md`.
3. В Cloudflare откройте Workers & Pages → Create application → Pages → Connect to Git.
4. Подключите репозиторий `seller-import-pro-web`.
5. Production branch: `main`; Build command: `exit 0`; Build output directory: `/`; Root directory: `/`.
6. Нажмите Save and Deploy.

## Ограничения MVP
Это фронтенд: расчёты выполняются в браузере. Пока нет аккаунтов, серверной базы данных, оплаты и реальных API-интеграций WB/Ozon. Не вводите API-ключи в эту версию. Для этих функций добавим отдельный серверный этап.
