/* =========================================================
   Glioblastoma Clinical Trials Finder - app logic
   Reads window.GBM_TRIALS (made by fetch_trials.py) and
   handles search, filters, results, and the detail popup.
   Plain JavaScript, no libraries.
   ========================================================= */

(function () {
  "use strict";

  const PAGE_SIZE = 25; // how many cards to show before "Show more"

  // Order the status options show up in (most useful first)
  const STATUS_ORDER = [
    "Recruiting", "Not yet recruiting", "Enrolling by invitation", "Active, not recruiting",
    "Completed", "Suspended", "Terminated", "Withdrawn", "Unknown status",
  ];
  const OPEN_STATUSES = ["Recruiting", "Not yet recruiting", "Enrolling by invitation"];
  const PHASE_ORDER = [
    "Early Phase 1", "Phase 1", "Phase 1/2", "Phase 2", "Phase 2/3", "Phase 3", "Phase 4", "Not applicable",
  ];
  const DIAGNOSIS_ORDER = ["Newly diagnosed", "Recurrent", "Both", "Not specified"];
  // same order as ClinicalTrials.gov's Study Type filter
  const STUDY_TYPE_ORDER = [
    "Interventional", "Observational", "Patient registries", "Expanded access",
    "Individual patients", "Intermediate-size population", "Treatment IND/Protocol",
  ];

  // ---------- helpers ----------
  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtNum = (n) => Number(n).toLocaleString();

  function fmtDate(d) {
    if (!d) return "—";
    const parts = d.split("-");
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    if (parts.length === 3) return `${months[+parts[1] - 1]} ${+parts[2]}, ${parts[0]}`;
    if (parts.length === 2) return `${months[+parts[1] - 1]} ${parts[0]}`;
    return d;
  }

  function statusClass(status) {
    if (status === "Recruiting") return "badge-ok";
    if (status === "Not yet recruiting" || status === "Enrolling by invitation") return "badge-soon";
    if (status === "Suspended" || status === "Active, not recruiting") return "badge-warn";
    return "badge-off";
  }

  // ---------- load data ----------
  const DATA = window.GBM_TRIALS;
  $("#year").textContent = new Date().getFullYear();

  if (!DATA || !Array.isArray(DATA.trials)) {
    $("#resultList").innerHTML = `
      <div class="empty">
        <h3>No trial data yet</h3>
        <p>Run <code>python3 fetch_trials.py</code> in the project folder to download the trials, then reload this page.</p>
      </div>`;
    $("#filters").hidden = true;
    return;
  }

  const TRIALS = DATA.trials;

  // Build one lowercase search string per trial (done once, makes searching fast)
  TRIALS.forEach((t) => {
    t._hay = [
      t.nct_id, t.title, t.official_title, t.acronym, t.sponsor,
      t.conditions.join(" "),
      t.interventions.map((i) => i.name).join(" "),
      t.locations.map((l) => `${l.facility} ${l.city} ${l.state} ${l.country}`).join(" "),
    ].join(" ").toLowerCase();
    // older data files (before study_type_tags existed) - fall back to the main type
    if (!t.study_type_tags) t.study_type_tags = t.study_type ? [t.study_type.split(" (")[0]] : [];
  });

  // ---------- filter state ----------
  const state = {
    q: "",
    sort: "updated",
    status: new Set(),
    phase: new Set(),
    diagnosis: new Set(),
    intervention: new Set(),
    age: new Set(),
    studyType: new Set(),
    country: "",
    usState: "",
    gbmOnly: false,
    shown: PAGE_SIZE,
  };

  // ---------- build filter sidebar ----------
  function countBy(getter) {
    const counts = new Map();
    TRIALS.forEach((t) => {
      const vals = [].concat(getter(t));
      new Set(vals).forEach((v) => v && counts.set(v, (counts.get(v) || 0) + 1));
    });
    return counts;
  }

  function sortByOrder(counts, order) {
    const keys = [...counts.keys()];
    return keys.sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      if (ia === -1 && ib === -1) return counts.get(b) - counts.get(a);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  }

  function checkboxGroup(title, key, counts, order, hint) {
    const keys = order ? sortByOrder(counts, order) : [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a));
    return `
      <div class="filter-group">
        <h3>${esc(title)}</h3>
        ${keys.map((k) => `
          <label><input type="checkbox" data-key="${key}" value="${esc(k)}">
            <span>${esc(k)}</span><span class="count">${fmtNum(counts.get(k))}</span></label>`).join("")}
        ${hint ? `<p class="hint">${esc(hint)}</p>` : ""}
      </div>`;
  }

  function selectGroup(title, id, counts, allLabel) {
    const keys = [...counts.keys()].sort((a, b) => a.localeCompare(b));
    return `
      <div class="filter-group">
        <h3>${esc(title)}</h3>
        <select id="${id}">
          <option value="">${esc(allLabel)}</option>
          ${keys.map((k) => `<option value="${esc(k)}">${esc(k)} (${fmtNum(counts.get(k))})</option>`).join("")}
        </select>
      </div>`;
  }

  $("#filters").innerHTML = [
    checkboxGroup("Recruitment status", "status", countBy((t) => t.status), STATUS_ORDER),
    checkboxGroup("Diagnosis", "diagnosis", countBy((t) => t.diagnosis), DIAGNOSIS_ORDER,
      "Tagged automatically from the trial's title and description."),
    checkboxGroup("Phase", "phase", countBy((t) => t.phase), PHASE_ORDER),
    checkboxGroup("Treatment type", "intervention", countBy((t) => t.intervention_types), null),
    checkboxGroup("Study type", "studyType", countBy((t) => t.study_type_tags), STUDY_TYPE_ORDER,
      "Interventional trials test a treatment. Observational studies follow patients without assigning one."),
    checkboxGroup("Age group", "age", countBy((t) => t.age_groups), ["Children (0-17)", "Adults (18-64)", "Older adults (65+)"]),
    selectGroup("Country", "countrySel", countBy((t) => t.countries), "Any country"),
    selectGroup("U.S. state", "stateSel", countBy((t) => t.us_states), "Any state"),
  ].join("");

  // ---------- filtering ----------
  function matches(t) {
    if (state.q) {
      const words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
      if (!words.every((w) => t._hay.includes(w))) return false;
    }
    if (state.status.size && !state.status.has(t.status)) return false;
    if (state.phase.size && !state.phase.has(t.phase)) return false;
    if (state.diagnosis.size && !state.diagnosis.has(t.diagnosis)) return false;
    if (state.intervention.size && !t.intervention_types.some((x) => state.intervention.has(x))) return false;
    if (state.age.size && !t.age_groups.some((x) => state.age.has(x))) return false;
    if (state.studyType.size && !t.study_type_tags.some((x) => state.studyType.has(x))) return false;
    if (state.country && !t.countries.includes(state.country)) return false;
    if (state.usState && !t.us_states.includes(state.usState)) return false;
    if (state.gbmOnly && !t.gbm_named) return false;
    return true;
  }

  function sorted(list) {
    const s = state.sort;
    const copy = list.slice();
    if (s === "updated") copy.sort((a, b) => (b.last_updated || "").localeCompare(a.last_updated || ""));
    if (s === "start_new") copy.sort((a, b) => (b.start_date || "").localeCompare(a.start_date || ""));
    if (s === "start_old") copy.sort((a, b) => (a.start_date || "9999").localeCompare(b.start_date || "9999"));
    if (s === "sites") copy.sort((a, b) => b.locations.length - a.locations.length);
    return copy;
  }

  // ---------- rendering ----------
  function locationSummary(t) {
    const locs = t.locations;
    if (!locs.length) return "Locations not listed";
    // prefer locations matching the chosen state/country so the card shows the relevant ones
    let pick = locs;
    if (state.usState) pick = locs.filter((l) => l.state === state.usState && l.country === "United States");
    else if (state.country) pick = locs.filter((l) => l.country === state.country);
    const places = [...new Set(pick.map((l) => [l.city, l.state || l.country].filter(Boolean).join(", ")))];
    const shown = places.slice(0, 2).join("; ");
    const more = locs.length - Math.min(2, places.length);
    return `${shown}${more > 0 ? ` + ${fmtNum(more)} more` : ""}`;
  }

  function cardHTML(t) {
    return `
      <article class="card" tabindex="0" data-id="${esc(t.nct_id)}">
        <div class="card-top">
          <span class="badge ${statusClass(t.status)}">${esc(t.status)}</span>
          <span class="tag">${esc(t.phase)}</span>
          ${t.diagnosis !== "Not specified" ? `<span class="tag">${esc(t.diagnosis)}</span>` : ""}
          <span class="nct">${esc(t.nct_id)}</span>
        </div>
        <h3>${esc(t.title)}</h3>
        <p class="sponsor">${esc(t.sponsor)}</p>
        <div class="card-meta">
          <span><b>Treatment:</b> ${esc(t.intervention_types.join(", ") || "Not listed")}</span>
          <span><b>Where:</b> ${esc(locationSummary(t))}</span>
          <span><b>Updated:</b> ${esc(fmtDate(t.last_updated))}</span>
        </div>
      </article>`;
  }

  let currentResults = [];

  function render() {
    currentResults = sorted(TRIALS.filter(matches));
    const total = currentResults.length;
    $("#resultCount").textContent = `${fmtNum(total)} trial${total === 1 ? "" : "s"} found`;

    if (!total) {
      $("#resultList").innerHTML = `
        <div class="empty"><h3>No matching trials</h3><p>Try removing a filter or using a different search word.</p></div>`;
      $("#loadMore").hidden = true;
      return;
    }
    $("#resultList").innerHTML = currentResults.slice(0, state.shown).map(cardHTML).join("");
    $("#loadMore").hidden = total <= state.shown;
    $("#loadMore").textContent = `Show more trials (${fmtNum(total - state.shown)} left)`;
  }

  function updateChips() {
    const recruiting = OPEN_STATUSES.every((s) => state.status.has(s)) && state.status.size === OPEN_STATUSES.length;
    document.querySelector('[data-quick="recruiting"]').classList.toggle("active", recruiting);
    document.querySelector('[data-quick="us"]').classList.toggle("active", state.country === "United States");
    document.querySelector('[data-quick="gbm"]').classList.toggle("active", state.gbmOnly);
  }

  // keep sidebar inputs in sync with state (used by quick chips / clear)
  function syncInputs() {
    document.querySelectorAll('#filters input[type="checkbox"]').forEach((cb) => {
      cb.checked = state[cb.dataset.key].has(cb.value);
    });
    $("#countrySel").value = state.country;
    $("#stateSel").value = state.usState;
    $("#q").value = state.q;
    $("#sort").value = state.sort;
  }

  function refresh() {
    state.shown = PAGE_SIZE;
    updateChips();
    render();
  }

  // ---------- hero stats + data date ----------
  const openCount = TRIALS.filter((t) => OPEN_STATUSES.includes(t.status)).length;
  const usOpen = TRIALS.filter((t) => OPEN_STATUSES.includes(t.status) && t.countries.includes("United States")).length;
  $("#heroStats").innerHTML = `
    <div><strong>${fmtNum(TRIALS.length)}</strong><span>Total trials</span></div>
    <div><strong>${fmtNum(openCount)}</strong><span>Open to patients</span></div>
    <div><strong>${fmtNum(usOpen)}</strong><span>Open in the U.S.</span></div>`;
  $("#dataDate").textContent = `Data from ClinicalTrials.gov, updated ${DATA.generated_at}`;

  // ---------- events ----------
  let typingTimer;
  $("#q").addEventListener("input", (e) => {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => { state.q = e.target.value.trim(); refresh(); }, 200);
  });
  $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; refresh(); });

  $("#filters").addEventListener("change", (e) => {
    const el = e.target;
    if (el.type === "checkbox") {
      const set = state[el.dataset.key];
      el.checked ? set.add(el.value) : set.delete(el.value);
    } else if (el.id === "countrySel") {
      state.country = el.value;
    } else if (el.id === "stateSel") {
      state.usState = el.value;
    }
    refresh();
  });

  document.querySelector(".quick-chips").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.id === "clearAll") {
      Object.assign(state, { q: "", country: "", usState: "", gbmOnly: false });
      ["status", "phase", "diagnosis", "intervention", "age", "studyType"].forEach((k) => state[k].clear());
    } else if (btn.dataset.quick === "recruiting") {
      const on = btn.classList.contains("active");
      state.status.clear();
      if (!on) OPEN_STATUSES.forEach((s) => state.status.add(s));
    } else if (btn.dataset.quick === "us") {
      state.country = state.country === "United States" ? "" : "United States";
    } else if (btn.dataset.quick === "gbm") {
      state.gbmOnly = !state.gbmOnly;
    }
    syncInputs();
    refresh();
  });

  $("#loadMore").addEventListener("click", () => { state.shown += PAGE_SIZE; render(); });

  $("#filtersToggle").addEventListener("click", (e) => {
    const open = $("#filters").classList.toggle("open");
    e.target.textContent = open ? "Hide filters" : "Show filters";
  });

  // open a trial on click / Enter
  $("#resultList").addEventListener("click", (e) => {
    const card = e.target.closest(".card");
    if (card) location.hash = card.dataset.id;
  });
  $("#resultList").addEventListener("keydown", (e) => {
    const card = e.target.closest(".card");
    if (card && e.key === "Enter") location.hash = card.dataset.id;
  });

  // ---------- detail popup ----------
  // Turns ClinicalTrials.gov's eligibility text (markdown-ish) into simple HTML
  function eligibilityHTML(text) {
    if (!text) return "<p>Not provided. Check the official listing.</p>";
    const lines = text.replace(/\\([<>*_\-\[\]().#])/g, "$1").split(/\r?\n/);
    let html = "", inList = false;
    const closeList = () => { if (inList) { html += "</ul>"; inList = false; } };
    lines.forEach((raw) => {
      const line = raw.trim();
      if (!line) return;
      const bullet = line.match(/^(?:[*\-•]|\d+[.)])\s+(.*)$/);
      if (/^(inclusion|exclusion)( criteria)?:?$/i.test(line.replace(/\*/g, ""))) {
        closeList();
        html += `<h4>${esc(line.replace(/\*/g, "").replace(/:$/, ""))}</h4>`;
      } else if (bullet) {
        if (!inList) { html += "<ul>"; inList = true; }
        html += `<li>${esc(bullet[1])}</li>`;
      } else {
        closeList();
        html += `<p>${esc(line)}</p>`;
      }
    });
    closeList();
    return html;
  }

  function contactLine(c) {
    const bits = [c.name, c.phone, c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : ""]
      .filter(Boolean).map((b, i) => (i === 2 || b.startsWith("<a") ? b : esc(b)));
    return bits.join(" · ");
  }

  function locationsHTML(locs, filter) {
    const f = (filter || "").toLowerCase();
    // recruiting sites first, then by country/state/city
    const rank = (l) => (l.status === "Recruiting" ? 0 : l.status === "Not yet recruiting" ? 1 : 2);
    const list = locs
      .filter((l) => !f || `${l.facility} ${l.city} ${l.state} ${l.country}`.toLowerCase().includes(f))
      .sort((a, b) => rank(a) - rank(b) || a.country.localeCompare(b.country) || a.state.localeCompare(b.state) || a.city.localeCompare(b.city));
    if (!list.length) return "<p>No locations match.</p>";
    return `<ul class="loc-list">${list.map((l) => `
      <li>
        <div class="fac">${esc(l.facility || "Site name not listed")}</div>
        <div class="where">${esc([l.city, l.state, l.country].filter(Boolean).join(", "))}
          ${l.status ? ` · <span class="badge ${statusClass(l.status)}">${esc(l.status)}</span>` : ""}</div>
        ${l.contact || l.phone || l.email ? `<div>Contact: ${contactLine({ name: l.contact, phone: l.phone, email: l.email })}</div>` : ""}
      </li>`).join("")}</ul>`;
  }

  function ageText(t) {
    if (t.min_age && t.max_age) return `${t.min_age} to ${t.max_age}`;
    if (t.min_age) return `${t.min_age} and older`;
    if (t.max_age) return `Up to ${t.max_age}`;
    return "Not specified";
  }

  function openTrial(id) {
    const t = TRIALS.find((x) => x.nct_id === id);
    if (!t) return closeModal();

    const ivs = t.interventions.length
      ? `<ul class="contact-list">${t.interventions.map((i) => `<li><b>${esc(i.name)}</b> (${esc(i.type)})</li>`).join("")}</ul>`
      : "Not listed";
    const central = t.central_contacts.length
      ? `<ul class="contact-list">${t.central_contacts.map((c) => `<li>${contactLine(c)}</li>`).join("")}</ul>`
      : "See locations below or the official listing.";

    $("#modalBody").innerHTML = `
      <div class="d-head">
        <div class="card-top">
          <span class="badge ${statusClass(t.status)}">${esc(t.status)}</span>
          <span class="tag">${esc(t.phase)}</span>
          ${t.diagnosis !== "Not specified" ? `<span class="tag">${esc(t.diagnosis)}</span>` : ""}
        </div>
        <h2 id="modalTitle">${esc(t.title)}</h2>
        ${t.official_title && t.official_title !== t.title ? `<p class="official">${esc(t.official_title)}</p>` : ""}
        <div class="d-actions">
          <a class="btn btn-white" href="${esc(t.url)}" target="_blank" rel="noopener">View on ClinicalTrials.gov</a>
        </div>
      </div>
      <div class="d-body">
        <div class="d-section">
          <h3>Key facts</h3>
          <table class="facts">
            <tr><th>Trial ID</th><td>${esc(t.nct_id)}${t.acronym ? ` (${esc(t.acronym)})` : ""}</td></tr>
            <tr><th>Sponsor</th><td>${esc(t.sponsor)}</td></tr>
            <tr><th>Study type</th><td>${esc(t.study_type)}</td></tr>
            <tr><th>Conditions</th><td>${esc(t.conditions.join(", "))}</td></tr>
            <tr><th>Ages</th><td>${esc(ageText(t))}</td></tr>
            <tr><th>Sex</th><td>${esc(t.sex)}</td></tr>
            <tr><th>Enrollment</th><td>${t.enrollment ? fmtNum(t.enrollment) + " participants" : "—"}</td></tr>
            <tr><th>Start date</th><td>${esc(fmtDate(t.start_date))}</td></tr>
            <tr><th>Primary completion</th><td>${esc(fmtDate(t.completion_date))}</td></tr>
            <tr><th>Last updated</th><td>${esc(fmtDate(t.last_updated))}</td></tr>
            <tr><th>Results posted</th><td>${t.has_results ? "Yes" : "No"}</td></tr>
          </table>
        </div>

        <div class="d-section">
          <h3>About this trial</h3>
          <p class="summary">${esc(t.summary || "No summary provided.")}</p>
        </div>

        <div class="d-section">
          <h3>Treatments being studied</h3>
          ${ivs}
        </div>

        <div class="d-section">
          <h3>Who can join</h3>
          <div class="elig collapsible" id="eligBox">${eligibilityHTML(t.eligibility)}</div>
          <button class="link-btn" id="eligToggle">Show full eligibility</button>
        </div>

        <div class="d-section">
          <h3>Contacts</h3>
          ${central}
        </div>

        <div class="d-section">
          <h3>Locations (${fmtNum(t.locations.length)})</h3>
          ${t.locations.length > 8 ? `<input class="loc-search" id="locSearch" type="search" placeholder="Filter locations by city, state, or hospital…">` : ""}
          <div id="locBox">${locationsHTML(t.locations, "")}</div>
        </div>

        <div class="d-section">
          <div class="disclaimer-box">
            This information comes from ClinicalTrials.gov and may change. It is not medical advice. Talk with your care team about whether a trial is right for you.
          </div>
        </div>
      </div>`;

    // eligibility expand/collapse (only show the button if it's actually long)
    const box = $("#eligBox"), toggle = $("#eligToggle");
    requestAnimationFrame(() => {
      if (box.scrollHeight <= 360) { box.classList.add("open"); toggle.hidden = true; }
    });
    toggle.addEventListener("click", () => {
      const open = box.classList.toggle("open");
      toggle.textContent = open ? "Show less" : "Show full eligibility";
    });

    const ls = $("#locSearch");
    if (ls) ls.addEventListener("input", () => { $("#locBox").innerHTML = locationsHTML(t.locations, ls.value); });

    $("#modal").hidden = false;
    document.body.classList.add("modal-open");
    $(".modal-panel").scrollTop = 0;
    $("#modal").scrollTop = 0;
    $(".modal-close").focus();
  }

  function closeModal() {
    $("#modal").hidden = true;
    document.body.classList.remove("modal-open");
  }

  $("#modal").addEventListener("click", (e) => {
    if (e.target.hasAttribute("data-close")) history.pushState("", document.title, location.pathname + location.search) || onHash();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("#modal").hidden) {
      history.pushState("", document.title, location.pathname + location.search);
      onHash();
    }
  });

  // trial links are shareable: index.html#NCT01234567
  function onHash() {
    const id = decodeURIComponent(location.hash.slice(1));
    if (/^NCT\d{8}$/i.test(id)) openTrial(id.toUpperCase());
    else closeModal();
  }
  window.addEventListener("hashchange", onHash);

  // ---------- go ----------
  refresh();
  onHash();
})();
