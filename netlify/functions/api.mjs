import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

const COOKIE = "tp_admin_session";
const SONG_STORE = "tumpa-song-submissions"; // Existing store: do not rename or delete.
const ADMIN_STORE = "tp-admin-data-v1";      // New, separate store for admin records.
const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

function reply(status, data, extraHeaders = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, ...extraHeaders } });
}
function sign(value) {
  return crypto.createHmac("sha256", process.env.SESSION_SECRET || "").update(value).digest("hex");
}
function createToken(user = { role: "admin", username: "admin" }) {
  const payload = Buffer.from(JSON.stringify({
    exp: Date.now() + 8 * 60 * 60 * 1000,
    nonce: crypto.randomBytes(16).toString("hex"),
    role: user.role || "admin",
    userId: user.userId || null,
    username: user.username || "admin"
  })).toString("base64url");
  return payload + "." + sign(payload);
}
function readSession(request) {
  const raw = (request.headers.get("cookie") || "").split(";").map(s => s.trim())
    .find(s => s.startsWith(COOKIE + "="))?.slice(COOKIE.length + 1);
  if (!raw) return null;
  const [payload, signature] = raw.split(".");
  if (!payload || !signature || !/^[a-f0-9]{64}$/i.test(signature)) return null;
  const a = Buffer.from(signature, "hex"), b = Buffer.from(sign(payload), "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!(session.exp > Date.now())) return null;
    // Existing signed admin sessions created by the previous version have no role.
    if (!session.role) session.role = "admin";
    return session;
  } catch { return null; }
}
function validSession(request) { return !!readSession(request); }
function isAdmin(request) { return readSession(request)?.role === "admin"; }
function passwordHash(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return { salt, hash };
}
function checkPassword(password, saved) {
  if (!saved?.salt || !saved?.hash) return false;
  const actual = crypto.scryptSync(String(password), saved.salt, 64);
  const expected = Buffer.from(saved.hash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
function teamUserStore() { return getStore("tp-team-users-v1"); }
function defaultData() { return { clients: [], projects: [], payments: [], team: [], updatedAt: null }; }
function sanitizeRows(rows, keys) {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 3000).map(row => {
    const clean = {};
    for (const key of keys) {
      const value = row?.[key];
      if (typeof value === "string") clean[key] = value.slice(0, 2000);
      else if (typeof value === "number" && Number.isFinite(value)) clean[key] = value;
      else if (typeof value === "boolean") clean[key] = value;
    }
    if (!clean.id) clean.id = crypto.randomUUID();
    return clean;
  });
}
function sanitizeData(input) {
  const d = input && typeof input === "object" ? input : {};
  return {
    clients: sanitizeRows(d.clients, ["id","name","phone","email","eventDate","notes","createdAt"]),
    projects: sanitizeRows(d.projects, ["id","clientId","clientName","name","type","status","startDate","dueDate","price","notes","assignedToTeamId","createdAt"]),
    payments: sanitizeRows(d.payments, ["id","projectId","clientName","projectName","amount","date","method","status","invoiceNo","notes","createdAt"]),
    team: sanitizeRows(d.team, ["id","name","role","phone","email","status","notes","createdAt"]),
    updatedAt: new Date().toISOString()
  };
}

export default async function handler(request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (request.method !== "POST") return reply(405, { ok: false, error: "Method not allowed" });

  let body;
  try { body = await request.json(); }
  catch { return reply(400, { ok: false, error: "Invalid request" }); }

  const action = body.action;
  if (action === "login") {
    const username = process.env.ADMIN_USERNAME, password = process.env.ADMIN_PASSWORD, secret = process.env.SESSION_SECRET;
    if (!username || !password || !secret) return reply(500, { ok: false, error: "Required Netlify environment variables are missing." });
    if (String(body.username || "") !== username || String(body.password || "") !== password)
      return reply(401, { ok: false, error: "Username বা password ভুল।" });
    return reply(200, { ok: true, data: { loggedIn: true, role: "admin" } }, {
      "Set-Cookie": `${COOKIE}=${createToken({ role: "admin", username })}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`
    });
  }
  if (action === "team-login") {
    if (!process.env.SESSION_SECRET) return reply(500, { ok: false, error: "SESSION_SECRET সেট করা নেই।" });
    const username = String(body.username || "").trim().toLowerCase();
    const password = String(body.password || "");
    try {
      const store = teamUserStore();
      const users = (await store.get("users", { type: "json" })) || [];
      const user = users.find(u => u.username === username && u.active !== false);
      if (!user || !checkPassword(password, user.password)) {
        return reply(401, { ok: false, error: "Team username বা password ভুল, অথবা account inactive।" });
      }
      return reply(200, { ok: true, data: { loggedIn: true, role: "team", name: user.name } }, {
        "Set-Cookie": `${COOKIE}=${createToken({ role: "team", userId: user.id, username: user.username })}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`
      });
    } catch (error) {
      console.error("Team login error:", error);
      return reply(500, { ok: false, error: "Team login data পড়া যায়নি।" });
    }
  }
  if (action === "logout") {
    return reply(200, { ok: true, data: true }, {
      "Set-Cookie": `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`
    });
  }

  // Public client-facing song selection submission; existing behavior/store preserved.
  if (action === "submit") {
    const data = body.payload || {};
    if (!String(data.client || "").trim() || !String(data.project || "").trim() ||
        !Array.isArray(data.events) || !data.events.length) {
      return reply(400, { ok: false, error: "Client name, project name এবং অন্তত একটি event দিন।" });
    }
    try {
      const store = getStore(SONG_STORE);
      const id = crypto.randomUUID();
      const record = { ...data, id, submittedAt: new Date().toISOString() };
      await store.setJSON(id, record);
      const index = (await store.get("index", { type: "json" })) || [];
      index.push({ id, submittedAt: record.submittedAt });
      await store.setJSON("index", index);
      return reply(200, { ok: true, id });
    } catch (error) {
      console.error("Submission storage error:", error);
      return reply(500, { ok: false, error: "ডেটাবেসে সংরক্ষণ করা যায়নি। Netlify Blobs setup পরীক্ষা করুন।" });
    }
  }

  if (action === "list") {
    if (!validSession(request) || !isAdmin(request)) return reply(403, { ok: false, error: "Song Selection list শুধু Admin দেখতে পারবেন।" });
    try {
      const store = getStore(SONG_STORE);
      const index = (await store.get("index", { type: "json" })) || [];
      const records = await Promise.all(index.map(item => store.get(item.id, { type: "json" })));
      return reply(200, { ok: true, data: records.filter(Boolean).sort((a,b) => String(a.submittedAt).localeCompare(String(b.submittedAt))) });
    } catch (error) {
      console.error("Submission list error:", error);
      return reply(500, { ok: false, error: "ডেটাবেস পড়া যায়নি।" });
    }
  }

  if (action === "team-user-save") {
    if (!validSession(request) || !isAdmin(request)) return reply(403, { ok: false, error: "শুধু Admin team login তৈরি বা পরিবর্তন করতে পারবেন।" });
    const name = String(body.payload?.name || "").trim();
    const username = String(body.payload?.username || "").trim().toLowerCase();
    const password = String(body.payload?.password || "");
    const memberId = String(body.payload?.memberId || "");
    if (!name || !/^[a-z0-9._-]{3,40}$/.test(username)) {
      return reply(400, { ok: false, error: "নাম দিন এবং username 3-40 অক্ষরের ইংরেজি অক্ষর/সংখ্যা/._- দিয়ে দিন।" });
    }
    if (password.length < 10) return reply(400, { ok: false, error: "Team password কমপক্ষে 10 অক্ষরের হতে হবে।" });
    try {
      const store = teamUserStore();
      const users = (await store.get("users", { type: "json" })) || [];
      if (users.some(u => u.username === username && u.id !== memberId)) return reply(409, { ok: false, error: "এই username আগে থেকেই আছে।" });
      const id = memberId || crypto.randomUUID();
      const old = users.find(u => u.id === id);
      const user = { id, name, username, password: passwordHash(password), active: true, createdAt: old?.createdAt || new Date().toISOString() };
      const next = users.filter(u => u.id !== id);
      next.push(user);
      await store.setJSON("users", next);
      return reply(200, { ok: true, data: { id, username, name, active: true } });
    } catch (error) {
      console.error("Team user save error:", error);
      return reply(500, { ok: false, error: "Team login তৈরি করা যায়নি।" });
    }
  }

  if (action === "team-user-disable") {
    if (!validSession(request) || !isAdmin(request)) return reply(403, { ok: false, error: "শুধু Admin এই কাজ করতে পারবেন।" });
    try {
      const store = teamUserStore();
      const users = (await store.get("users", { type: "json" })) || [];
      const next = users.map(u => u.id === body.userId ? { ...u, active: false } : u);
      await store.setJSON("users", next);
      return reply(200, { ok: true, data: true });
    } catch (error) {
      console.error("Team user disable error:", error);
      return reply(500, { ok: false, error: "Team account disable করা যায়নি।" });
    }
  }

  if (action === "team-data-get") {
    const session = readSession(request);
    if (!session || session.role !== "team") return reply(403, { ok: false, error: "Team login প্রয়োজন।" });
    try {
      const store = getStore(ADMIN_STORE);
      const data = (await store.get("dashboard", { type: "json" })) || defaultData();
      const userStore = teamUserStore();
      const users = (await userStore.get("users", { type: "json" })) || [];
      const user = users.find(u => u.id === session.userId && u.active !== false);
      if (!user) return reply(401, { ok: false, error: "Team account বন্ধ করা হয়েছে। আবার Admin-এর সঙ্গে যোগাযোগ করুন।" });
      const projects = (data.projects || []).filter(p => p.assignedToTeamId === user.id);
      return reply(200, { ok: true, data: { name: user.name, projects: projects.map(p => ({
        name: p.name, type: p.type, status: p.status, dueDate: p.dueDate, notes: p.notes || ""
      })) } });
    } catch (error) {
      console.error("Team project read error:", error);
      return reply(500, { ok: false, error: "Assigned projects পড়া যায়নি।" });
    }
  }

  if (action === "admin-data-get" || action === "admin-data-save") {
    if (!validSession(request) || !isAdmin(request)) return reply(403, { ok: false, error: "এই কাজটি শুধু Admin করতে পারবেন।" });
    try {
      const store = getStore(ADMIN_STORE);
      if (action === "admin-data-get") {
        const data = (await store.get("dashboard", { type: "json" })) || defaultData();
        return reply(200, { ok: true, data });
      }
      const data = sanitizeData(body.payload);
      await store.setJSON("dashboard", data);
      return reply(200, { ok: true, data: { saved: true, updatedAt: data.updatedAt } });
    } catch (error) {
      console.error("Admin data error:", error);
      return reply(500, { ok: false, error: "Dashboard data পড়া বা সেভ করা যায়নি।" });
    }
  }
  return reply(400, { ok: false, error: "Unknown action" });
}
