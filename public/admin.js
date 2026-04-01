const statusLabels = {
  online: "En ligne",
  update: "Mise a jour",
  migration: "Migration",
  offline: "Hors ligne"
};

const state = {
  services: [],
  incidents: [],
  events: [],
  settings: {}
};

function qs(selector) {
  return document.querySelector(selector);
}

function formatDate(value) {
  if (!value) {
    return "Inconnue";
  }

  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatDateTimeLocal(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60000);
  return localDate.toISOString().slice(0, 16);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function showToast(message, isError = false) {
  const toast = qs("#toast");
  toast.textContent = message;
  toast.className = `toast visible ${isError ? "error" : ""}`.trim();

  window.clearTimeout(showToast.timeoutId);
  showToast.timeoutId = window.setTimeout(() => {
    toast.className = "toast";
  }, 2600);
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json"
    },
    credentials: "same-origin",
    ...options
  });

  let payload = {};

  try {
    payload = await response.json();
  } catch (_error) {
    payload = {};
  }

  if (!response.ok) {
    throw new Error(payload.error || "Une erreur est survenue.");
  }

  return payload;
}

function setAuthView(isAuthenticated) {
  qs("#login-view").classList.toggle("hidden", isAuthenticated);
  qs("#admin-view").classList.toggle("hidden", !isAuthenticated);
}

function renderServiceOptions() {
  const select = qs("#incident-service");

  if (!state.services.length) {
    select.innerHTML = '<option value="">Aucun service disponible</option>';
    return;
  }

  select.innerHTML = state.services
    .map((service) => {
      return `<option value="${escapeHtml(service.id)}">${escapeHtml(service.name)}</option>`;
    })
    .join("");
}

function renderAdminMeta(meta) {
  qs("#admin-last-checked").textContent = `Derniere verification: ${formatDate(meta.lastCheckedAt)}`;
}

function renderSettings() {
  qs("#monitor-interval").textContent = `Frequence actuelle: ${Math.round(
    (state.settings.monitorIntervalMs || 60000) / 1000
  )} secondes`;
  qs("#security-threshold").textContent = `Protection login: ${state.settings.maxLoginAttempts || 3} tentatives max, blocage ${Math.round(
    (state.settings.lockoutMs || 900000) / 60000
  )} minute(s)`;
  qs("#default-password-banner").classList.toggle(
    "hidden",
    !state.settings.usingDefaultPassword
  );
}

