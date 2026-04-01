const express = require("express");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "sakaii";
const MONITOR_INTERVAL_MS = Number.parseInt(process.env.MONITOR_INTERVAL_MS || "60000", 10);
const MONITOR_TIMEOUT_MS = Number.parseInt(process.env.MONITOR_TIMEOUT_MS || "8000", 10);
const LOGIN_MAX_ATTEMPTS = Number.parseInt(process.env.LOGIN_MAX_ATTEMPTS || "3", 10);
const LOGIN_LOCKOUT_MS = Number.parseInt(process.env.LOGIN_LOCKOUT_MS || "900000", 10);
const MAX_EVENT_LOGS = Number.parseInt(process.env.MAX_EVENT_LOGS || "150", 10);
const DATA_FILE = path.join(__dirname, "data.json");
const DATA_TEMPLATE_FILE = path.join(__dirname, "data.default.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const ADMIN_COOKIE_NAME = "sakaii_status_admin";
const STATUS_ORDER = ["online", "update", "migration", "offline"];
const MANUAL_ONLY_STATUSES = new Set(["update", "migration"]);
const STATUS_META = {
  online: { label: "En ligne" },
  update: { label: "Mise a jour" },
  migration: { label: "Migration" },
  offline: { label: "Hors ligne" }
};

const loginAttempts = new Map();
let monitoringInProgress = false;

app.set("trust proxy", true);
app.use((req, res, next) => {
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: https:; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
  );
  next();
});
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(PUBLIC_DIR));

function nowIso() {
  return new Date().toISOString();
}

function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function safeCompare(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
  } catch (_error) {
    return false;
  }
}

function sanitizeText(value, maxLength = 300) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, maxLength);
}

function sanitizeDetails(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, 2000);
}

function sanitizeBoolean(value, defaultValue = true) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return ["true", "1", "on", "yes"].includes(value.toLowerCase());
  }

  return defaultValue;
}

function sanitizeHttpStatus(value) {
  if (Number.isInteger(value) && value >= 100 && value <= 599) {
    return value;
  }

  return null;
}

