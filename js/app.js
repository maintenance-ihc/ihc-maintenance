// ============================================================
//  IHC MAINTENANCE APP – Main Logic
//  File: js/app.js
// ============================================================

const PAGE = (() => {
  if (document.getElementById("requestsTable")) return "dashboard";
  if (document.getElementById("requestForm"))   return "request";
  return "unknown";
})();

const $ = id => document.getElementById(id);
const fmt = iso => {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" });
};

const priorityClass = p => ({ High: "badge-high", Medium: "badge-mid", Low: "badge-low" }[p] || "badge-low");
const statusClass   = s => ({ "Pending": "status-pending", "In Progress": "status-progress", "Completed": "status-done" }[s] || "status-pending");

// ============================================================
//  PANTALLA DE ACCESO DENEGADO
// ============================================================
function mostrarAccesoDenegado() {
  document.body.innerHTML = `
    <div style="
      display:flex; flex-direction:column; align-items:center; justify-content:center;
      height:100vh; background:#050505; color:#eaeaf0; font-family:'Inter',sans-serif;
      gap:1.5rem; text-align:center; padding:2rem;">
      <div style="font-size:4rem;">🔒</div>
      <h1 style="font-family:'Rajdhani',sans-serif; color:#b80f1a; font-size:2rem; text-transform:uppercase; letter-spacing:0.1em;">
        Access Restricted
      </h1>
      <p style="color:#8a8aa0; max-width:380px; line-height:1.7;">
        This application is for internal use at <strong style="color:#eaeaf0;">IHC Suspension</strong> only.<br>
        If you believe this is an error, contact your system administrator.
      </p>
    </div>`;
}

// ============================================================
//  API CALLS — incluyen el token secreto en cada petición
// ============================================================

// JSONP — para submit/update (evita CORS)
function apiPostJSONP(payload) {
  // Inyectamos el token en cada payload
  payload._token = IHC_CONFIG.SECRET_TOKEN;

  return new Promise((resolve, reject) => {
    const callbackName = "__ihcCallback_" + Date.now();
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timeout — no response from server"));
    }, 30000);

    function cleanup() {
      clearTimeout(timeout);
      delete window[callbackName];
      const s = document.getElementById("ihcJsonpScript");
      if (s) s.remove();
    }

    window[callbackName] = function(result) {
      cleanup();
      // Si el servidor devuelve acceso denegado, bloqueamos la UI
      if (result && result.error === "UNAUTHORIZED") {
        mostrarAccesoDenegado();
        return;
      }
      resolve(result);
    };

    const script   = document.createElement("script");
    script.id      = "ihcJsonpScript";
    script.src     = IHC_CONFIG.SCRIPT_URL
      + "?callback=" + callbackName
      + "&payload="  + encodeURIComponent(JSON.stringify(payload));
    script.onerror = function() {
      cleanup();
      reject(new Error("Could not connect to server"));
    };
    document.body.appendChild(script);
  });
}

// GET — para leer datos del dashboard
async function apiGet(params = {}) {
  // Inyectamos el token en cada GET
  params._token = IHC_CONFIG.SECRET_TOKEN;
  const qs  = new URLSearchParams(params).toString();
  const url = `${IHC_CONFIG.SCRIPT_URL}?${qs}`;
  const res = await fetch(url);
  const data = await res.json();

  // Si el servidor rechaza el token, bloqueamos la UI
  if (data && data.error === "UNAUTHORIZED") {
    mostrarAccesoDenegado();
    throw new Error("UNAUTHORIZED");
  }
  return data;
}

// ============================================================
//  PAGE: MAINTENANCE REQUEST (index.html)
// ============================================================
if (PAGE === "request") {
  const form       = $("requestForm");
  const statusArea = $("statusArea");

  if (form) {
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const btn = form.querySelector("button[type=submit]");
      btn.disabled    = true;
      btn.textContent = "Sending...";
      showStatus("loading", "Submitting request...");

      try {
        const data = Object.fromEntries(new FormData(form));
        data.action = "submit";
        const res = await apiPostJSONP(data);

        if (res.success) {
          showStatus("success", `✔ Submitted successfully! ID: <strong>${res.id}</strong>`);
          form.reset();
        } else {
          showStatus("error", "✖ Error: " + (res.error || "Unknown error"));
        }
      } catch (err) {
        if (err.message !== "UNAUTHORIZED") {
          showStatus("error", "✖ Could not connect. Please check your connection.");
        }
        console.error(err);
      } finally {
        btn.disabled    = false;
        btn.textContent = "Submit Request";
      }
    });
  }

  function showStatus(type, msg) {
    if (!statusArea) return;
    statusArea.className     = `status-area status-${type}`;
    statusArea.innerHTML     = msg;
    statusArea.style.display = "block";
  }
}

