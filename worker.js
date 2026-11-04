const json = (data, status = 200) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" }
  });

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

async function sha256(value) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );

  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    salt,
    iterations: 100000,
    hash: "SHA-256"
  }, key, 256);

  return base64url(new Uint8Array(bits));
}

async function createPasswordHash(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await hashPassword(password, salt);
  return `pbkdf2$100000$${base64url(salt)}$${hash}`;
}

async function verifyPassword(password, stored) {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;

  const salt = fromBase64url(parts[2]);
  const hash = await hashPassword(password, salt);

  return hash === parts[3];
}

async function getUser(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";

  if (!token) return null;

  const tokenHash = await sha256(token);

  const user = await env.DB.prepare(`
    SELECT users.id, users.email, users.role
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ?
      AND sessions.expires_at > ?
  `).bind(tokenHash, new Date().toISOString()).first();

  if (!user) return null;

  const adminEmail = String(env.ADMIN_EMAIL || "").trim().toLowerCase();

  if (adminEmail && user.email.toLowerCase() === adminEmail) {
    user.role = "admin";
  }

  return user;
}

function isAdmin(user) {
  return user?.role === "admin";
}

async function createSession(user, env) {
  const token = base64url(
    crypto.getRandomValues(new Uint8Array(32))
  );

  const tokenHash = await sha256(token);
  const expires = new Date(Date.now() + 7 * 86400000).toISOString();

  await env.DB.prepare(`
    INSERT INTO sessions (user_id, token_hash, expires_at)
    VALUES (?, ?, ?)
  `).bind(user.id, tokenHash, expires).run();

  return token;
}

async function requireAdmin(request, env) {
  const user = await getUser(request, env);

  if (!user) {
    return { error: json({ error: "Требуется вход" }, 401) };
  }

  if (!isAdmin(user)) {
    return { error: json({ error: "Недостаточно прав" }, 403) };
  }

  return { user };
}

function validNonNegative(value) {
  return Number.isFinite(value) && value >= 0;
}

// НАЗВАНИЯ СТАТУСОВ
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

  return names[status] || status;
}

// СОЗДАНИЕ УВЕДОМЛЕНИЯ
async function createNotification(
  env,
  userId,
  orderId,
  title,
  message
) {
  if (!userId) return;

  await env.DB.prepare(`
    INSERT INTO notifications
      (user_id, order_id, title, message)
    VALUES (?, ?, ?, ?)
  `).bind(
    userId,
    orderId || null,
    title,
    message
  ).run();
}

// ПОЛУЧЕНИЕ ID ПОСТАВЩИКА
async function getAdminUser(env) {
  const adminEmail = String(env.ADMIN_EMAIL || "").trim().toLowerCase();

  if (!adminEmail) return null;

  return await env.DB.prepare(`
    SELECT id, email
    FROM users
    WHERE LOWER(email) = ?
  `).bind(adminEmail).first();
}