function renderEvents() {
  const container = qs("#admin-events-list");

  if (!state.events.length) {
    container.innerHTML = `
      <div class="empty-state compact">
        <p>Aucun evenement recemment enregistre.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = state.events
    .map((event) => {
      return `
        <article class="event-item">
          <div class="event-head">
            <div class="event-meta-top">
              <span class="event-level ${escapeHtml(event.level)}">${escapeHtml(event.level)}</span>
              <span class="event-category">${escapeHtml(event.category)}</span>
            </div>
            <p class="incident-date">${escapeHtml(formatDate(event.createdAt))}</p>
          </div>
          <h3>${escapeHtml(event.message)}</h3>
          ${
            event.ip
              ? `<p class="event-detail">IP: ${escapeHtml(event.ip)}</p>`
              : ""
          }
          ${
            event.metadata && Object.keys(event.metadata).length
              ? `<pre class="event-payload">${escapeHtml(JSON.stringify(event.metadata, null, 2))}</pre>`
              : ""
          }
        </article>
      `;
    })
    .join("");
}

function renderIncidents() {
  const container = qs("#admin-incidents-list");

  if (!state.incidents.length) {
    container.innerHTML = `
      <div class="empty-state compact">
        <p>Aucun incident enregistre pour le moment.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = state.incidents
    .map((incident) => {
      return `
        <article class="admin-item">
          <div class="admin-item-head">
            <div>
              <p class="incident-date">${escapeHtml(formatDate(incident.createdAt))}</p>
              <h3>${escapeHtml(incident.title)}</h3>
              <p class="incident-service">${escapeHtml(incident.serviceName)} · ${escapeHtml(statusLabels[incident.status] || incident.status)}</p>
              ${
                incident.endedAt
                  ? `<p class="incident-end">Fin prevue: ${escapeHtml(formatDate(incident.endedAt))}</p>`
                  : ""
              }
            </div>
            <button class="ghost-button danger" type="button" data-delete-incident="${escapeHtml(incident.id)}">
              Supprimer
            </button>
          </div>
          <div class="edit-fields">
            <label class="field">
              <span>Titre</span>
              <input type="text" maxlength="140" value="${escapeHtml(incident.title)}" data-edit-title="${escapeHtml(incident.id)}" />
            </label>
            <label class="field">
              <span>Heure de fin</span>
              <input type="datetime-local" value="${escapeHtml(formatDateTimeLocal(incident.endedAt))}" data-edit-ended-at="${escapeHtml(incident.id)}" />
            </label>
            <label class="field">
              <span>Raison / details</span>
              <textarea rows="4" maxlength="2000" data-edit-details="${escapeHtml(incident.id)}">${escapeHtml(incident.details || "")}</textarea>
            </label>
            <button class="secondary-button inline-button" type="button" data-save-incident="${escapeHtml(incident.id)}">
              Enregistrer
            </button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderServices() {
  const container = qs("#admin-services-list");

  if (!state.services.length) {
    container.innerHTML = `
      <div class="surface admin-card">
        <div class="empty-state compact">
          <p>Aucun service configure pour le moment.</p>
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = state.services
    .map((service) => {
      const monitoringLabel =
        service.monitoredStatus === "auto"
          ? "Monitoring auto actif"
          : service.monitoredStatus === "manual-lock"
            ? "Monitoring actif, statut verrouille par maintenance"
            : "Monitoring desactive";

      return `
        <article class="surface service-admin-card">
          <div class="service-card-top">
            <div>
              <h3>${escapeHtml(service.name)}</h3>
              <p>${escapeHtml(service.description)}</p>
              <a class="service-link" href="${escapeHtml(service.url)}" target="_blank" rel="noreferrer">
                ${escapeHtml(service.url)}
              </a>
            </div>
            <span class="status-pill ${service.status}">
              ${escapeHtml(statusLabels[service.status] || service.status)}
            </span>
          </div>

          <div class="service-admin-meta">
            <p>${escapeHtml(monitoringLabel)}</p>
            <p>Dernier ping: ${escapeHtml(formatDate(service.lastPingAt))}</p>
            <p>HTTP: ${escapeHtml(service.lastHttpStatus || "n/a")}</p>
            ${
              service.lastError
                ? `<p class="service-error">${escapeHtml(service.lastError)}</p>`
                : ""
            }
          </div>

          <div class="status-actions">
            ${["online", "update", "migration", "offline"]
              .map((status) => {
                const activeClass = service.status === status ? "active" : "";
                return `
                  <button
                    class="status-button ${status} ${activeClass}"
                    type="button"
                    data-service-status="${escapeHtml(service.id)}"
                    data-next-status="${status}"
                  >
                    ${escapeHtml(statusLabels[status])}
                  </button>
                `;
              })
              .join("")}
          </div>

          <div class="card-actions">
            <button class="ghost-button danger" type="button" data-delete-service="${escapeHtml(service.id)}">
              Supprimer le service
            </button>
          </div>
        </article>
      `;
    })
    .join("");
}

function hydrateAdminState(payload) {
  state.services = payload.services;
  state.incidents = payload.incidents;
  state.events = payload.events || [];
  state.settings = payload.settings || {};
  renderServiceOptions();
  renderAdminMeta(payload.meta);
  renderSettings();
  renderIncidents();
  renderServices();
  renderEvents();
}

async function loadAdminState() {
  const payload = await request("/api/admin/state", {
    method: "GET"
  });

  hydrateAdminState(payload);
  setAuthView(true);
}

async function submitLogin(event) {
  event.preventDefault();
  qs("#login-error").textContent = "";

  try {
    await request("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({
        password: qs("#password").value
      })
    });

    qs("#password").value = "";
    showToast("Connexion reussie");
    await loadAdminState();
  } catch (error) {
    qs("#login-error").textContent = error.message;
  }
}

async function submitIncident(event) {
  event.preventDefault();

  try {
    const payload = await request("/api/admin/incidents", {
      method: "POST",
      body: JSON.stringify({
        serviceId: qs("#incident-service").value,
        status: qs("#incident-status").value,
        title: qs("#incident-title").value,
        details: qs("#incident-details").value,
        endedAt: qs("#incident-ended-at").value
      })
    });

    qs("#incident-form").reset();
    hydrateAdminState(payload);
    showToast("Incident ajoute");
  } catch (error) {
    showToast(error.message, true);
  }
}