// ============================================================
//  PAGE: MAINTENANCE DASHBOARD (maintenance.html)
// ============================================================
if (PAGE === "dashboard") {
  let allRequests  = [];
  let activeFilter = "all";
  let refreshTimer = null;

  fetchRequests();
  startAutoRefresh();

  document.querySelectorAll("[data-filter]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-filter]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      activeFilter = btn.dataset.filter;
      renderTable(allRequests);
    });
  });

  const searchInput = $("searchInput");
  if (searchInput) {
    searchInput.addEventListener("input", () => renderTable(allRequests));
  }

  async function fetchRequests() {
    const loader = $("tableLoader");
    if (loader) loader.style.display = "flex";

    try {
      const data  = await apiGet({ action: "getRequests" });
      allRequests = Array.isArray(data) ? data : [];
      renderTable(allRequests);
      updateCounters(allRequests);
    } catch (err) {
      if (err.message === "UNAUTHORIZED") return; // UI ya bloqueada
      console.error("Error fetching requests:", err);
      const tbody = document.querySelector("#requestsTable tbody");
      if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Failed to load data. <button onclick="fetchRequests()" class="btn-link">Retry</button></td></tr>`;
    } finally {
      if (loader) loader.style.display = "none";
    }
  }

  function renderTable(data) {
    const tbody  = document.querySelector("#requestsTable tbody");
    const search = (searchInput?.value || "").toLowerCase();

    let filtered = data.filter(r => {
      const matchFilter = activeFilter === "all" || r.Status === activeFilter;
      const matchSearch = !search || [r.Machine, r.Department, r.Issue, r.ID]
        .some(v => (v || "").toString().toLowerCase().includes(search));
      return matchFilter && matchSearch;
    });

    const priOrder = { High: 0, Medium: 1, Low: 2 };
    filtered.sort((a, b) => {
      if (a.Status === "Completed" && b.Status !== "Completed") return 1;
      if (b.Status === "Completed" && a.Status !== "Completed") return -1;
      return (priOrder[a.Priority] ?? 3) - (priOrder[b.Priority] ?? 3);
    });

    if (!filtered.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No requests match your search</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(r => `
      <tr class="table-row ${r.Status === 'Completed' ? 'row-done' : ''}">
        <td class="td-id">${r.ID?.toString().slice(-6) || "—"}</td>
        <td>${r.Department || "—"}</td>
        <td>${r.Machine || "—"}</td>
        <td class="td-problema">${r.Issue || "—"}</td>
        <td><span class="badge ${priorityClass(r.Priority)}">${r.Priority || "—"}</span></td>
        <td><span class="status-chip ${statusClass(r.Status)}">${r.Status || "—"}</span></td>
        <td class="td-actions">
          ${r.Status !== "Completed" ? `
            <button class="btn-action btn-progress" onclick='openUpdateModal("${r.ID}", "In Progress", "${(r["Assigned To"]||"").replace(/"/g,"&quot;")}") '>
              In Progress
            </button>
            <button class="btn-action btn-done" onclick='openUpdateModal("${r.ID}", "Completed", "${(r["Assigned To"]||"").replace(/"/g,"&quot;")}") '>
              Complete
            </button>
          ` : `<span class="td-closed">Closed ${fmt(r["Closed Date"])}</span>`}
        </td>
      </tr>
    `).join("");
  }

  function updateCounters(data) {
    const set = (id, val) => { const el = $(id); if (el) el.textContent = val; };
    set("cnt-total",    data.length);
    set("cnt-pending",  data.filter(r => r.Status === "Pending").length);
    set("cnt-progress", data.filter(r => r.Status === "In Progress").length);
    set("cnt-done",     data.filter(r => r.Status === "Completed").length);
  }

  window.openUpdateModal = function(id, defaultStatus, currentTech) {
    const modal   = $("updateModal");
    const idField = $("modalId");
    const stField = $("modalStatus");
    const tcField = $("modalTechnician");
    if (!modal) return;

    idField.value = id;
    stField.value = defaultStatus;
    if (tcField && currentTech) tcField.value = currentTech;
    modal.classList.add("open");
  };

  window.closeModal = function() {
    const modal = $("updateModal");
    if (modal) modal.classList.remove("open");
  };

  const updateForm = $("updateForm");
  if (updateForm) {
    updateForm.addEventListener("submit", async e => {
      e.preventDefault();
      const btn = updateForm.querySelector("button[type=submit]");
      btn.disabled    = true;
      btn.textContent = "Saving...";

      try {
        const payload = {
          action:     "update",
          id:         $("modalId").value,
          status:     $("modalStatus").value,
          technician: $("modalTechnician").value,
          comment:    $("modalComment").value,
        };
        const res = await apiPostJSONP(payload);

        if (res.success) {
          closeModal();
          updateForm.reset();
          await fetchRequests();
        } else {
          alert("Error: " + (res.error || "Could not update"));
        }
      } catch (err) {
        if (err.message !== "UNAUTHORIZED") alert("Connection error");
        console.error(err);
      } finally {
        btn.disabled    = false;
        btn.textContent = "Save changes";
      }
    });
  }

  function startAutoRefresh() {
    refreshTimer = setInterval(fetchRequests, IHC_CONFIG.REFRESH_INTERVAL);
  }

  window.fetchRequests = fetchRequests;
}