function normalizeIsoDate(value, fallback = "") {
  if (!value) {
    return fallback;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  return date.toISOString();
}

function sanitizeOptionalDateTime(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function isValidStatus(status) {
  return STATUS_ORDER.includes(status);
}

function sanitizeServiceUrl(value) {
  const candidate = sanitizeText(value, 400);

  if (!candidate) {
    return "";
  }

  try {
    const url = new URL(candidate);
    if (!["http:", "https:"].includes(url.protocol)) {
      return "";
    }

    return url.toString();
  } catch (_error) {
    return "";
  }
}

function slugify(value) {
  return sanitizeText(value, 100)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function createUniqueServiceId(name, existingIds) {
  const base = slugify(name) || `service-${crypto.randomUUID().slice(0, 8)}`;
  let candidate = base;
  let index = 2;

  while (existingIds.has(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }

  existingIds.add(candidate);
  return candidate;
}

function sortIncidents(incidents) {
  return [...incidents].sort((left, right) => {
    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  });
}

function sortEvents(events) {
  return [...events].sort((left, right) => {
    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  });
}

function createDefaultData() {
  const timestamp = nowIso();
  return {
    services: [
      {
        id: "sakaii-org",
        name: "sakaii.org",
        url: "https://sakaii.org",
        description: "Blog & portfolio (Ghost CMS)",
        status: "online",
        updatedAt: timestamp,
        monitoringEnabled: true,
        lastPingAt: "",
        lastHttpStatus: null,
        lastError: ""
      },
      {
        id: "cloud-sakaii-org",
        name: "cloud.sakaii.org",
        url: "https://cloud.sakaii.org",
        description: "Sakaii Cloud (Nextcloud)",
        status: "online",
        updatedAt: timestamp,
        monitoringEnabled: true,
        lastPingAt: "",
        lastHttpStatus: null,
        lastError: ""
      },
      {
        id: "stream-sakaii-org",
        name: "stream.sakaii.org",
        url: "https://stream.sakaii.org",
        description: "Jellyfin (Streaming)",
        status: "online",
        updatedAt: timestamp,
        monitoringEnabled: true,
        lastPingAt: "",
        lastHttpStatus: null,
        lastError: ""
      },
      {
        id: "pdf-sakaii-org",
        name: "pdf.sakaii.org",
        url: "https://pdf.sakaii.org",
        description: "Stirling PDF",
        status: "online",
        updatedAt: timestamp,
        monitoringEnabled: true,
        lastPingAt: "",
        lastHttpStatus: null,
        lastError: ""
      }
    ],
    incidents: [],
    events: [],
    meta: {
      lastCheckedAt: timestamp,
      adminPasswordHash: "",
      monitoringIntervalMs: MONITOR_INTERVAL_MS
    }
  };
}

function normalizeData(rawData) {
  const defaults = createDefaultData();
  const data = rawData && typeof rawData === "object" ? rawData : {};
  let changed = false;

  if (!Array.isArray(data.services)) {
    data.services = defaults.services;
    changed = true;
  }

  if (!Array.isArray(data.incidents)) {
    data.incidents = [];
    changed = true;
  }

  if (!Array.isArray(data.events)) {
    data.events = [];
    changed = true;
  }

  if (!data.meta || typeof data.meta !== "object") {
    data.meta = defaults.meta;
    changed = true;
  }

  const usedServiceIds = new Set();
  data.services = data.services.map((service, index) => {
    const source = service && typeof service === "object" ? service : {};
    const name = sanitizeText(source.name, 120) || `Service ${index + 1}`;
    const id = sanitizeText(source.id, 120);
    const normalized = {
      id: id && !usedServiceIds.has(id) ? id : createUniqueServiceId(name, usedServiceIds),
      name,
      url: sanitizeServiceUrl(source.url) || "https://example.com",
      description: sanitizeText(source.description, 180),
      status: isValidStatus(source.status) ? source.status : "online",
      updatedAt: normalizeIsoDate(source.updatedAt, nowIso()),
      monitoringEnabled: source.monitoringEnabled === false ? false : true,
      lastPingAt: normalizeIsoDate(source.lastPingAt, ""),
      lastHttpStatus: sanitizeHttpStatus(source.lastHttpStatus),
      lastError: sanitizeText(source.lastError, 300)
    };

    if (
      normalized.id !== source.id ||
      normalized.name !== source.name ||
      normalized.url !== source.url ||
      normalized.description !== source.description ||
      normalized.status !== source.status ||
      normalized.updatedAt !== source.updatedAt ||
      normalized.monitoringEnabled !== source.monitoringEnabled ||
      normalized.lastPingAt !== source.lastPingAt ||
      normalized.lastHttpStatus !== source.lastHttpStatus ||
      normalized.lastError !== source.lastError
    ) {
      changed = true;
    }

    usedServiceIds.add(normalized.id);
    return normalized;
  });

  const servicesById = Object.fromEntries(data.services.map((service) => [service.id, service]));

  data.incidents = data.incidents.map((incident) => {
    const source = incident && typeof incident === "object" ? incident : {};
    const createdAt = normalizeIsoDate(source.createdAt, nowIso());
    const normalized = {
      id: sanitizeText(source.id, 120) || crypto.randomUUID(),
      serviceId: sanitizeText(source.serviceId, 120),
      serviceNameSnapshot:
        sanitizeText(source.serviceNameSnapshot, 120) ||
        servicesById[sanitizeText(source.serviceId, 120)]?.name ||
        "Service inconnu",
      status: isValidStatus(source.status) ? source.status : "online",
      title: sanitizeText(source.title, 140) || "Incident",
      details: sanitizeDetails(source.details),
      createdAt,
      updatedAt: normalizeIsoDate(source.updatedAt, createdAt),
      endedAt: normalizeIsoDate(source.endedAt, "")
    };

    if (
      normalized.id !== source.id ||
      normalized.serviceId !== source.serviceId ||
      normalized.serviceNameSnapshot !== source.serviceNameSnapshot ||
      normalized.status !== source.status ||
      normalized.title !== source.title ||
      normalized.details !== source.details ||
      normalized.createdAt !== source.createdAt ||
      normalized.updatedAt !== source.updatedAt ||
      normalized.endedAt !== source.endedAt
    ) {
      changed = true;
    }

    return normalized;
  });

  data.events = data.events.map((event) => {
    const source = event && typeof event === "object" ? event : {};
    const normalized = {
      id: sanitizeText(source.id, 120) || crypto.randomUUID(),
      level: sanitizeText(source.level, 32) || "info",
      category: sanitizeText(source.category, 60) || "system",
      message: sanitizeText(source.message, 240) || "Evenement",
      ip: sanitizeText(source.ip, 120),
      serviceId: sanitizeText(source.serviceId, 120),
      createdAt: normalizeIsoDate(source.createdAt, nowIso()),
      metadata: source.metadata && typeof source.metadata === "object" ? source.metadata : {}
    };

    if (
      normalized.id !== source.id ||
      normalized.level !== source.level ||
      normalized.category !== source.category ||
      normalized.message !== source.message ||
      normalized.ip !== source.ip ||
      normalized.serviceId !== source.serviceId ||
      normalized.createdAt !== source.createdAt
    ) {
      changed = true;
    }

    return normalized;
  });

  if (data.events.length > MAX_EVENT_LOGS) {
    data.events = sortEvents(data.events).slice(0, MAX_EVENT_LOGS);
    changed = true;
  }

  const lastCheckedAt = normalizeIsoDate(data.meta.lastCheckedAt, nowIso());
  const monitoringIntervalMs =
    Number.isInteger(data.meta.monitoringIntervalMs) && data.meta.monitoringIntervalMs > 0
      ? data.meta.monitoringIntervalMs
      : MONITOR_INTERVAL_MS;
  const adminPasswordHash = sanitizeText(data.meta.adminPasswordHash, 256);

  if (
    lastCheckedAt !== data.meta.lastCheckedAt ||
    monitoringIntervalMs !== data.meta.monitoringIntervalMs ||
    adminPasswordHash !== data.meta.adminPasswordHash
  ) {
    changed = true;
  }

  data.meta = {
    lastCheckedAt,
    monitoringIntervalMs,
    adminPasswordHash
  };

  return { data, changed };
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    if (fs.existsSync(DATA_TEMPLATE_FILE)) {
      try {
        const templateRaw = fs.readFileSync(DATA_TEMPLATE_FILE, "utf8");
        const templateParsed = JSON.parse(templateRaw);
        const normalized = normalizeData(templateParsed);
        writeData(normalized.data);
        return;
      } catch (_error) {
        // Fall back to generated defaults below.
      }
    }

    writeData(createDefaultData());
    return;
  }

  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const normalized = normalizeData(parsed);
    if (normalized.changed) {
      writeData(normalized.data);
    }
  } catch (_error) {
    writeData(createDefaultData());
  }
}

function readData() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  const parsed = JSON.parse(raw);
  const normalized = normalizeData(parsed);

  if (normalized.changed) {
    writeData(normalized.data);
  }

  return normalized.data;
}

function appendEvent(data, event) {
  data.events.unshift({
    id: crypto.randomUUID(),
    level: sanitizeText(event.level, 32) || "info",
    category: sanitizeText(event.category, 60) || "system",
    message: sanitizeText(event.message, 240) || "Evenement",
    ip: sanitizeText(event.ip, 120),
    serviceId: sanitizeText(event.serviceId, 120),
    createdAt: nowIso(),
    metadata: event.metadata && typeof event.metadata === "object" ? event.metadata : {}
  });
  data.events = data.events.slice(0, MAX_EVENT_LOGS);
}

function appendEventSafe(event) {
  try {
    const data = readData();
    appendEvent(data, event);
    writeData(data);
  } catch (_error) {
    // Ignore secondary logging failures.
  }
}

function getStoredAdminPasswordHash(data) {
  return data.meta.adminPasswordHash || hashPassword(DEFAULT_ADMIN_PASSWORD);
}

function getAdminToken(data) {
  return crypto
    .createHmac("sha256", getStoredAdminPasswordHash(data))
    .update("sakaii-status-admin")
    .digest("hex");
}

function isSecureRequest(req) {
  return req.secure || req.get("x-forwarded-proto") === "https";
}

function clearAdminCookie(res) {
  res.clearCookie(ADMIN_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: false
  });
}

