const statusLabels = {
  online: "En ligne",
  update: "Mise a jour",
  migration: "Migration",
  offline: "Hors ligne"
};

function formatDate(value) {
  if (!value) {
    return "Inconnue";
  }

  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "long",
    timeStyle: "short"
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderServices(services) {
  const container = document.querySelector("#services-list");

  container.innerHTML = services
    .map((service) => {
      const pingLine = service.lastPingAt
        ? `Dernier ping: ${formatDate(service.lastPingAt)}`
        : "Premier check en attente";

      return `
        <article class="surface service-card">
          <div class="service-card-top">
            <div>
              <h3>${escapeHtml(service.name)}</h3>
              <p>${escapeHtml(service.description)}</p>
            </div>
            <span class="status-pill ${service.status}">
              ${escapeHtml(statusLabels[service.status] || service.status)}
            </span>
          </div>
          <a class="service-link" href="${escapeHtml(service.url)}" target="_blank" rel="noreferrer">
            ${escapeHtml(service.url)}
          </a>
          <p class="service-meta">${escapeHtml(pingLine)}</p>
        </article>
      `;
    })
    .join("");
}

function renderIncidents(incidents) {
  const container = document.querySelector("#incidents-list");

  if (!incidents.length) {
    container.innerHTML = `
      <div class="empty-state">
        <p>Aucun incident recent a signaler.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = incidents
    .map((incident) => {
      return `
        <article class="incident-row">
          <div class="incident-row-top">
            <div>
              <p class="incident-date">${escapeHtml(formatDate(incident.createdAt))}</p>
              <h3>${escapeHtml(incident.title)}</h3>
            </div>
            <span class="status-pill ${incident.status}">
              ${escapeHtml(statusLabels[incident.status] || incident.status)}
            </span>
          </div>
          <p class="incident-service">${escapeHtml(incident.serviceName)}</p>
          ${
            incident.endedAt
              ? `<p class="incident-end">${escapeHtml(`Fin prevue: ${formatDate(incident.endedAt)}`)}</p>`
              : ""
          }
          <p class="incident-details">${escapeHtml(incident.details || "Aucun detail supplementaire.")}</p>
        </article>
      `;
    })
    .join("");
}

function applySummary(summary) {
  const dot = document.querySelector("#global-dot");
  const label = document.querySelector("#global-label");
  const detail = document.querySelector("#global-detail");

  dot.className = `status-dot ${summary.state} ${summary.pulse ? "pulse" : ""}`.trim();
  label.textContent = summary.message;
  detail.textContent = summary.detail;
}

async function loadPublicStatus() {
  const response = await fetch("/api/public-status");

  if (!response.ok) {
    throw new Error("Impossible de charger le statut public.");
  }

  const data = await response.json();
  applySummary(data.summary);
  renderServices(data.services);
  renderIncidents(data.incidents);

  document.querySelector("#last-checked").textContent = `Derniere verification: ${formatDate(
    data.meta.lastCheckedAt
  )}`;
}

loadPublicStatus().catch((error) => {
  document.querySelector("#global-label").textContent = "Etat indisponible";
  document.querySelector("#global-detail").textContent = error.message;
});

window.setInterval(() => {
  loadPublicStatus().catch(() => {});
}, 30000);
