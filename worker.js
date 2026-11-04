
const json = (data, status = 200) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" }
  });

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
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
  try {
    const parts = stored.split("$");
    if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;

    const salt = fromBase64url(parts[2]);
    const hash = await hashPassword(password, salt);
    return hash === parts[3];
  } catch {
    return false;
  }
}

function effectiveRole(user, env) {
  const adminEmail = String(env.ADMIN_EMAIL || "").trim().toLowerCase();

  return adminEmail && user.email.toLowerCase() === adminEmail
    ? "admin"
    : "customer";
}

async function getUser(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";

  if (!token) return null;

  const tokenHash = await sha256(token);

  const user = await env.DB.prepare(`
    SELECT users.id, users.email
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ?
      AND sessions.expires_at > ?
  `).bind(tokenHash, new Date().toISOString()).first();

  if (!user) return null;

  return {
    ...user,
    role: effectiveRole(user, env)
  };
}

async function requireAdmin(request, env) {
  const user = await getUser(request, env);

  if (!user) {
    return { error: json({ error: "Требуется вход" }, 401) };
  }

  if (user.role !== "admin") {
    return { error: json({ error: "Недостаточно прав" }, 403) };
  }

  return { user };
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

function validNumber(value, min = 0, max = 100000000) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max;
}

async function getSettings(env) {
  return await env.DB.prepare(`
    SELECT exchange_rate, delivery_price_per_kg,
           insurance_percent, commission_percent,
           extra_costs, markup_percent
    FROM settings
    WHERE id = 1
  `).first();
}

