const fs = require("fs/promises");
const path = require("path");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const DATA_DIR = path.join(__dirname, "..", "data");
const USERS_PATH = path.join(DATA_DIR, "users.json");
const ALERTS_PATH = path.join(DATA_DIR, "alerts.json");

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const TOKEN_TTL = "8h";

function safeJsonParse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return safeJsonParse(raw, fallback);
  } catch (err) {
    if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) return fallback;
    throw err;
  }
}

async function writeJsonAtomic(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, filePath);
}

function createId(prefix) {
  const n = Math.floor(100000 + Math.random() * 900000);
  return `${prefix}-${n}`;
}

function normalizeDangerLevel(level) {
  const v = String(level || "").trim().toLowerCase();
  if (v === "high") return "High";
  if (v === "medium") return "Medium";
  if (v === "low") return "Low";
  return "Medium";
}

function riskToDangerLevel(riskLevel) {
  const v = Number(riskLevel);
  if (Number.isNaN(v)) return "Medium";
  if (v >= 70) return "High";
  if (v >= 40) return "Medium";
  return "Low";
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing Bearer token" });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function adminRequired(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin only" });
  return next();
}

async function ensureAdminUser() {
  const data = await readJson(USERS_PATH, { users: [] });
  const users = Array.isArray(data.users) ? data.users : [];

  const admin = users.find((u) => String(u.username).toLowerCase() === "admin");
  if (admin && admin.passwordHash && admin.role === "admin") return;

  const passwordHash = await bcrypt.hash("admin123", 10);
  const now = new Date().toISOString();

  const nextUsers = users.filter((u) => String(u.username).toLowerCase() !== "admin");
  nextUsers.push({
    id: "USR-ADMIN",
    username: "admin",
    email: "admin@aidisaster.local",
    passwordHash,
    role: "admin",
    savedAlerts: [],
    createdAt: now
  });

  await writeJsonAtomic(USERS_PATH, { users: nextUsers });
}