// ЗАПИСЬ ИСТОРИИ СТАТУСОВ
async function saveStatusHistory(
  env,
  orderId,
  oldStatus,
  newStatus,
  changedBy
) {
  await env.DB.prepare(`
    INSERT INTO order_status_history
      (order_id, old_status, new_status, changed_by)
    VALUES (?, ?, ?, ?)
  `).bind(
    orderId,
    oldStatus || null,
    newStatus,
    changedBy || "system"
  ).run();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      // ПРОВЕРКА СЕРВЕРА
      if (path === "/api/health" && method === "GET") {
        const result = await env.DB
          .prepare("SELECT 1 AS connected")
          .first();

        return json({
          status: "ok",
          database: result?.connected === 1
        });
      }

      // РЕГИСТРАЦИЯ
      if (path === "/api/register" && method === "POST") {
        const body = await request.json();
        const email = String(body.email || "").trim().toLowerCase();
        const password = String(body.password || "");

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return json({ error: "Некорректный email" }, 400);
        }

        if (password.length < 8 || password.length > 128) {
          return json({
            error: "Пароль должен содержать от 8 до 128 символов"
          }, 400);
        }

        const existing = await env.DB.prepare(
          "SELECT id FROM users WHERE email = ?"
        ).bind(email).first();

        if (existing) {
          return json({
            error: "Этот email уже зарегистрирован"
          }, 409);
        }

        const passwordHash = await createPasswordHash(password);

        const result = await env.DB.prepare(`
          INSERT INTO users (email, password_hash, role)
          VALUES (?, ?, 'customer')
        `).bind(email, passwordHash).run();

        const user = {
          id: result.meta.last_row_id,
          email,
          role: "customer"
        };

        const adminEmail = String(env.ADMIN_EMAIL || "").trim().toLowerCase();

        if (adminEmail && email === adminEmail) {
          user.role = "admin";
        }

        const token = await createSession(user, env);

        return json({ user, token }, 201);
      }

      // ВХОД
      if (path === "/api/login" && method === "POST") {
        const body = await request.json();
        const email = String(body.email || "").trim().toLowerCase();
        const password = String(body.password || "");

        const user = await env.DB.prepare(`
          SELECT id, email, password_hash, role
          FROM users
          WHERE email = ?
        `).bind(email).first();

        if (!user || !(await verifyPassword(password, user.password_hash))) {
          return json({
            error: "Неверный email или пароль"
          }, 401);
        }

        const adminEmail = String(env.ADMIN_EMAIL || "").trim().toLowerCase();

        if (adminEmail && user.email.toLowerCase() === adminEmail) {
          user.role = "admin";
        }

        const token = await createSession(user, env);

        return json({
          user: {
            id: user.id,
            email: user.email,
            role: user.role
          },
          token
        });
      }

      // ТЕКУЩИЙ ПОЛЬЗОВАТЕЛЬ
      if (path === "/api/me" && method === "GET") {
        const user = await getUser(request, env);

        if (!user) return json({ error: "Требуется вход" }, 401);

        return json({ user });
      }

      // СОЗДАНИЕ ЗАЯВКИ
      if (path === "/api/orders" && method === "POST") {
        const user = await getUser(request, env);

        if (!user) return json({ error: "Требуется вход" }, 401);

        const body = await request.json();
        const productUrl = String(body.product_url || "").trim();
        const price = Number(body.product_price_cny);

        let parsedUrl;

        try {
          parsedUrl = new URL(productUrl);
        } catch {
          return json({
            error: "Некорректная ссылка на товар"
          }, 400);
        }

        if (!["http:", "https:"].includes(parsedUrl.protocol)) {
          return json({
            error: "Разрешены только HTTP и HTTPS ссылки"
          }, 400);
        }

        if (!Number.isFinite(price) || price <= 0 || price > 100000000) {
          return json({
            error: "Укажи корректную цену товара в юанях"
          }, 400);
        }

        const result = await env.DB.prepare(`
          INSERT INTO orders (user_id, product_url, product_price_cny)
          VALUES (?, ?, ?)
        `).bind(user.id, productUrl, price).run();

        const orderId = result.meta.last_row_id;

        await saveStatusHistory(
          env,
          orderId,
          null,
          "new",
          user.email
        );

        // УВЕДОМЛЕНИЕ ПОСТАВЩИКУ
        const admin = await getAdminUser(env);

        if (admin) {
          await createNotification(
            env,
            admin.id,
            orderId,
            "Новая заявка",
            `Покупатель ${user.email} создал заявку №${orderId}.`
          );
        }

        return json({
          message: "Заявка создана",
          order_id: orderId,
          status: "new"
        }, 201);
      }

      // ПОЛУЧЕНИЕ УВЕДОМЛЕНИЙ
      if (path === "/api/notifications" && method === "GET") {
        const user = await getUser(request, env);

        if (!user) return json({ error: "Требуется вход" }, 401);

        const result = await env.DB.prepare(`
          SELECT id, order_id, title, message, is_read, created_at
          FROM notifications
          WHERE user_id = ?
          ORDER BY id DESC
          LIMIT 100
        `).bind(user.id).all();

        const unread = await env.DB.prepare(`
          SELECT COUNT(*) AS count
          FROM notifications
          WHERE user_id = ? AND is_read = 0
        `).bind(user.id).first();

        return json({
          notifications: result.results,
          unread_count: unread?.count || 0
        });
      }

      // ОТМЕТИТЬ ОДНО УВЕДОМЛЕНИЕ ПРОЧИТАННЫМ
      const notificationReadMatch = path.match(
        /^\/api\/notifications\/(\d+)\/read$/
      );

      if (notificationReadMatch && method === "PATCH") {
        const user = await getUser(request, env);

        if (!user) return json({ error: "Требуется вход" }, 401);

        const notificationId = Number(notificationReadMatch[1]);

        const result = await env.DB.prepare(`
          UPDATE notifications
          SET is_read = 1
          WHERE id = ? AND user_id = ?
        `).bind(notificationId, user.id).run();

        if (!result.meta.changes) {
          return json({
            error: "Уведомление не найдено"
          }, 404);
        }

        return json({ message: "Уведомление прочитано" });
      }

      // ОТМЕТИТЬ ВСЕ УВЕДОМЛЕНИЯ ПРОЧИТАННЫМИ
      if (path === "/api/notifications/read-all" && method === "PATCH") {
        const user = await getUser(request, env);

        if (!user) return json({ error: "Требуется вход" }, 401);

        await env.DB.prepare(`
          UPDATE notifications
          SET is_read = 1
          WHERE user_id = ? AND is_read = 0
        `).bind(user.id).run();

        return json({
          message: "Все уведомления прочитаны"
        });
      }

      // ПОДТВЕРЖДЕНИЕ ЗАКАЗА ПОКУПАТЕЛЕМ
      const confirmMatch = path.match(
        /^\/api\/orders\/(\d+)\/confirm$/
      );

      if (confirmMatch && method === "POST") {
        const user = await getUser(request, env);

        if (!user) return json({ error: "Требуется вход" }, 401);

        const orderId = Number(confirmMatch[1]);

        const order = await env.DB.prepare(`
          SELECT id, status
          FROM orders
          WHERE id = ? AND user_id = ?
        `).bind(orderId, user.id).first();

        if (!order) return json({ error: "Заявка не найдена" }, 404);

        if (order.status !== "calculated") {
          return json({
            error: "Подтвердить можно только рассчитанную заявку"
          }, 400);
        }

        const result = await env.DB.prepare(`
          UPDATE orders
          SET status = 'confirmed'
          WHERE id = ?
            AND user_id = ?
            AND status = 'calculated'
        `).bind(orderId, user.id).run();

        if (!result.meta.changes) {
          return json({
            error: "Не удалось подтвердить заявку. Обновите страницу."
          }, 409);
        }

        await saveStatusHistory(
          env,
          orderId,
          "calculated",
          "confirmed",
          user.email
        );

        // УВЕДОМЛЕНИЕ ПОСТАВЩИКУ
        const admin = await getAdminUser(env);

        if (admin) {
          await createNotification(
            env,
            admin.id,
            orderId,
            "Заказ подтверждён",
            `Покупатель подтвердил заявку №${orderId}. Можно приступать к выкупу товара.`
          );
        }

        return json({
          message: "Заказ подтверждён",
          order_id: orderId,
          status: "confirmed"
        });
      }

      // ИСТОРИЯ СТАТУСОВ ЗАКАЗА
      const historyMatch = path.match(
        /^\/api\/orders\/(\d+)\/history$/
      );

      if (historyMatch && method === "GET") {
        const user = await getUser(request, env);

        if (!user) return json({ error: "Требуется вход" }, 401);

        const orderId = Number(historyMatch[1]);

        let order;

        if (isAdmin(user)) {
          order = await env.DB.prepare(`
            SELECT id FROM orders WHERE id = ?
          `).bind(orderId).first();
        } else {
          order = await env.DB.prepare(`
            SELECT id FROM orders
            WHERE id = ? AND user_id = ?
          `).bind(orderId, user.id).first();
        }

        if (!order) {
          return json({ error: "Заявка не найдена" }, 404);
        }

        const history = await env.DB.prepare(`
          SELECT id, order_id, old_status, new_status,
                 changed_by, created_at
          FROM order_status_history
          WHERE order_id = ?
          ORDER BY id ASC
        `).bind(orderId).all();

        return json({ history: history.results });
      }

      // СПИСОК ЗАЯВОК ПОКУПАТЕЛЯ
      if (path === "/api/orders" && method === "GET") {
        const user = await getUser(request, env);

        if (!user) return json({ error: "Требуется вход" }, 401);

        const orders = await env.DB.prepare(`
          SELECT
            id, product_url, product_price_cny, weight_kg,
            total_price_rub, product_price_rub, delivery_cost_rub,
            insurance_cost_rub, commission_cost_rub, extra_costs_rub,
            markup_rub, status, created_at
          FROM orders
          WHERE user_id = ?
          ORDER BY id DESC
        `).bind(user.id).all();

        return json({ orders: orders.results });
      }

      // ВСЕ ЗАЯВКИ ПОСТАВЩИКА
      if (path === "/api/admin/orders" && method === "GET") {
        const auth = await requireAdmin(request, env);
        if (auth.error) return auth.error;

        const orders = await env.DB.prepare(`
          SELECT
            orders.id, orders.user_id, users.email,
            orders.product_url, orders.product_price_cny,
            orders.weight_kg, orders.total_price_rub,
            orders.product_price_rub, orders.delivery_cost_rub,
            orders.insurance_cost_rub, orders.commission_cost_rub,
            orders.extra_costs_rub, orders.markup_rub,
            orders.status, orders.created_at
          FROM orders
          JOIN users ON users.id = orders.user_id
          ORDER BY orders.id DESC
        `).all();

        return json({ orders: orders.results });
      }

      // ИЗМЕНЕНИЕ СТАТУСА ПОСТАВЩИКОМ
      const statusMatch = path.match(
        /^\/api\/admin\/orders\/(\d+)\/status$/
      );

      if (statusMatch && method === "PATCH") {
        const auth = await requireAdmin(request, env);
        if (auth.error) return auth.error;

        const orderId = Number(statusMatch[1]);
        const body = await request.json();
        const newStatus = String(body.status || "");

        const transitions = {
          confirmed: "purchased",
          purchased: "in_transit",
          in_transit: "arrived",
          arrived: "shipped",
          shipped: "delivered"
        };

        const order = await env.DB.prepare(`
          SELECT id, user_id, status
          FROM orders
          WHERE id = ?
        `).bind(orderId).first();

        if (!order) {
          return json({ error: "Заявка не найдена" }, 404);
        }

        const expectedNext = transitions[order.status];

        if (!expectedNext || newStatus !== expectedNext) {
          return json({
            error: "Недопустимый переход статуса. Обновите страницу."
          }, 400);
        }

        const result = await env.DB.prepare(`
          UPDATE orders
          SET status = ?
          WHERE id = ? AND status = ?
        `).bind(newStatus, orderId, order.status).run();

        if (!result.meta.changes) {
          return json({
            error: "Статус уже изменён. Обновите список заявок."
          }, 409);
        }

        await saveStatusHistory(
          env,
          orderId,
          order.status,
          newStatus,
          auth.user.email
        );

        // УВЕДОМЛЕНИЕ ПОКУПАТЕЛЮ
        await createNotification(
          env,
          order.user_id,
          orderId,
          "Изменился статус заказа",
          `Статус вашей заявки №${orderId} изменён: ${statusName(newStatus)}.`
        );

        return json({
          message: "Статус заказа обновлён",
          order_id: orderId,
          status: newStatus
        });
      }

      // ПОЛУЧЕНИЕ ТАРИФОВ
      if (path === "/api/admin/settings" && method === "GET") {
        const auth = await requireAdmin(request, env);
        if (auth.error) return auth.error;

        const settings = await env.DB.prepare(`
          SELECT exchange_rate, delivery_price_per_kg,
                 insurance_percent, commission_percent,
                 extra_costs, markup_percent
          FROM settings
          WHERE id = 1
        `).first();

        if (!settings) {
          return json({
            error: "Настройки тарифов не найдены"
          }, 500);
        }

        return json({ settings });
      }

      // СОХРАНЕНИЕ ТАРИФОВ
      if (path === "/api/admin/settings" && method === "PUT") {
        const auth = await requireAdmin(request, env);
        if (auth.error) return auth.error;

        const body = await request.json();

        const fields = [
          "exchange_rate",
          "delivery_price_per_kg",
          "insurance_percent",
          "commission_percent",
          "extra_costs",
          "markup_percent"
        ];

        const values = fields.map(field => Number(body[field]));

        if (values.some(value => !validNonNegative(value))) {
          return json({
            error: "Проверьте значения тарифов"
          }, 400);
        }

        if (values[0] <= 0) {
          return json({
            error: "Курс юаня должен быть больше нуля"
          }, 400);
        }

        await env.DB.prepare(`
          UPDATE settings
          SET exchange_rate = ?,
              delivery_price_per_kg = ?,
              insurance_percent = ?,
              commission_percent = ?,
              extra_costs = ?,
              markup_percent = ?
          WHERE id = 1
        `).bind(...values).run();

        return json({ message: "Тарифы сохранены" });
      }

      // РАСЧЁТ ЗАЯВКИ ПО ВЕСУ
      const orderMatch = path.match(
        /^\/api\/admin\/orders\/(\d+)$/
      );

      if (orderMatch && method === "PATCH") {
        const auth = await requireAdmin(request, env);
        if (auth.error) return auth.error;

        const orderId = Number(orderMatch[1]);
        const body = await request.json();
        const weight = Number(body.weight_kg);

        if (!Number.isFinite(weight) || weight <= 0 || weight > 100000) {
          return json({
            error: "Укажите корректный вес товара в килограммах"
          }, 400);
        }

        const order = await env.DB.prepare(`
          SELECT id, user_id, product_price_cny, status
          FROM orders
          WHERE id = ?
        `).bind(orderId).first();

        if (!order) {
          return json({ error: "Заявка не найдена" }, 404);
        }

        const settings = await env.DB.prepare(`
          SELECT exchange_rate, delivery_price_per_kg,
                 insurance_percent, commission_percent,
                 extra_costs, markup_percent
          FROM settings
          WHERE id = 1
        `).first();

        if (!settings) {
          return json({
            error: "Настройки тарифов не найдены"
          }, 500);
        }

        const productRub = Number(order.product_price_cny) *
          Number(settings.exchange_rate);

        const deliveryRub = weight *
          Number(settings.delivery_price_per_kg);

        const insuranceRub = productRub *
          Number(settings.insurance_percent) / 100;

        const commissionRub = productRub *
          Number(settings.commission_percent) / 100;

        const extraCostsRub = Number(settings.extra_costs);

        const subtotal = productRub + deliveryRub +
          insuranceRub + commissionRub + extraCostsRub;

        const markupRub = subtotal *
          Number(settings.markup_percent) / 100;

        const total = Math.round((subtotal + markupRub) * 100) / 100;

        const result = await env.DB.prepare(`
          UPDATE orders
          SET weight_kg = ?,
              delivery_price_per_kg = ?,
              exchange_rate = ?,
              insurance = ?,
              commission = ?,
              extra_costs = ?,
              markup = ?,
              product_price_rub = ?,
              delivery_cost_rub = ?,
              insurance_cost_rub = ?,
              commission_cost_rub = ?,
              extra_costs_rub = ?,
              markup_rub = ?,
              total_price_rub = ?,
              status = 'calculated'
          WHERE id = ?
        `).bind(
          weight,
          settings.delivery_price_per_kg,
          settings.exchange_rate,
          insuranceRub,
          commissionRub,
          extraCostsRub,
          markupRub,
          productRub,
          deliveryRub,
          insuranceRub,
          commissionRub,
          extraCostsRub,
          markupRub,
          total,
          orderId
        ).run();

        if (result.meta.changes && order.status !== "calculated") {
          await saveStatusHistory(
            env,
            orderId,
            order.status,
            "calculated",
            auth.user.email
          );

          // УВЕДОМЛЕНИЕ ПОКУПАТЕЛЮ О РАСЧЁТЕ
          await createNotification(
            env,
            order.user_id,
            orderId,
            "Стоимость заказа рассчитана",
            `Для заявки №${orderId} рассчитана итоговая стоимость ${total.toLocaleString("ru-RU")} RUB. Проверьте заказ и подтвердите его в личном кабинете.`
          );
        }

        return json({
          message: "Расчёт выполнен",
          calculation: {
            product_rub: productRub,
            delivery_rub: deliveryRub,
            insurance_rub: insuranceRub,
            commission_rub: commissionRub,
            extra_costs_rub: extraCostsRub,
            markup_rub: markupRub,
            total_price_rub: total
          }
        });
      }

      // ВЫХОД
      if (path === "/api/logout" && method === "POST") {
        const authorization = request.headers.get("Authorization") || "";
        const token = authorization.startsWith("Bearer ")
          ? authorization.slice(7)
          : "";

        if (token) {
          await env.DB.prepare(
            "DELETE FROM sessions WHERE token_hash = ?"
          ).bind(await sha256(token)).run();
        }

        return json({ message: "Выход выполнен" });
      }

      if (path.startsWith("/api/")) {
        return json({
          error: "API endpoint not found"
        }, 404);
      }

      return env.ASSETS.fetch(request);

    } catch (error) {
      console.error("Worker error:", error);

      return json({
        error: "Внутренняя ошибка сервера"
      }, 500);
    }
  }
};