function setAdminCookie(req, res, data) {
  res.cookie(ADMIN_COOKIE_NAME, getAdminToken(data), {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(req),
    maxAge: 1000 * 60 * 60 * 12
  });
}

function getClientIp(req) {
  const forwarded = sanitizeText(req.get("x-forwarded-for"), 120);
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }

  return sanitizeText(req.ip || req.socket?.remoteAddress || "unknown", 120);
}

function getLoginState(ip) {
  const state = loginAttempts.get(ip);

  if (!state) {
    return { failures: 0, lockedUntil: 0 };
  }

  if (state.lockedUntil && state.lockedUntil <= Date.now()) {
    loginAttempts.delete(ip);
    return { failures: 0, lockedUntil: 0 };
  }

  return state;
}

function clearLoginState(ip) {
  loginAttempts.delete(ip);
}

function registerFailedLogin(ip) {
  const previous = getLoginState(ip);
  const failures = previous.failures + 1;

  if (failures >= LOGIN_MAX_ATTEMPTS) {
    const lockedUntil = Date.now() + LOGIN_LOCKOUT_MS;
    loginAttempts.set(ip, { failures: 0, lockedUntil });
    return { locked: true, remaining: 0, lockedUntil };
  }

  loginAttempts.set(ip, { failures, lockedUntil: 0 });
  return {
    locked: false,
    remaining: LOGIN_MAX_ATTEMPTS - failures,
    lockedUntil: 0
  };
}

