
import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

const COOKIE = "tp_admin_session";
const corsHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

function reply(status, data, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, ...headers },
  });
}

function sign(value) {
  return crypto
    .createHmac("sha256", process.env.SESSION_SECRET || "")
    .update(value)
    .digest("hex");
}

function createToken() {
  const payload = Buffer.from(
    JSON.stringify({
      exp: Date.now() + 8 * 60 * 60 * 1000,
      nonce: crypto.randomBytes(16).toString("hex"),
    })
  ).toString("base64url");

  return payload + "." + sign(payload);
}

function validSession(request) {
  const cookie = request.headers.get("cookie") || "";
  const raw = cookie
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(COOKIE + "="))
    ?.slice(COOKIE.length + 1);

  if (!raw) return false;

  const [payload, signature] = raw.split(".");
  if (!payload || !signature || !/^[a-f0-9]{64}$/i.test(signature)) {
    return false;
  }

  const expected = sign(payload);
  const a = Buffer.from(signature, "hex");
  const b = Buffer.from(expected, "hex");

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return false;
  }

  try {
    return JSON.parse(
      Buffer.from(payload, "base64url").toString()
    ).exp > Date.now();
  } catch {
    return false;
  }
}

export default async (request, context) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  if (request.method !== "POST") {
    return reply(405, { ok: false, error: "Method not allowed" });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return reply(400, { ok: false, error: "Invalid request" });
  }

  const action = body.action;

  if (action === "login") {
    const username = process.env.ADMIN_USERNAME;
    const password = process.env.ADMIN_PASSWORD;
    const secret = process.env.SESSION_SECRET;

    if (!username || !password || !secret) {
      return reply(500, {
        ok: false,
        error: "Required Netlify environment variables are missing.",
      });
    }

    if (
      String(body.username || "") !== username ||
      String(body.password || "") !== password
    ) {
      return reply(401, {
        ok: false,
        error: "Username বা password ভুল।",
      });
    }

    const token = createToken();

    return reply(
      200,
      { ok: true, data: { loggedIn: true } },
      {
        "Set-Cookie":
          `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`,
      }
    );
  }

  if (action === "logout") {
    return reply(
      200,
      { ok: true, data: true },
      {
        "Set-Cookie":
          `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`,
      }
    );
  }

  if (action === "submit") {
    const data = body.payload || {};

    if (
      !String(data.client || "").trim() ||
      !String(data.project || "").trim() ||
      !Array.isArray(data.events) ||
      !data.events.length
    ) {
      return reply(400, {
        ok: false,
        error: "Client name, project name এবং অন্তত একটি event দিন।",
      });
    }

    try {
      const store = getStore("tumpa-song-submissions");
      const id = crypto.randomUUID();
      const record = {
        ...data,
        id,
        submittedAt: new Date().toISOString(),
      };

      await store.setJSON(id, record);

      const index = (await store.get("index", { type: "json" })) || [];
      index.push({ id, submittedAt: record.submittedAt });
      await store.setJSON("index", index);

      return reply(200, { ok: true, id });
    } catch (error) {
      console.error("Submission storage error:", error);
      return reply(500, {
        ok: false,
        error: "ডেটাবেসে সংরক্ষণ করা যায়নি। Netlify Blobs setup পরীক্ষা করুন।",
      });
    }
  }

  if (action === "list") {
    if (!validSession(request)) {
      return reply(401, {
        ok: false,
        error: "Session শেষ হয়েছে। আবার login করুন।",
      });
    }

    try {
      const store = getStore("tumpa-song-submissions");
      const index = (await store.get("index", { type: "json" })) || [];

      const records = await Promise.all(
        index.map((item) => store.get(item.id, { type: "json" }))
      );

      return reply(200, {
        ok: true,
        data: records
          .filter(Boolean)
          .sort((a, b) =>
            String(a.submittedAt).localeCompare(String(b.submittedAt))
          ),
      });
    } catch (error) {
      console.error("Submission list error:", error);
      return reply(500, {
        ok: false,
        error: "ডেটাবেস পড়া যায়নি।",
      });
    }
  }

  return reply(400, { ok: false, error: "Unknown action" });
};
