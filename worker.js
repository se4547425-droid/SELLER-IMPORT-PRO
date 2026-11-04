
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

  return await env.DB.prepare(`
    SELECT users.id, users.email, users.role
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ?
      AND sessions.expires_at > ?
  `).bind(tokenHash, new Date().toISOString()).first();
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/api/health") {
        const result = await env.DB
          .prepare("SELECT 1 AS connected")
          .first();

        return json({
          status: "ok",
          database: result?.connected === 1
        });
      }

      if (url.pathname === "/api/register" && request.method === "POST") {
        const body = await request.json();
        const email = String(body.email || "").trim().toLowerCase();
        const password = String(body.password || "");

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return json({ error: "Некорректный email" }, 400);
        }

        if (password.length < 8 || password.length > 128) {
          return json({ error: "Пароль должен содержать от 8 до 128 символов" }, 400);
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
          role: "customer"
        };

        const token = await createSession(user, env);

        return json({ user, token }, 201);
      }

      if (url.pathname === "/api/login" && request.method === "POST") {
        const body = await request.json();
        const email = String(body.email || "").trim().toLowerCase();
        const password = String(body.password || "");

        const user = await env.DB.prepare(`
          SELECT id, email, password_hash, role
          FROM users WHERE email = ?
        `).bind(email).first();

        if (!user || !(await verifyPassword(password, user.password_hash))) {
          return json({ error: "Неверный email или пароль" }, 401);
        }

        const token = await createSession(user, env);

        return json({
          user: { id: user.id, email: user.email, role: user.role },
          token
        });
      }

      if (url.pathname === "/api/me" && request.method === "GET") {
        const user = await getUser(request, env);

        if (!user) return json({ error: "Требуется вход" }, 401);

        return json({ user });
      }

      if (url.pathname === "/api/orders" && request.method === "POST") {
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

        if (!Number.isFinite(price) || price <= 0 || price > 100000000) {
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

      if (url.pathname === "/api/orders" && request.method === "GET") {
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

      if (url.pathname === "/api/logout" && request.method === "POST") {
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

      if (url.pathname.startsWith("/api/")) {
        return json({ error: "API endpoint not found" }, 404);
      }

      return env.ASSETS.fetch(request);

    } catch (error) {
      console.error("Worker error:", error);
      return json({ error: "Внутренняя ошибка сервера" }, 500);
    }
  }
};