function getLockoutRemainingMs(ip) {
  const state = getLoginState(ip);
  return Math.max(0, state.lockedUntil - Date.now());
}

function decorateService(service) {
  return {
    ...service,
    statusMeta: STATUS_META[service.status],
    monitoredStatus:
      service.monitoringEnabled && !MANUAL_ONLY_STATUSES.has(service.status)
        ? "auto"
        : service.monitoringEnabled
          ? "manual-lock"
          : "disabled"
  };
}

function decorateIncident(incident, servicesById) {
  return {
    ...incident,
    serviceName:
      servicesById[incident.serviceId]?.name || incident.serviceNameSnapshot || "Service inconnu",
    statusMeta: STATUS_META[incident.status]
  };
}

function buildPublicState(data) {
  const services = data.services.map(decorateService);
  const servicesById = Object.fromEntries(data.services.map((service) => [service.id, service]));
  const incidents = sortIncidents(data.incidents)
    .slice(0, 8)
    .map((incident) => decorateIncident(incident, servicesById));

  return {
    services,
    incidents,
    summary: getStatusSummary(data.services),
    meta: {
      lastCheckedAt: data.meta.lastCheckedAt
    }
  };
}

function buildAdminState(data) {
  const servicesById = Object.fromEntries(data.services.map((service) => [service.id, service]));
  return {
    services: data.services.map(decorateService),
    incidents: sortIncidents(data.incidents).map((incident) => decorateIncident(incident, servicesById)),
    events: sortEvents(data.events).slice(0, 60),
    meta: data.meta,
    settings: {
      monitorIntervalMs: data.meta.monitoringIntervalMs,
      usingDefaultPassword: !data.meta.adminPasswordHash,
      maxLoginAttempts: LOGIN_MAX_ATTEMPTS,
      lockoutMs: LOGIN_LOCKOUT_MS
    }
  };
}

