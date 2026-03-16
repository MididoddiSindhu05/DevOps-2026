/* global bootstrap, Chart, L */

const API_BASE = "";
const LS_TOKEN = "aidpms_token";
const LS_USER = "aidpms_user";
const LS_MUTE = "aidpms_mute_alarm";

function $(sel, root = document) {
  return root.querySelector(sel);
}
function $all(sel, root = document) {
  return Array.from(root.querySelectorAll(sel));
}

function getToken() {
  return localStorage.getItem(LS_TOKEN) || "";
}
function setSession(token, user) {
  localStorage.setItem(LS_TOKEN, token);
  localStorage.setItem(LS_USER, JSON.stringify(user || null));
}
function clearSession() {
  localStorage.removeItem(LS_TOKEN);
  localStorage.removeItem(LS_USER);
}
function getUser() {
  try {
    return JSON.parse(localStorage.getItem(LS_USER) || "null");
  } catch {
    return null;
  }
}

function isMuted() {
  return localStorage.getItem(LS_MUTE) === "1";
}
function setMuted(v) {
  localStorage.setItem(LS_MUTE, v ? "1" : "0");
}

async function api(path, { method = "GET", body, auth = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data && data.error ? data.error : `Request failed (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function toast(message, variant = "info") {
  const host = $("#toastHost");
  if (!host) return alert(message);

  const el = document.createElement("div");
  el.className = `toast align-items-center text-bg-${variant} border-0`;
  el.role = "alert";
  el.ariaLive = "assertive";
  el.ariaAtomic = "true";
  el.innerHTML = `
    <div class="d-flex">
      <div class="toast-body">${escapeHtml(message)}</div>
      <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
    </div>
  `;
  host.appendChild(el);
  const t = new bootstrap.Toast(el, { delay: 3200 });
  el.addEventListener("hidden.bs.toast", () => el.remove());
  t.show();
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function dangerClass(level) {
  const v = String(level || "").toLowerCase();
  if (v === "high") return "badge-high";
  if (v === "medium") return "badge-medium";
  return "badge-low";
}

function protectPage() {
  // Public pages: Home + Disaster info (read-only)
  const publicPages = new Set(["index.html", "disasters.html", ""]);
  const file = location.pathname.split("/").pop();
  if (publicPages.has(file)) return;
  if (!getToken()) location.href = "index.html";
}

function setActiveNav() {
  const file = location.pathname.split("/").pop() || "index.html";
  $all(".nav-link[data-page]").forEach((a) => {
    a.classList.toggle("active", a.getAttribute("data-page") === file);
  });
}

function renderAuthUI() {
  const user = getUser();
  const authed = !!getToken() && !!user;
  const authOnly = $all("[data-auth='in']");
  const guestOnly = $all("[data-auth='out']");

  authOnly.forEach((el) => (el.style.display = authed ? "" : "none"));
  guestOnly.forEach((el) => (el.style.display = authed ? "none" : ""));

  const who = $("#navUser");
  if (who) who.textContent = authed ? `${user.username} (${user.role})` : "";

  const adminLinks = $all("[data-admin-only]");
  adminLinks.forEach((el) => {
    const show = authed && user.role === "admin";
    el.style.display = show ? "" : "none";
  });
}

function bindLogout() {
  const btn = $("#btnLogout");
  if (!btn) return;
  btn.addEventListener("click", () => {
    clearSession();
    toast("Logged out.", "secondary");
    setTimeout(() => (location.href = "index.html"), 350);
  });
}

// Alarm: WebAudio (no external file needed)
let audioCtx = null;
let alarmOsc = null;
let alarmGain = null;
function alarmStart() {
  if (isMuted()) return;
  if (!window.AudioContext && !window.webkitAudioContext) return;
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (alarmOsc) return;

  alarmOsc = audioCtx.createOscillator();
  alarmGain = audioCtx.createGain();
  alarmOsc.type = "square";
  alarmOsc.frequency.value = 880;
  alarmGain.gain.value = 0.0001;
  alarmOsc.connect(alarmGain);
  alarmGain.connect(audioCtx.destination);
  alarmOsc.start();

  // siren-ish modulation
  const now = audioCtx.currentTime;
  alarmGain.gain.setValueAtTime(0.0001, now);
  alarmGain.gain.exponentialRampToValueAtTime(0.22, now + 0.12);
  alarmOsc.frequency.setValueAtTime(660, now);
  alarmOsc.frequency.linearRampToValueAtTime(980, now + 0.35);
  alarmOsc.frequency.linearRampToValueAtTime(660, now + 0.7);
}
function alarmStop() {
  if (!alarmOsc) return;
  try {
    alarmGain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.08);
    setTimeout(() => {
      try {
        alarmOsc.stop();
      } catch {}
      alarmOsc = null;
      alarmGain = null;
    }, 120);
  } catch {
    alarmOsc = null;
    alarmGain = null;
  }
}

async function refreshMe() {
  if (!getToken()) return null;
  const me = await api("/me");
  localStorage.setItem(LS_USER, JSON.stringify(me));
  return me;
}

// Page initializers
async function initIndex() {
  const loginForm = $("#loginForm");
  const registerForm = $("#registerForm");

  const tryAuto = async () => {
    if (!getToken()) return;
    try {
      await refreshMe();
      renderAuthUI();
      toast("Session active. Welcome back!", "success");
    } catch {
      clearSession();
    }
  };
  await tryAuto();

  loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const usernameOrEmail = $("#loginUser").value.trim();
    const password = $("#loginPass").value;
    try {
      const data = await api("/auth/login", { method: "POST", body: { usernameOrEmail, password }, auth: false });
      setSession(data.token, data.user);
      renderAuthUI();
      toast("Login successful.", "success");
      setTimeout(() => (location.href = "dashboard.html"), 400);
    } catch (err) {
      toast(err.message || "Login failed", "danger");
    }
  });

  registerForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = $("#regUser").value.trim();
    const email = $("#regEmail").value.trim();
    const password = $("#regPass").value;
    try {
      await api("/auth/register", { method: "POST", body: { username, email, password }, auth: false });
      toast("Registration complete. You can now login.", "success");
      $("#tab-login")?.click();
      registerForm.reset();
    } catch (err) {
      toast(err.message || "Registration failed", "danger");
    }
  });
}

function makeSparkline(el, data, color = "rgba(77,163,255,.9)") {
  if (!el) return;
  // eslint-disable-next-line no-new
  new Chart(el, {
    type: "line",
    data: {
      labels: data.map((_, i) => i + 1),
      datasets: [
        {
          data,
          borderColor: color,
          backgroundColor: "rgba(77,163,255,.12)",
          tension: 0.35,
          fill: true,
          pointRadius: 0,
          borderWidth: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { display: false }, y: { display: false } }
    }
  });
}

async function initDashboard() {
  await refreshMe().catch(() => {});

  const alerts = (await api("/alerts", { auth: false })).alerts || [];
  $("#kpiAlerts") && ($("#kpiAlerts").textContent = String(alerts.length));
  $("#kpiHigh") && ($("#kpiHigh").textContent = String(alerts.filter((a) => String(a.dangerLevel).toLowerCase() === "high").length));

  const recent = alerts.slice(0, 6);
  const list = $("#recentAlerts");
  if (list) {
    list.innerHTML = recent
      .map(
        (a) => `
      <div class="card card-soft mb-2 ${String(a.dangerLevel).toLowerCase() === "high" ? "pulse" : ""}">
        <div class="card-body py-3">
          <div class="d-flex align-items-start justify-content-between gap-3">
            <div>
              <div class="d-flex align-items-center gap-2">
                <i class="bi bi-broadcast"></i>
                <span class="fw-bold">${escapeHtml(a.type)}</span>
                <span class="badge-level ${dangerClass(a.dangerLevel)}">${escapeHtml(a.dangerLevel)}</span>
              </div>
              <div class="muted small mt-1">${escapeHtml(a.location)} • ${new Date(a.createdAt).toLocaleString()}</div>
              <div class="mt-2">${escapeHtml(a.message)}</div>
            </div>
            <div class="text-end">
              <div class="fw-bold">${Math.round(Number(a.riskLevel) || 0)}%</div>
              <div class="muted small">Risk</div>
            </div>
          </div>
        </div>
      </div>
    `
      )
      .join("");
  }

  const mk = (n, min, max) => Array.from({ length: n }, () => Math.round(min + Math.random() * (max - min)));
  makeSparkline($("#chartEarthquake"), mk(16, 15, 55), "rgba(77,163,255,.95)");
  makeSparkline($("#chartFlood"), mk(16, 30, 80), "rgba(39,211,162,.95)");
  makeSparkline($("#chartWildfire"), mk(16, 25, 75), "rgba(255,204,102,.95)");
  makeSparkline($("#chartHurricane"), mk(16, 10, 70), "rgba(255,93,115,.90)");

  // Main chart
  const mainCtx = $("#chartMain");
  if (mainCtx) {
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    // eslint-disable-next-line no-new
    new Chart(mainCtx, {
      type: "bar",
      data: {
        labels: days,
        datasets: [
          {
            label: "Earthquake",
            data: mk(7, 15, 60),
            backgroundColor: "rgba(77,163,255,.45)",
            borderColor: "rgba(77,163,255,.9)",
            borderWidth: 1
          },
          {
            label: "Flood",
            data: mk(7, 20, 85),
            backgroundColor: "rgba(39,211,162,.35)",
            borderColor: "rgba(39,211,162,.9)",
            borderWidth: 1
          },
          {
            label: "Wildfire",
            data: mk(7, 10, 80),
            backgroundColor: "rgba(255,204,102,.35)",
            borderColor: "rgba(255,204,102,.9)",
            borderWidth: 1
          },
          {
            label: "Hurricane",
            data: mk(7, 10, 70),
            backgroundColor: "rgba(255,93,115,.30)",
            borderColor: "rgba(255,93,115,.85)",
            borderWidth: 1
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: "#e7eefc" } },
          tooltip: { enabled: true }
        },
        scales: {
          x: { ticks: { color: "#a9b6d3" }, grid: { color: "rgba(255,255,255,.05)" } },
          y: { ticks: { color: "#a9b6d3" }, grid: { color: "rgba(255,255,255,.05)" }, suggestedMax: 100 }
        }
      }
    });
  }

  // Map with alert markers
  const mapEl = $("#map");
  if (mapEl && window.L) {
    const map = L.map("map", { zoomControl: true }).setView([20, 0], 2);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);

    const bounds = [];
    alerts.forEach((a) => {
      if (!Number.isFinite(a.lat) || !Number.isFinite(a.lng)) return;
      const color = String(a.dangerLevel).toLowerCase() === "high" ? "#ff5d73" : String(a.dangerLevel).toLowerCase() === "medium" ? "#ffcc66" : "#27d3a2";
      const icon = L.divIcon({
        className: "",
        html: `<div style="width:12px;height:12px;border-radius:50%;background:${color};box-shadow:0 0 0 6px rgba(0,0,0,.15)"></div>`
      });
      L.marker([a.lat, a.lng], { icon })
        .addTo(map)
        .bindPopup(`<strong>${escapeHtml(a.type)}</strong><br/>${escapeHtml(a.location)}<br/><small>${escapeHtml(a.dangerLevel)} • ${Math.round(Number(a.riskLevel) || 0)}%</small>`);
      bounds.push([a.lat, a.lng]);
    });
    if (bounds.length >= 2) map.fitBounds(bounds, { padding: [30, 30] });
    if (bounds.length === 1) map.setView(bounds[0], 6);
  }
}

async function initAlerts() {
  await refreshMe().catch(() => {});
  const me = getUser();
  const muteToggle = $("#muteAlarm");
  if (muteToggle) {
    muteToggle.checked = isMuted();
    muteToggle.addEventListener("change", () => {
      setMuted(muteToggle.checked);
      if (muteToggle.checked) alarmStop();
    });
  }

  const data = await api("/alerts", { auth: false });
  const alerts = data.alerts || [];

  const highNow = alerts.some((a) => String(a.dangerLevel).toLowerCase() === "high");
  if (highNow) alarmStart();
  const stopBtn = $("#stopAlarm");
  stopBtn?.addEventListener("click", () => {
    alarmStop();
    toast("Alarm stopped.", "secondary");
  });

  const host = $("#alertsList");
  if (!host) return;

  const saved = new Set((me && me.savedAlerts) || []);
  host.innerHTML = alerts
    .map((a) => {
      const high = String(a.dangerLevel).toLowerCase() === "high";
      const isSaved = saved.has(a.id);
      return `
      <div class="card mb-3 ${high ? "pulse" : ""}">
        <div class="card-body">
          <div class="d-flex flex-wrap align-items-start justify-content-between gap-2">
            <div>
              <div class="d-flex align-items-center gap-2">
                <i class="bi bi-alarm-fill ${high ? "text-danger" : "text-warning"}"></i>
                <span class="fw-bold">${escapeHtml(a.type)}</span>
                <span class="badge-level ${dangerClass(a.dangerLevel)}">${escapeHtml(a.dangerLevel)}</span>
              </div>
              <div class="muted small mt-1">
                <i class="bi bi-geo-alt"></i> ${escapeHtml(a.location)}
                <span class="mx-2">•</span>
                <i class="bi bi-clock"></i> ${new Date(a.createdAt).toLocaleString()}
              </div>
              <div class="mt-2">${escapeHtml(a.message)}</div>
            </div>
            <div class="text-end">
              <div class="fw-bold fs-5">${Math.round(Number(a.riskLevel) || 0)}%</div>
              <div class="muted small">Risk</div>
              <button class="btn btn-sm ${isSaved ? "btn-outline-success" : "btn-outline-light"} mt-2" data-save="${escapeHtml(a.id)}">
                <i class="bi ${isSaved ? "bi-bookmark-check" : "bi-bookmark"}"></i>
                ${isSaved ? "Saved" : "Save"}
              </button>
            </div>
          </div>
        </div>
      </div>`;
    })
    .join("");

  $all("[data-save]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-save");
      const isSaved = btn.textContent.toLowerCase().includes("saved");
      try {
        if (isSaved) {
          await api(`/me/saved-alerts/${encodeURIComponent(id)}`, { method: "DELETE" });
          toast("Removed from saved alerts.", "secondary");
        } else {
          await api(`/me/saved-alerts/${encodeURIComponent(id)}`, { method: "POST" });
          toast("Saved alert to your profile.", "success");
        }
        await refreshMe();
        initAlerts();
      } catch (err) {
        toast(err.message || "Failed", "danger");
      }
    });
  });
}

async function initPrediction() {
  await refreshMe().catch(() => {});
  const form = $("#predictForm");
  const out = $("#predictOut");
  const bars = $("#predictBars");

  let barChart = null;
  function renderBars(scores) {
    if (!bars) return;
    if (barChart) barChart.destroy();
    // eslint-disable-next-line no-new
    barChart = new Chart(bars, {
      type: "radar",
      data: {
        labels: ["Earthquake", "Flood", "Wildfire", "Hurricane"],
        datasets: [
          {
            label: "Predicted Risk",
            data: [scores.earthquake, scores.flood, scores.wildfire, scores.hurricane],
            borderColor: "rgba(77,163,255,.95)",
            backgroundColor: "rgba(77,163,255,.20)",
            pointBackgroundColor: "rgba(39,211,162,.95)",
            borderWidth: 2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "#e7eefc" } } },
        scales: {
          r: {
            suggestedMin: 0,
            suggestedMax: 100,
            grid: { color: "rgba(255,255,255,.06)" },
            angleLines: { color: "rgba(255,255,255,.08)" },
            pointLabels: { color: "#a9b6d3" },
            ticks: { color: "#a9b6d3", backdropColor: "transparent" }
          }
        }
      }
    });
  }

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const temperature = Number($("#inTemp").value);
    const rainfall = Number($("#inRain").value);
    const windSpeed = Number($("#inWind").value);
    const seismicActivity = Number($("#inSeismic").value);
    try {
      const data = await api("/predict", {
        method: "POST",
        body: { temperature, rainfall, windSpeed, seismicActivity }
      });
      if (out) {
        const badge =
          data.overall === "High Risk"
            ? "badge-high"
            : data.overall === "Medium Risk"
              ? "badge-medium"
              : "badge-low";
        out.innerHTML = `
          <div class="d-flex flex-wrap align-items-center gap-2">
            <span class="badge-level ${badge}">${escapeHtml(data.overall)}</span>
            <span class="muted">Primary signal:</span>
            <span class="fw-bold">${escapeHtml(data.primary)}</span>
          </div>
        `;
      }
      renderBars(data.scores);
      if (data.overall === "High Risk") alarmStart();
    } catch (err) {
      toast(err.message || "Prediction failed", "danger");
    }
  });

  // initial chart
  renderBars({ earthquake: 25, flood: 45, wildfire: 35, hurricane: 30 });
}

async function initProfile() {
  const me = await refreshMe();
  $("#pUser") && ($("#pUser").textContent = me.username);
  $("#pEmail") && ($("#pEmail").textContent = me.email);
  $("#pRole") && ($("#pRole").textContent = me.role);

  const alerts = (await api("/alerts", { auth: false })).alerts || [];
  const saved = new Set(me.savedAlerts || []);
  const savedAlerts = alerts.filter((a) => saved.has(a.id));

  const list = $("#savedAlerts");
  if (list) {
    list.innerHTML =
      savedAlerts.length === 0
        ? `<div class="muted">No saved alerts yet. Go to Alerts and bookmark one.</div>`
        : savedAlerts
            .map(
              (a) => `
          <div class="card card-soft mb-2">
            <div class="card-body py-3">
              <div class="d-flex align-items-start justify-content-between gap-2">
                <div>
                  <div class="d-flex align-items-center gap-2">
                    <i class="bi bi-bookmark-check"></i>
                    <span class="fw-bold">${escapeHtml(a.type)}</span>
                    <span class="badge-level ${dangerClass(a.dangerLevel)}">${escapeHtml(a.dangerLevel)}</span>
                  </div>
                  <div class="muted small mt-1">${escapeHtml(a.location)} • ${new Date(a.createdAt).toLocaleString()}</div>
                  <div class="mt-2">${escapeHtml(a.message)}</div>
                </div>
                <button class="btn btn-sm btn-outline-light" data-unsave="${escapeHtml(a.id)}">Remove</button>
              </div>
            </div>
          </div>
        `
            )
            .join("");
  }

  $all("[data-unsave]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-unsave");
      try {
        await api(`/me/saved-alerts/${encodeURIComponent(id)}`, { method: "DELETE" });
        toast("Removed from saved alerts.", "secondary");
        initProfile();
      } catch (err) {
        toast(err.message || "Failed", "danger");
      }
    });
  });
}

async function initEmergency() {
  await refreshMe().catch(() => {});
  const ctx = $("#chartResources");
  if (!ctx) return;
  // eslint-disable-next-line no-new
  new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Medical", "Shelter", "Food/Water", "Rescue", "Comms"],
      datasets: [
        {
          data: [28, 22, 18, 20, 12],
          backgroundColor: [
            "rgba(255,93,115,.65)",
            "rgba(77,163,255,.65)",
            "rgba(39,211,162,.65)",
            "rgba(255,204,102,.65)",
            "rgba(231,238,252,.35)"
          ],
          borderColor: "rgba(255,255,255,.08)",
          borderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: "#e7eefc" } } }
    }
  });
}

async function initAdmin() {
  const me = await refreshMe().catch(() => null);
  if (!me || me.role !== "admin") {
    toast("Admin access required.", "danger");
    setTimeout(() => (location.href = "dashboard.html"), 350);
    return;
  }

  const form = $("#adminForm");
  const table = $("#adminTableBody");

  async function load() {
    const { alerts } = await api("/alerts", { auth: false });
    if (!table) return;
    table.innerHTML = alerts
      .map(
        (a) => `
      <tr>
        <td class="text-nowrap">${escapeHtml(a.id)}</td>
        <td>${escapeHtml(a.type)}</td>
        <td>${escapeHtml(a.location)}</td>
        <td><span class="badge-level ${dangerClass(a.dangerLevel)}">${escapeHtml(a.dangerLevel)}</span></td>
        <td class="text-nowrap">${Math.round(Number(a.riskLevel) || 0)}%</td>
        <td class="text-nowrap">
          <button class="btn btn-sm btn-outline-light" data-edit="${escapeHtml(a.id)}"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-sm btn-outline-danger" data-del="${escapeHtml(a.id)}"><i class="bi bi-trash"></i></button>
        </td>
      </tr>
    `
      )
      .join("");

    $all("[data-del]").forEach((b) => {
      b.addEventListener("click", async () => {
        const id = b.getAttribute("data-del");
        if (!confirm(`Delete alert ${id}?`)) return;
        try {
          await api(`/alerts/${encodeURIComponent(id)}`, { method: "DELETE" });
          toast("Alert deleted.", "secondary");
          load();
        } catch (err) {
          toast(err.message || "Delete failed", "danger");
        }
      });
    });

    $all("[data-edit]").forEach((b) => {
      b.addEventListener("click", async () => {
        const id = b.getAttribute("data-edit");
        const type = prompt("Type (Earthquake/Flood/...):");
        if (type === null) return;
        const location = prompt("Location:");
        if (location === null) return;
        const riskLevel = prompt("Risk level (0-100):");
        if (riskLevel === null) return;
        const message = prompt("Emergency message:");
        if (message === null) return;
        try {
          await api(`/alerts/${encodeURIComponent(id)}`, {
            method: "PUT",
            body: { type, location, riskLevel: Number(riskLevel), message }
          });
          toast("Alert updated.", "success");
          load();
        } catch (err) {
          toast(err.message || "Update failed", "danger");
        }
      });
    });
  }

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const type = $("#aType").value;
    const location = $("#aLocation").value.trim();
    const riskLevel = Number($("#aRisk").value);
    const message = $("#aMessage").value.trim();
    const lat = $("#aLat").value ? Number($("#aLat").value) : undefined;
    const lng = $("#aLng").value ? Number($("#aLng").value) : undefined;
    try {
      await api("/alerts", { method: "POST", body: { type, location, riskLevel, message, lat, lng } });
      toast("Alert created.", "success");
      form.reset();
      load();
    } catch (err) {
      toast(err.message || "Create failed", "danger");
    }
  });

  await load();
}

function initCommon() {
  protectPage();
  setActiveNav();
  renderAuthUI();
  bindLogout();
}

document.addEventListener("DOMContentLoaded", async () => {
  initCommon();

  const page = document.body.getAttribute("data-page");
  try {
    if (page === "index") await initIndex();
    if (page === "dashboard") await initDashboard();
    if (page === "alerts") await initAlerts();
    if (page === "prediction") await initPrediction();
    if (page === "profile") await initProfile();
    if (page === "emergency") await initEmergency();
    if (page === "admin") await initAdmin();
  } catch (err) {
    toast(err.message || "Unexpected error", "danger");
  }
});