function calculateOrder(order, settings, weight) {
  const productRub = order.product_price_cny * settings.exchange_rate;
  const delivery = weight * settings.delivery_price_per_kg;
  const insurance = productRub * settings.insurance_percent / 100;
  const commission = productRub * settings.commission_percent / 100;

  const subtotal =
    productRub + delivery + insurance +
    commission + settings.extra_costs;

  const markup = subtotal * settings.markup_percent / 100;
  const total = subtotal + markup;

  return {
    weight_kg: weight,
    delivery_price_per_kg: settings.delivery_price_per_kg,
    exchange_rate: settings.exchange_rate,
    insurance,
    commission,
    extra_costs: settings.extra_costs,
    markup,
    total_price_rub: Math.round(total * 100) / 100
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      if (path === "/api/health" && method === "GET") {
        const result = await env.DB
          .prepare("SELECT 1 AS connected")
          .first();

        return json({
          status: "ok",
          database: result?.connected === 1
        });
      }

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
          return json({ error: "Этот email уже зарегистрирован" }, 409);
        }

        const passwordHash = await createPasswordHash(password);

        const result = await env.DB.prepare(`
          INSERT INTO users (email, password_hash, role)
          VALUES (?, ?, 'customer')
        `).bind(email, passwordHash).run();

        const user = {
          id: result.meta.last_row_id,
          email,
          role: effectiveRole({ email }, env)
        };

        const token = await createSession(user, env);

        return json({ user, token }, 201);
      }

      if (path === "/api/login" && method === "POST") {
        const body = await request.json();
        const email = String(body.email || "").trim().toLowerCase();
        const password = String(body.password || "");

        const user = await env.DB.prepare(`
          SELECT id, email, password_hash
          FROM users
          WHERE email = ?
        `).bind(email).first();

        if (!user || !(await verifyPassword(password, user.password_hash))) {
          return json({ error: "Неверный email или пароль" }, 401);
        }

        user.role = effectiveRole(user, env);
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

      if (path === "/api/me" && method === "GET") {
        const user = await getUser(request, env);

        if (!user) return json({ error: "Требуется вход" }, 401);

        return json({ user });
      }

      // СОЗДАНИЕ ЗАЯВКИ ПОКУПАТЕЛЕМ
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
          return json({ error: "Некорректная ссылка на товар" }, 400);
        }

        if (!["http:", "https:"].includes(parsedUrl.protocol)) {
          return json({ error: "Разрешены только HTTP и HTTPS ссылки" }, 400);
        }

        if (!validNumber(price, 0.01)) {
          return json({ error: "Укажи корректную цену товара в юанях" }, 400);
        }

        const result = await env.DB.prepare(`
          INSERT INTO orders (user_id, product_url, product_price_cny)
          VALUES (?, ?, ?)
        `).bind(user.id, productUrl, price).run();

        return json({
          message: "Заявка создана",
          order_id: result.meta.last_row_id,
          status: "new"
        }, 201);
      }

      // ЗАЯВКИ ПОКУПАТЕЛЯ
      if (path === "/api/orders" && method === "GET") {
        const user = await getUser(request, env);

        if (!user) return json({ error: "Требуется вход" }, 401);

        const orders = await env.DB.prepare(`
          SELECT id, product_url, product_price_cny,
                 weight_kg, total_price_rub, status, created_at
          FROM orders
          WHERE user_id = ?
          ORDER BY id DESC
        `).bind(user.id).all();

        return json({ orders: orders.results });
      }

      // ВСЕ ЗАЯВКИ — ТОЛЬКО АДМИНИСТРАТОР
      if (path === "/api/admin/orders" && method === "GET") {
        const auth = await requireAdmin(request, env);
        if (auth.error) return auth.error;

        const orders = await env.DB.prepare(`
          SELECT orders.id, orders.user_id, users.email,
                 orders.product_url, orders.product_price_cny,
                 orders.weight_kg, orders.delivery_price_per_kg,
                 orders.exchange_rate, orders.insurance,
                 orders.commission, orders.extra_costs,
                 orders.markup, orders.total_price_rub,
                 orders.status, orders.created_at
          FROM orders
          JOIN users ON users.id = orders.user_id
          ORDER BY orders.id DESC
        `).all();

        return json({ orders: orders.results });
      }

      // НАСТРОЙКИ ТАРИФОВ — ТОЛЬКО АДМИНИСТРАТОР
      if (path === "/api/admin/settings" && method === "GET") {
        const auth = await requireAdmin(request, env);
        if (auth.error) return auth.error;

        const settings = await getSettings(env);
        return json({ settings });
      }

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

        for (const field of fields) {
          if (!validNumber(body[field], 0, 100000000)) {
            return json({ error: `Некорректное значение: ${field}` }, 400);
          }
        }

        if (Number(body.exchange_rate) <= 0) {
          return json({ error: "Курс юаня должен быть больше нуля" }, 400);
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
        `).bind(
          Number(body.exchange_rate),
          Number(body.delivery_price_per_kg),
          Number(body.insurance_percent),
          Number(body.commission_percent),
          Number(body.extra_costs),
          Number(body.markup_percent)
        ).run();

        return json({
          message: "Настройки сохранены",
          settings: await getSettings(env)
        });
      }

      // ПРОВЕРКА ТОВАРА И РАСЧЁТ — ТОЛЬКО АДМИНИСТРАТОР
      const adminOrderMatch = path.match(/^\/api\/admin\/orders\/(\d+)$/);

      if (adminOrderMatch && method === "PATCH") {
        const auth = await requireAdmin(request, env);
        if (auth.error) return auth.error;

        const orderId = Number(adminOrderMatch[1]);
        const body = await request.json();

        const order = await env.DB.prepare(`
          SELECT id, product_price_cny
          FROM orders
          WHERE id = ?
        `).bind(orderId).first();

        if (!order) return json({ error: "Заявка не найдена" }, 404);

        const allowedStatuses = [
          "new", "checking", "calculated",
          "paid", "purchased", "shipped",
          "completed", "cancelled"
        ];

        let status = body.status;

        if (status !== undefined && !allowedStatuses.includes(status)) {
          return json({ error: "Недопустимый статус заявки" }, 400);
        }

        if (body.weight_kg === undefined) {
          if (!status) {
            return json({ error: "Укажи вес товара или статус" }, 400);
          }

          await env.DB.prepare(`
            UPDATE orders SET status = ? WHERE id = ?
          `).bind(status, orderId).run();

          return json({ message: "Статус обновлён", status });
        }

        if (!validNumber(body.weight_kg, 0.001, 100000)) {
          return json({ error: "Укажи корректный вес в килограммах" }, 400);
        }

        const settings = await getSettings(env);

        if (!settings) {
          return json({ error: "Настройки тарифов не найдены" }, 500);
        }

        const calculation = calculateOrder(
          order,
          settings,
          Number(body.weight_kg)
        );

        await env.DB.prepare(`
          UPDATE orders
          SET weight_kg = ?,
              delivery_price_per_kg = ?,
              exchange_rate = ?,
              insurance = ?,
              commission = ?,
              extra_costs = ?,
              markup = ?,
              total_price_rub = ?,
              status = ?
          WHERE id = ?
        `).bind(
          calculation.weight_kg,
          calculation.delivery_price_per_kg,
          calculation.exchange_rate,
          calculation.insurance,
          calculation.commission,
          calculation.extra_costs,
          calculation.markup,
          calculation.total_price_rub,
          status || "calculated",
          orderId
        ).run();

        return json({
          message: "Расчёт сохранён",
          order_id: orderId,
          calculation,
          status: status || "calculated"
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
        return json({ error: "API endpoint not found" }, 404);
      }

      return env.ASSETS.fetch(request);

    } catch (error) {
      console.error("Worker error:", error);
      return json({ error: "Внутренняя ошибка сервера" }, 500);
    }
  }
};