function getStatusSummary(services) {
  const statuses = services.map((service) => service.status);

  if (statuses.includes("offline")) {
    return {
      state: "offline",
      message: "Incident en cours",
      detail: "Un ou plusieurs services rencontrent actuellement un incident.",
      pulse: true
    };
  }

  if (statuses.includes("migration")) {
    return {
      state: "migration",
      message: "Certains services en maintenance",
      detail: "Une migration ou une maintenance planifiee est en cours.",
      pulse: true
    };
  }

  if (statuses.includes("update")) {
    return {
      state: "update",
      message: "Mise a jour en cours sur certains services",
      detail: "Des interventions legeres sont en cours sans incident majeur signale.",
      pulse: true
    };
  }

  return {
    state: "online",
    message: "Tous les systemes sont operationnels",
    detail: "L'ensemble des services Sakaii est accessible normalement.",
    pulse: false
  };
}

function recomputeServiceStatus(serviceId, data) {
  const relatedIncidents = sortIncidents(
    data.incidents.filter((incident) => incident.serviceId === serviceId)
  );
  const service = data.services.find((item) => item.id === serviceId);

  if (!service) {
    return;
  }

  if (MANUAL_ONLY_STATUSES.has(service.status)) {
    service.updatedAt = nowIso();
    return;
  }

  service.status = relatedIncidents[0]?.status || "online";
  service.updatedAt = nowIso();
}

function createTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeout);
    }
  };
}

async function requestUrl(url, method) {
  const { signal, cleanup } = createTimeoutSignal(MONITOR_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method,
      redirect: "follow",
      signal,
      headers: {
        "user-agent": "Sakaii Status/1.0"
      }
    });

    return {
      ok: response.ok,
      httpStatus: response.status,
      error: ""
    };
  } catch (error) {
    return {
      ok: false,
      httpStatus: null,
      error: error.name === "AbortError" ? "Timeout" : sanitizeText(error.message, 300)
    };
  } finally {
    cleanup();
  }
}

async function pingService(service) {
  let result = await requestUrl(service.url, "HEAD");

  if (result.httpStatus === 405 || result.httpStatus === 501) {
    result = await requestUrl(service.url, "GET");
  }

  return result;
}

async function runMonitoringCycle() {
  if (monitoringInProgress) {
    return;
  }

  monitoringInProgress = true;

  try {
    const data = readData();
    const timestamp = nowIso();
    const pendingEvents = [];
    let changed = false;

    for (const service of data.services) {
      if (!service.monitoringEnabled || !service.url) {
        continue;
      }

      const previousStatus = service.status;
      const previousError = service.lastError;
      const previousHttpStatus = service.lastHttpStatus;
      const check = await pingService(service);

      service.lastPingAt = timestamp;
      service.lastHttpStatus = check.httpStatus;
      service.lastError = check.error;
      changed = true;

      if (!MANUAL_ONLY_STATUSES.has(service.status)) {
        const nextStatus = check.ok ? "online" : "offline";
        if (service.status !== nextStatus) {
          service.status = nextStatus;
          service.updatedAt = timestamp;
          pendingEvents.push({
            level: nextStatus === "offline" ? "error" : "info",
            category: "monitoring",
            serviceId: service.id,
            message:
              nextStatus === "offline"
                ? `${service.name} est passe hors ligne`
                : `${service.name} est revenu en ligne`,
            metadata: {
              httpStatus: check.httpStatus,
              error: check.error
            }
          });
        }
      }

      if (check.error && (check.error !== previousError || check.httpStatus !== previousHttpStatus)) {
        pendingEvents.push({
          level: "warn",
          category: "monitoring",
          serviceId: service.id,
          message: `Echec de verification pour ${service.name}`,
          metadata: {
            httpStatus: check.httpStatus,
            error: check.error
          }
        });
      }

      if (
        previousStatus !== service.status ||
        previousError !== service.lastError ||
        previousHttpStatus !== service.lastHttpStatus
      ) {
        changed = true;
      }
    }

    const latestData = readData();
    for (const service of data.services) {
      const targetService = latestData.services.find((item) => item.id === service.id);
      if (!targetService) {
        continue;
      }

      targetService.lastPingAt = service.lastPingAt;
      targetService.lastHttpStatus = service.lastHttpStatus;
      targetService.lastError = service.lastError;

      if (!MANUAL_ONLY_STATUSES.has(targetService.status)) {
        targetService.status = service.status;
        targetService.updatedAt = service.updatedAt;
      }
    }

    for (const event of pendingEvents) {
      appendEvent(latestData, event);
    }

    latestData.meta.lastCheckedAt = timestamp;
    if (changed) {
      writeData(latestData);
    }
  } finally {
    monitoringInProgress = false;
  }
}