async function updateIncident(id) {
  const titleInput = qs(`[data-edit-title="${id}"]`);
  const detailsInput = qs(`[data-edit-details="${id}"]`);
  const endedAtInput = qs(`[data-edit-ended-at="${id}"]`);

  try {
    const payload = await request(`/api/admin/incidents/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        title: titleInput.value,
        details: detailsInput.value,
        endedAt: endedAtInput.value
      })
    });

    hydrateAdminState(payload);
    showToast("Incident modifie");
  } catch (error) {
    showToast(error.message, true);
  }
}

async function deleteIncident(id) {
  try {
    const payload = await request(`/api/admin/incidents/${id}`, {
      method: "DELETE"
    });

    hydrateAdminState(payload);
    showToast("Incident supprime");
  } catch (error) {
    showToast(error.message, true);
  }
}

async function submitService(event) {
  event.preventDefault();

  try {
    const payload = await request("/api/admin/services", {
      method: "POST",
      body: JSON.stringify({
        name: qs("#service-name").value,
        url: qs("#service-url").value,
        description: qs("#service-description").value,
        monitoringEnabled: qs("#service-monitoring").checked
      })
    });

    qs("#service-form").reset();
    qs("#service-monitoring").checked = true;
    hydrateAdminState(payload);
    showToast("Service ajoute");
  } catch (error) {
    showToast(error.message, true);
  }
}

async function deleteService(id) {
  try {
    const payload = await request(`/api/admin/services/${id}`, {
      method: "DELETE"
    });

    hydrateAdminState(payload);
    showToast("Service supprime");
  } catch (error) {
    showToast(error.message, true);
  }
}

async function updateServiceStatus(serviceId, status) {
  try {
    const payload = await request(`/api/admin/services/${serviceId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });

    hydrateAdminState(payload);
    showToast("Statut du service mis a jour");
  } catch (error) {
    showToast(error.message, true);
  }
}

async function updatePassword(event) {
  event.preventDefault();

  if (qs("#new-password").value !== qs("#confirm-password").value) {
    showToast("La confirmation du mot de passe ne correspond pas.", true);
    return;
  }

  try {
    const payload = await request("/api/admin/password", {
      method: "POST",
      body: JSON.stringify({
        currentPassword: qs("#current-password").value,
        newPassword: qs("#new-password").value
      })
    });

    qs("#password-form").reset();
    hydrateAdminState(payload);
    showToast("Mot de passe mis a jour");
  } catch (error) {
    showToast(error.message, true);
  }
}

async function logout() {
  await request("/api/admin/logout", {
    method: "POST"
  });

  setAuthView(false);
  showToast("Deconnexion effectuee");
}

function handleTabSwitch(event) {
  const button = event.target.closest("[data-tab]");
  if (!button) {
    return;
  }

  const tab = button.dataset.tab;

  document.querySelectorAll(".segment").forEach((segment) => {
    segment.classList.toggle("active", segment.dataset.tab === tab);
  });

  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.panel === tab);
  });
}

function bindEvents() {
  qs("#login-form").addEventListener("submit", submitLogin);
  qs("#incident-form").addEventListener("submit", submitIncident);
  qs("#service-form").addEventListener("submit", submitService);
  qs("#password-form").addEventListener("submit", updatePassword);
  qs("#logout-button").addEventListener("click", logout);
  qs("#tab-control").addEventListener("click", handleTabSwitch);

  document.body.addEventListener("click", (event) => {
    const saveButton = event.target.closest("[data-save-incident]");
    if (saveButton) {
      updateIncident(saveButton.dataset.saveIncident);
      return;
    }

    const deleteButton = event.target.closest("[data-delete-incident]");
    if (deleteButton) {
      deleteIncident(deleteButton.dataset.deleteIncident);
      return;
    }

    const statusButton = event.target.closest("[data-service-status]");
    if (statusButton) {
      updateServiceStatus(statusButton.dataset.serviceStatus, statusButton.dataset.nextStatus);
      return;
    }

    const deleteServiceButton = event.target.closest("[data-delete-service]");
    if (deleteServiceButton) {
      deleteService(deleteServiceButton.dataset.deleteService);
    }
  });
}

bindEvents();

loadAdminState().catch(() => {
  setAuthView(false);
});