function buildRoutes() {
  const router = express.Router();

  router.get("/health", (req, res) => res.json({ ok: true, service: "ai-disaster-api" }));

  // Auth
  router.post("/auth/register", async (req, res) => {
    const { username, email, password } = req.body || {};
    if (!username || !email || !password) return res.status(400).json({ error: "username, email, password required" });

    const data = await readJson(USERS_PATH, { users: [] });
    const users = Array.isArray(data.users) ? data.users : [];

    const uname = String(username).trim();
    const mail = String(email).trim().toLowerCase();

    if (users.some((u) => String(u.username).toLowerCase() === uname.toLowerCase())) {
      return res.status(409).json({ error: "Username already exists" });
    }
    if (users.some((u) => String(u.email).toLowerCase() === mail)) {
      return res.status(409).json({ error: "Email already exists" });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);
    const now = new Date().toISOString();

    const user = {
      id: createId("USR"),
      username: uname,
      email: mail,
      passwordHash,
      role: "user",
      savedAlerts: [],
      createdAt: now
    };

    users.push(user);
    await writeJsonAtomic(USERS_PATH, { users });

    return res.json({ ok: true });
  });

  router.post("/auth/login", async (req, res) => {
    const { usernameOrEmail, password } = req.body || {};
    if (!usernameOrEmail || !password) return res.status(400).json({ error: "usernameOrEmail and password required" });

    const data = await readJson(USERS_PATH, { users: [] });
    const users = Array.isArray(data.users) ? data.users : [];

    const key = String(usernameOrEmail).trim().toLowerCase();
    const user = users.find(
      (u) => String(u.username).toLowerCase() === key || String(u.email).toLowerCase() === key
    );
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const ok = await bcrypt.compare(String(password), String(user.passwordHash || ""));
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const token = jwt.sign(
      { sub: user.id, username: user.username, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: TOKEN_TTL }
    );

    return res.json({
      token,
      user: { id: user.id, username: user.username, email: user.email, role: user.role, savedAlerts: user.savedAlerts || [] }
    });
  });

  router.get("/me", authRequired, async (req, res) => {
    const data = await readJson(USERS_PATH, { users: [] });
    const users = Array.isArray(data.users) ? data.users : [];
    const user = users.find((u) => u.id === req.user.sub);
    if (!user) return res.status(404).json({ error: "User not found" });

    return res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      savedAlerts: user.savedAlerts || [],
      createdAt: user.createdAt
    });
  });

  // Alerts
  router.get("/alerts", async (req, res) => {
    const data = await readJson(ALERTS_PATH, { alerts: [] });
    const alerts = Array.isArray(data.alerts) ? data.alerts : [];
    alerts.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    return res.json({ alerts });
  });

  router.post("/alerts", authRequired, adminRequired, async (req, res) => {
    const { type, location, dangerLevel, message, riskLevel, lat, lng } = req.body || {};
    if (!type || !location || !message) return res.status(400).json({ error: "type, location, message required" });

    const data = await readJson(ALERTS_PATH, { alerts: [] });
    const alerts = Array.isArray(data.alerts) ? data.alerts : [];

    const risk = typeof riskLevel === "number" ? riskLevel : Number(riskLevel);
    const finalRisk = Number.isFinite(risk) ? Math.max(0, Math.min(100, risk)) : null;

    const alert = {
      id: createId("ALRT"),
      type: String(type).trim(),
      location: String(location).trim(),
      dangerLevel: dangerLevel ? normalizeDangerLevel(dangerLevel) : riskToDangerLevel(finalRisk),
      message: String(message).trim(),
      riskLevel: finalRisk ?? (dangerLevel ? (normalizeDangerLevel(dangerLevel) === "High" ? 80 : normalizeDangerLevel(dangerLevel) === "Low" ? 25 : 55) : 55),
      lat: typeof lat === "number" ? lat : Number(lat),
      lng: typeof lng === "number" ? lng : Number(lng),
      createdAt: new Date().toISOString()
    };

    if (!Number.isFinite(alert.lat)) delete alert.lat;
    if (!Number.isFinite(alert.lng)) delete alert.lng;

    alerts.push(alert);
    await writeJsonAtomic(ALERTS_PATH, { alerts });
    return res.json({ ok: true, alert });
  });

  router.put("/alerts/:id", authRequired, adminRequired, async (req, res) => {
    const { id } = req.params;
    const patch = req.body || {};

    const data = await readJson(ALERTS_PATH, { alerts: [] });
    const alerts = Array.isArray(data.alerts) ? data.alerts : [];
    const idx = alerts.findIndex((a) => a.id === id);
    if (idx === -1) return res.status(404).json({ error: "Alert not found" });

    const existing = alerts[idx];
    const updated = {
      ...existing,
      ...(patch.type ? { type: String(patch.type).trim() } : {}),
      ...(patch.location ? { location: String(patch.location).trim() } : {}),
      ...(patch.message ? { message: String(patch.message).trim() } : {}),
      ...(patch.dangerLevel ? { dangerLevel: normalizeDangerLevel(patch.dangerLevel) } : {}),
      ...(patch.riskLevel !== undefined
        ? { riskLevel: Math.max(0, Math.min(100, Number(patch.riskLevel))) }
        : {}),
      ...(patch.lat !== undefined ? { lat: Number(patch.lat) } : {}),
      ...(patch.lng !== undefined ? { lng: Number(patch.lng) } : {})
    };
    if (!Number.isFinite(updated.lat)) delete updated.lat;
    if (!Number.isFinite(updated.lng)) delete updated.lng;

    if (patch.riskLevel !== undefined && !patch.dangerLevel) {
      updated.dangerLevel = riskToDangerLevel(updated.riskLevel);
    }

    alerts[idx] = updated;
    await writeJsonAtomic(ALERTS_PATH, { alerts });
    return res.json({ ok: true, alert: updated });
  });

  router.delete("/alerts/:id", authRequired, adminRequired, async (req, res) => {
    const { id } = req.params;
    const data = await readJson(ALERTS_PATH, { alerts: [] });
    const alerts = Array.isArray(data.alerts) ? data.alerts : [];
    const next = alerts.filter((a) => a.id !== id);
    if (next.length === alerts.length) return res.status(404).json({ error: "Alert not found" });
    await writeJsonAtomic(ALERTS_PATH, { alerts: next });
    return res.json({ ok: true });
  });

  // Saved alerts
  router.post("/me/saved-alerts/:id", authRequired, async (req, res) => {
    const alertId = req.params.id;

    const usersData = await readJson(USERS_PATH, { users: [] });
    const users = Array.isArray(usersData.users) ? usersData.users : [];
    const uidx = users.findIndex((u) => u.id === req.user.sub);
    if (uidx === -1) return res.status(404).json({ error: "User not found" });

    const alertsData = await readJson(ALERTS_PATH, { alerts: [] });
    const alerts = Array.isArray(alertsData.alerts) ? alertsData.alerts : [];
    if (!alerts.some((a) => a.id === alertId)) return res.status(404).json({ error: "Alert not found" });

    const user = users[uidx];
    const saved = new Set(Array.isArray(user.savedAlerts) ? user.savedAlerts : []);
    saved.add(alertId);
    users[uidx] = { ...user, savedAlerts: Array.from(saved) };
    await writeJsonAtomic(USERS_PATH, { users });
    return res.json({ ok: true, savedAlerts: users[uidx].savedAlerts });
  });

  router.delete("/me/saved-alerts/:id", authRequired, async (req, res) => {
    const alertId = req.params.id;

    const usersData = await readJson(USERS_PATH, { users: [] });
    const users = Array.isArray(usersData.users) ? usersData.users : [];
    const uidx = users.findIndex((u) => u.id === req.user.sub);
    if (uidx === -1) return res.status(404).json({ error: "User not found" });

    const user = users[uidx];
    const saved = new Set(Array.isArray(user.savedAlerts) ? user.savedAlerts : []);
    saved.delete(alertId);
    users[uidx] = { ...user, savedAlerts: Array.from(saved) };
    await writeJsonAtomic(USERS_PATH, { users });
    return res.json({ ok: true, savedAlerts: users[uidx].savedAlerts });
  });

  // Simulated AI prediction
  router.post("/predict", authRequired, async (req, res) => {
    const { temperature, rainfall, windSpeed, seismicActivity } = req.body || {};

    const t = Number(temperature);
    const r = Number(rainfall);
    const w = Number(windSpeed);
    const s = Number(seismicActivity);

    if (![t, r, w, s].every((x) => Number.isFinite(x))) {
      return res.status(400).json({ error: "temperature, rainfall, windSpeed, seismicActivity must be numbers" });
    }

    // Simple heuristic scoring (0..100)
    const flood = Math.max(0, Math.min(100, r * 1.1 + (t < 5 ? 10 : 0) + (w > 35 ? 10 : 0)));
    const wildfire = Math.max(0, Math.min(100, (t - 18) * 3 + (50 - r) * 1.1 + w * 0.7));
    const hurricane = Math.max(0, Math.min(100, w * 1.6 + r * 0.35));
    const earthquake = Math.max(0, Math.min(100, s * 12.5));

    const maxScore = Math.max(flood, wildfire, hurricane, earthquake);
    const overall =
      maxScore >= 70 ? "High Risk" : maxScore >= 40 ? "Medium Risk" : "Low Risk";

    const primary =
      maxScore === earthquake
        ? "Earthquake"
        : maxScore === flood
          ? "Flood"
          : maxScore === hurricane
            ? "Hurricane"
            : "Wildfire";

    return res.json({
      overall,
      primary,
      scores: {
        earthquake: Math.round(earthquake),
        flood: Math.round(flood),
        wildfire: Math.round(wildfire),
        hurricane: Math.round(hurricane)
      }
    });
  });

  return router;
}

module.exports = { buildRoutes, ensureAdminUser };