function isAuthenticated(req) {
  const cookieValue = req.cookies[ADMIN_COOKIE_NAME];
  if (!cookieValue) {
    return false;
  }

  const data = readData();
  return safeCompare(cookieValue, getAdminToken(data));
}

function requireAuth(req, res, next) {
  if (!isAuthenticated(req)) {
    appendEventSafe({
      level: "security",
      category: "auth",
      ip: getClientIp(req),
      message: "Tentative d'acces admin sans session valide"
    });
    return res.status(401).json({ error: "Authentification requise." });
  }

  return next();
}

app.get("/", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.get("/admin", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "admin.html"));
});

app.get("/api/public-status", (_req, res) => {
  const data = readData();
  return res.json(buildPublicState(data));
});

app.post("/api/admin/login", (req, res) => {
  const ip = getClientIp(req);
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const lockoutRemainingMs = getLockoutRemainingMs(ip);

  if (lockoutRemainingMs > 0) {
    appendEventSafe({
      level: "security",
      category: "auth",
      ip,
      message: "Tentative de connexion bloquee pendant la periode de verrouillage",
      metadata: {
        lockoutRemainingMs
      }
    });
    return res.status(429).json({
      error: `Trop de tentatives. Reessayez dans ${Math.ceil(lockoutRemainingMs / 60000)} minute(s).`
    });
  }

  const data = readData();

  if (!safeCompare(hashPassword(password), getStoredAdminPasswordHash(data))) {
    const result = registerFailedLogin(ip);
    appendEventSafe({
      level: "security",
      category: "auth",
      ip,
      message: result.locked
        ? "Verrouillage du login apres trop d'echecs"
        : "Echec de connexion admin",
      metadata: {
        remainingAttempts: result.remaining,
        lockedUntil: result.locked ? new Date(result.lockedUntil).toISOString() : ""
      }
    });

    if (result.locked) {
      return res.status(429).json({
        error: `Trop de tentatives. Reessayez dans ${Math.ceil(LOGIN_LOCKOUT_MS / 60000)} minute(s).`
      });
    }

    return res.status(401).json({
      error: `Mot de passe invalide. ${result.remaining} tentative(s) restante(s).`
    });
  }

  clearLoginState(ip);
  appendEvent(data, {
    level: "info",
    category: "auth",
    ip,
    message: "Connexion admin reussie"
  });
  writeData(data);
  setAdminCookie(req, res, data);
  return res.json({ success: true });
});

app.post("/api/admin/logout", requireAuth, (req, res) => {
  appendEventSafe({
    level: "info",
    category: "auth",
    ip: getClientIp(req),
    message: "Deconnexion admin"
  });
  clearAdminCookie(res);
  return res.json({ success: true });
});

app.get("/api/admin/state", requireAuth, (_req, res) => {
  const data = readData();
  return res.json(buildAdminState(data));
});

app.post("/api/admin/password", requireAuth, (req, res) => {
  const currentPassword = sanitizeText(req.body.currentPassword, 128);
  const newPassword = sanitizeText(req.body.newPassword, 128);
  const data = readData();

  if (!safeCompare(hashPassword(currentPassword), getStoredAdminPasswordHash(data))) {
    appendEvent(data, {
      level: "security",
      category: "auth",
      ip: getClientIp(req),
      message: "Echec de changement de mot de passe"
    });
    writeData(data);
    return res.status(400).json({ error: "Le mot de passe actuel est incorrect." });
  }

  if (newPassword.length < 4) {
    return res.status(400).json({
      error: "Le nouveau mot de passe doit contenir au moins 4 caracteres."
    });
  }

  data.meta.adminPasswordHash = hashPassword(newPassword);
  appendEvent(data, {
    level: "security",
    category: "auth",
    ip: getClientIp(req),
    message: "Mot de passe admin mis a jour"
  });
  writeData(data);
  setAdminCookie(req, res, data);

  return res.json(buildAdminState(data));
});

app.post("/api/admin/incidents", requireAuth, (req, res) => {
  const serviceId = sanitizeText(req.body.serviceId, 100);
  const status = sanitizeText(req.body.status, 32);
  const title = sanitizeText(req.body.title, 140);
  const details = sanitizeDetails(req.body.details);
  const endedAt = sanitizeOptionalDateTime(req.body.endedAt);

  if (!serviceId || !title) {
    return res.status(400).json({ error: "Le service et le titre sont requis." });
  }

  if (!isValidStatus(status)) {
    return res.status(400).json({ error: "Statut invalide." });
  }

  if (endedAt === null) {
    return res.status(400).json({ error: "Heure de fin invalide." });
  }

  const data = readData();
  const service = data.services.find((item) => item.id === serviceId);

  if (!service) {
    return res.status(404).json({ error: "Service introuvable." });
  }

  const timestamp = nowIso();
  const incident = {
    id: crypto.randomUUID(),
    serviceId,
    serviceNameSnapshot: service.name,
    status,
    title,
    details,
    createdAt: timestamp,
    updatedAt: timestamp,
    endedAt: endedAt || ""
  };

  data.incidents.push(incident);
  service.status = status;
  service.updatedAt = timestamp;
  appendEvent(data, {
    level: "info",
    category: "incident",
    ip: getClientIp(req),
    serviceId: service.id,
    message: `Incident cree pour ${service.name}`
  });
  writeData(data);

  return res.status(201).json(buildAdminState(data));
});

app.patch("/api/admin/incidents/:id", requireAuth, (req, res) => {
  const title = sanitizeText(req.body.title, 140);
  const details = sanitizeDetails(req.body.details);
  const endedAt = sanitizeOptionalDateTime(req.body.endedAt);

  if (endedAt === null) {
    return res.status(400).json({ error: "Heure de fin invalide." });
  }

  const data = readData();
  const incident = data.incidents.find((item) => item.id === req.params.id);

  if (!incident) {
    return res.status(404).json({ error: "Incident introuvable." });
  }

  if (!title) {
    return res.status(400).json({ error: "Le titre est requis." });
  }

  incident.title = title;
  incident.details = details;
  incident.endedAt = endedAt || "";
  incident.updatedAt = nowIso();
  appendEvent(data, {
    level: "info",
    category: "incident",
    ip: getClientIp(req),
    serviceId: incident.serviceId,
    message: `Incident mis a jour: ${incident.title}`
  });
  writeData(data);

  return res.json(buildAdminState(data));
});

app.delete("/api/admin/incidents/:id", requireAuth, (req, res) => {
  const data = readData();
  const incidentIndex = data.incidents.findIndex((item) => item.id === req.params.id);

  if (incidentIndex === -1) {
    return res.status(404).json({ error: "Incident introuvable." });
  }

  const [removedIncident] = data.incidents.splice(incidentIndex, 1);
  recomputeServiceStatus(removedIncident.serviceId, data);
  appendEvent(data, {
    level: "info",
    category: "incident",
    ip: getClientIp(req),
    serviceId: removedIncident.serviceId,
    message: `Incident supprime: ${removedIncident.title}`
  });
  writeData(data);

  return res.json(buildAdminState(data));
});

app.post("/api/admin/services", requireAuth, (req, res) => {
  const name = sanitizeText(req.body.name, 120);
  const url = sanitizeServiceUrl(req.body.url);
  const description = sanitizeText(req.body.description, 180);
  const monitoringEnabled = sanitizeBoolean(req.body.monitoringEnabled, true);

  if (!name || !url) {
    return res.status(400).json({ error: "Le nom et l'URL du service sont requis." });
  }

  const data = readData();
  const usedIds = new Set(data.services.map((service) => service.id));
  const timestamp = nowIso();
  const service = {
    id: createUniqueServiceId(name, usedIds),
    name,
    url,
    description,
    status: "online",
    updatedAt: timestamp,
    monitoringEnabled,
    lastPingAt: "",
    lastHttpStatus: null,
    lastError: ""
  };

  data.services.push(service);
  appendEvent(data, {
    level: "info",
    category: "service",
    ip: getClientIp(req),
    serviceId: service.id,
    message: `Service ajoute: ${service.name}`
  });
  writeData(data);
  return res.status(201).json(buildAdminState(data));
});

app.delete("/api/admin/services/:id", requireAuth, (req, res) => {
  const data = readData();
  const serviceIndex = data.services.findIndex((item) => item.id === req.params.id);

  if (serviceIndex === -1) {
    return res.status(404).json({ error: "Service introuvable." });
  }

  const [service] = data.services.splice(serviceIndex, 1);
  appendEvent(data, {
    level: "warn",
    category: "service",
    ip: getClientIp(req),
    serviceId: service.id,
    message: `Service supprime: ${service.name}`
  });
  writeData(data);

  return res.json(buildAdminState(data));
});

app.patch("/api/admin/services/:id/status", requireAuth, (req, res) => {
  const status = sanitizeText(req.body.status, 32);

  if (!isValidStatus(status)) {
    return res.status(400).json({ error: "Statut invalide." });
  }

  const data = readData();
  const service = data.services.find((item) => item.id === req.params.id);

  if (!service) {
    return res.status(404).json({ error: "Service introuvable." });
  }

  service.status = status;
  service.updatedAt = nowIso();
  appendEvent(data, {
    level: "info",
    category: "service",
    ip: getClientIp(req),
    serviceId: service.id,
    message: `Statut modifie pour ${service.name}: ${STATUS_META[status].label}`
  });
  writeData(data);

  return res.json(buildAdminState(data));
});

app.use((error, req, res, _next) => {
  appendEventSafe({
    level: "error",
    category: "system",
    ip: getClientIp(req),
    message: "Erreur serveur non geree",
    metadata: {
      message: sanitizeText(error?.message || "Unknown error", 240)
    }
  });

  return res.status(500).json({ error: "Une erreur interne est survenue." });
});

process.on("unhandledRejection", (reason) => {
  appendEventSafe({
    level: "error",
    category: "system",
    message: "Unhandled promise rejection",
    metadata: {
      reason: sanitizeText(String(reason), 240)
    }
  });
});

process.on("uncaughtExceptionMonitor", (error) => {
  appendEventSafe({
    level: "error",
    category: "system",
    message: "Uncaught exception",
    metadata: {
      message: sanitizeText(error?.message || "Unknown exception", 240)
    }
  });
});

ensureDataFile();

app.listen(PORT, () => {
  console.log(`Sakaii Status listening on http://localhost:${PORT}`);
  runMonitoringCycle().catch((error) => {
    appendEventSafe({
      level: "error",
      category: "monitoring",
      message: "Initial monitoring failed",
      metadata: {
        error: sanitizeText(error?.message || "Unknown error", 240)
      }
    });
  });

  setInterval(() => {
    runMonitoringCycle().catch((error) => {
      appendEventSafe({
        level: "error",
        category: "monitoring",
        message: "Monitoring cycle failed",
        metadata: {
          error: sanitizeText(error?.message || "Unknown error", 240)
        }
      });
    });
  }, MONITOR_INTERVAL_MS).unref();
});
