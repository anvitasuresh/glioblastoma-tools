/* =========================================================
   Glioblastoma Research Finder - app logic
   Searches PubMed live through NCBI's E-utilities API.
   Every search is combined with the glioblastoma restriction
   in config.js. Plain JavaScript, no libraries.

   How a search works:
     1. esearch  -> list of matching PubMed IDs + total count
     2. esummary -> title/authors/journal for those IDs (the result cards)
     3. efetch   -> full record with abstract (only when a paper is opened)
   ========================================================= */

(function () {
  "use strict";

  const CFG = window.GBM_PAPERS_CONFIG;
  const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/";
  const PAGE_SIZE = CFG.pageSize || 20;
  const MAX_RESULTS = 9999; // PubMed's API won't page past ~10,000 results
  const THIS_YEAR = new Date().getFullYear();

  // ---------- helpers ----------
  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtNum = (n) => Number(n).toLocaleString();

  // Titles from PubMed sometimes contain <i>, <sup> etc. Keep only those few tags.
  function safeInline(s) {
    const decoded = new DOMParser().parseFromString(String(s ?? ""), "text/html").documentElement.textContent;
    return esc(decoded).replace(/&lt;(\/?)(i|b|sup|sub|em|strong)&gt;/gi, "<$1$2>");
  }

  // ---------- talking to PubMed ----------
  // NCBI allows 3 requests/second without an API key (10 with one),
  // so requests go out one at a time with a small gap.
  const GAP_MS = CFG.apiKey ? 110 : 360;
  let queue = Promise.resolve();
  let lastCall = 0;

  function eutils(endpoint, params, as = "json") {
    const url = new URL(EUTILS + endpoint);
    const all = { db: "pubmed", ...params, tool: CFG.tool };
    if (CFG.email) all.email = CFG.email;
    if (CFG.apiKey) all.api_key = CFG.apiKey;
    if (as === "json") all.retmode = "json";
    Object.entries(all).forEach(([k, v]) => url.searchParams.set(k, v));

    const run = async () => {
      const wait = Math.max(0, lastCall + GAP_MS - Date.now());
      if (wait) await new Promise((r) => setTimeout(r, wait));
      lastCall = Date.now();
      let res = await fetch(url);
      if (res.status === 429) { // too many requests: wait and try once more
        await new Promise((r) => setTimeout(r, 1500));
        lastCall = Date.now();
        res = await fetch(url);
      }
      if (!res.ok) throw new Error(`PubMed returned an error (${res.status})`);
      return as === "json" ? res.json() : res.text();
    };
    const p = queue.then(run, run);
    queue = p.catch(() => {});
    return p;
  }

  // ---------- filter state ----------
  const state = {
    q: "",
    sort: "pub_date",
    topics: new Set(),
    types: new Set(),
    date: "any",          // any | 1 | 5 | 10 | custom
    from: "", to: "",
    free: false,
    hasAbstract: false,
    english: false,
    humans: false,
    page: 1,
  };

  function buildQuery() {
    const parts = [CFG.baseQuery];
    if (state.q) parts.push(`(${state.q})`);
    const pick = (list, set) => list.filter((x) => set.has(x.label)).map((x) => `(${x.query})`);
    const t = pick(CFG.topics, state.topics);
    if (t.length) parts.push(`(${t.join(" OR ")})`);
    const ty = pick(CFG.articleTypes, state.types);
    if (ty.length) parts.push(`(${ty.join(" OR ")})`);
    if (state.date !== "any") {
      let from, to = THIS_YEAR;
      if (state.date === "custom") {
        from = parseInt(state.from, 10) || 1900;
        to = parseInt(state.to, 10) || THIS_YEAR;
      } else {
        from = THIS_YEAR - Number(state.date) + (state.date === "1" ? 0 : 1);
      }
      if (state.date === "1") {
        // past 12 months, not just this calendar year
        parts.push('("last 1 year"[dp])');
      } else {
        parts.push(`("${from}"[dp] : "${to}"[dp])`);
      }
    }
    if (state.free) parts.push("free full text[sb]");
    if (state.hasAbstract) parts.push("hasabstract");
    if (state.english) parts.push("english[la]");
    if (state.humans) parts.push("humans[mh]");
    return parts.join(" AND ");
  }

  // ---------- build filter sidebar ----------
  function checkboxGroup(title, key, items, hint) {
    return `
      <div class="filter-group">
        <h3>${esc(title)}</h3>
        ${items.map((it) => `
          <label><input type="checkbox" data-key="${key}" value="${esc(it.label)}"><span>${esc(it.label)}</span></label>`).join("")}
        ${hint ? `<p class="hint">${esc(hint)}</p>` : ""}
      </div>`;
  }

  $("#filters").innerHTML = `
    <div class="filter-group">
      <h3>Publication date</h3>
      ${[["any", "Any time"], ["1", "Past year"], ["5", "Past 5 years"], ["10", "Past 10 years"], ["custom", "Custom range"]]
        .map(([v, l]) => `<label><input type="radio" name="date" value="${v}"${v === "any" ? " checked" : ""}><span>${l}</span></label>`).join("")}
      <div class="date-row" id="dateRow" hidden>
        <input type="number" id="fromYear" placeholder="From" min="1900" max="${THIS_YEAR}">
        <span>to</span>
        <input type="number" id="toYear" placeholder="To" min="1900" max="${THIS_YEAR}">
      </div>
    </div>
    ${checkboxGroup("Topic", "topics", CFG.topics, "Pick several to see papers on any of them.")}
    ${checkboxGroup("Article type", "types", CFG.articleTypes)}
    <div class="filter-group">
      <h3>More options</h3>
      <label><input type="checkbox" data-flag="free"><span>Free full text</span></label>
      <label><input type="checkbox" data-flag="hasAbstract"><span>Has an abstract</span></label>
      <label><input type="checkbox" data-flag="english"><span>English only</span></label>
      <label><input type="checkbox" data-flag="humans"><span>Human studies only</span></label>
      <p class="hint">"Human studies only" can hide very new papers that PubMed hasn't tagged yet.</p>
    </div>`;

  // keep sidebar inputs in sync with state (used by quick chips / clear)
  function syncInputs() {
    document.querySelectorAll('#filters input[data-key]').forEach((cb) => { cb.checked = state[cb.dataset.key].has(cb.value); });
    document.querySelectorAll('#filters input[data-flag]').forEach((cb) => { cb.checked = state[cb.dataset.flag]; });
    document.querySelectorAll('#filters input[name="date"]').forEach((r) => { r.checked = r.value === state.date; });
    $("#dateRow").hidden = state.date !== "custom";
    $("#fromYear").value = state.from;
    $("#toYear").value = state.to;
    $("#q").value = state.q;
    $("#sort").value = state.sort;
  }

  function updateChips() {
    const chip = (k) => document.querySelector(`[data-quick="${k}"]`);
    chip("free").classList.toggle("active", state.free);
    chip("reviews").classList.toggle("active", state.types.size === 1 && state.types.has("Review"));
    chip("trials").classList.toggle("active", state.types.size === 1 && state.types.has("Clinical trial"));
    chip("year").classList.toggle("active", state.date === "1");
  }

  // ---------- rendering ----------
  function yearOf(s) { const m = String(s || "").match(/\d{4}/); return m ? m[0] : ""; }

  function authorShort(authors) {
    const names = (authors || []).map((a) => a.name).filter(Boolean);
    if (!names.length) return "No authors listed";
    return names.length > 3 ? `${names.slice(0, 3).join(", ")}, et al.` : names.join(", ");
  }

  // publication types worth showing (skip the generic ones)
  const HIDE_TYPES = new Set(["Journal Article", "Research Support, Non-U.S. Gov't", "Research Support, N.I.H., Extramural",
    "Research Support, U.S. Gov't, P.H.S.", "Research Support, N.I.H., Intramural", "Research Support, U.S. Gov't, Non-P.H.S.",
    "English Abstract", "Comment", "Comparative Study", "Evaluation Study", "Validation Study"]);

  function cardHTML(p) {
    const ids = Object.fromEntries((p.articleids || []).map((a) => [a.idtype, a.value]));
    const types = (p.pubtype || []).filter((t) => !HIDE_TYPES.has(t)).slice(0, 3);
    return `
      <article class="card" tabindex="0" data-id="${esc(p.uid)}">
        <div class="card-top">
          <span class="tag">${esc(yearOf(p.pubdate) || "—")}</span>
          ${ids.pmc ? '<span class="badge badge-free">Free full text</span>' : ""}
          ${types.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}
          <span class="nct">PMID ${esc(p.uid)}</span>
        </div>
        <h3>${safeInline(p.title)}</h3>
        <p class="authors">${esc(authorShort(p.authors))}</p>
        <p class="journal">${esc(p.fulljournalname || p.source)}${p.pubdate ? ` · ${esc(p.pubdate)}` : ""}</p>
      </article>`;
  }

  function showLoading() {
    $("#resultList").innerHTML = '<div class="loading"><div class="spinner"></div>Searching PubMed…</div>';
  }

  function showError(err) {
    const offline = err instanceof TypeError; // fetch network/CORS failure
    $("#resultList").innerHTML = `
      <div class="error-box">
        <h3>Couldn't reach PubMed</h3>
        <p>${offline
          ? "Check your internet connection and try again. If it keeps happening, something on this network may be blocking requests to PubMed (eutils.ncbi.nlm.nih.gov)."
          : esc(err.message) + ". PubMed may be busy, so try again in a moment."}</p>
      </div>`;
    $("#pager").hidden = true;
    $("#resultCount").textContent = "";
  }

  // ---------- searching ----------
  let searchId = 0; // ignore responses from older searches

  async function search() {
    const myId = ++searchId;
    const term = buildQuery();
    updateChips();
    showLoading();
    $("#pubmedLink").href = `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(term)}${state.sort === "pub_date" ? "&sort=date" : ""}`;
    $("#pubmedLink").textContent = "View this search on PubMed ↗";

    try {
      const retstart = (state.page - 1) * PAGE_SIZE;
      const s = await eutils("esearch.fcgi", { term, retstart, retmax: PAGE_SIZE, sort: state.sort });
      if (myId !== searchId) return;
      const count = Number(s.esearchresult.count || 0);
      const ids = s.esearchresult.idlist || [];

      $("#resultCount").textContent = `${fmtNum(count)} paper${count === 1 ? "" : "s"} found`;
      if (!ids.length) {
        $("#resultList").innerHTML = `
          <div class="empty"><h3>No matching papers</h3><p>Try removing a filter or using a different search word.</p></div>`;
        $("#pager").hidden = true;
        return;
      }

      const sum = await eutils("esummary.fcgi", { id: ids.join(",") });
      if (myId !== searchId) return;
      const papers = ids.map((id) => sum.result && sum.result[id]).filter((p) => p && !p.error);
      $("#resultList").innerHTML = papers.map(cardHTML).join("");

      const pages = Math.ceil(Math.min(count, MAX_RESULTS) / PAGE_SIZE);
      $("#pager").hidden = pages <= 1;
      $("#pageInfo").textContent = `Page ${fmtNum(state.page)} of ${fmtNum(pages)}`;
      $("#prevPage").disabled = state.page <= 1;
      $("#nextPage").disabled = state.page >= pages;
    } catch (err) {
      if (myId === searchId) showError(err);
    }
  }

  function refresh() { state.page = 1; search(); }

  // filters fire a search right away, but wait a moment so quick clicks become one search
  let filterTimer;
  function refreshSoon() { clearTimeout(filterTimer); filterTimer = setTimeout(refresh, 350); }

  // ---------- hero stats ----------
  async function loadStats() {
    try {
      const count = async (extra) => Number((await eutils("esearch.fcgi", {
        term: extra ? `${CFG.baseQuery} AND ${extra}` : CFG.baseQuery, retmax: 0,
      })).esearchresult.count || 0);
      const total = await count("");
      const year = await count('("last 1 year"[dp])');
      const free = await count("free full text[sb]");
      $("#heroStats").innerHTML = `
        <div><strong>${fmtNum(total)}</strong><span>Glioblastoma papers</span></div>
        <div><strong>${fmtNum(year)}</strong><span>In the past year</span></div>
        <div><strong>${fmtNum(free)}</strong><span>Free to read</span></div>`;
    } catch (e) {
      $("#heroStats").innerHTML = ""; // stats are a nice-to-have; the search shows any real error
    }
  }

  // ---------- events ----------
  $("#searchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    state.q = $("#q").value.trim();
    refresh();
  });
  // also search after the user stops typing for a moment
  let typingTimer;
  $("#q").addEventListener("input", (e) => {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      const v = e.target.value.trim();
      if (v !== state.q) { state.q = v; refresh(); }
    }, 800);
  });
  $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; refresh(); });

  $("#filters").addEventListener("change", (e) => {
    const el = e.target;
    if (el.dataset.key) {
      const set = state[el.dataset.key];
      el.checked ? set.add(el.value) : set.delete(el.value);
    } else if (el.dataset.flag) {
      state[el.dataset.flag] = el.checked;
    } else if (el.name === "date") {
      state.date = el.value;
      $("#dateRow").hidden = state.date !== "custom";
      if (state.date === "custom" && !state.from && !state.to) return; // wait for years
    } else if (el.id === "fromYear" || el.id === "toYear") {
      state.from = $("#fromYear").value;
      state.to = $("#toYear").value;
      if (state.date !== "custom") return;
    }
    refreshSoon();
  });

  document.querySelector(".quick-chips").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const on = btn.classList.contains("active");
    if (btn.id === "clearAll") {
      Object.assign(state, { q: "", date: "any", from: "", to: "", free: false, hasAbstract: false, english: false, humans: false });
      state.topics.clear(); state.types.clear();
    } else if (btn.dataset.quick === "free") {
      state.free = !state.free;
    } else if (btn.dataset.quick === "reviews" || btn.dataset.quick === "trials") {
      state.types.clear();
      if (!on) state.types.add(btn.dataset.quick === "reviews" ? "Review" : "Clinical trial");
    } else if (btn.dataset.quick === "year") {
      state.date = on ? "any" : "1";
    }
    syncInputs();
    refresh();
  });

  $("#prevPage").addEventListener("click", () => { state.page--; search(); $("#search").scrollIntoView(); });
  $("#nextPage").addEventListener("click", () => { state.page++; search(); $("#search").scrollIntoView(); });

  $("#filtersToggle").addEventListener("click", (e) => {
    const open = $("#filters").classList.toggle("open");
    e.target.textContent = open ? "Hide filters" : "Show filters";
  });

  $("#resultList").addEventListener("click", (e) => {
    const card = e.target.closest(".card");
    if (card) location.hash = "pmid-" + card.dataset.id;
  });
  $("#resultList").addEventListener("keydown", (e) => {
    const card = e.target.closest(".card");
    if (card && e.key === "Enter") location.hash = "pmid-" + card.dataset.id;
  });

  // ---------- paper detail popup ----------
  const detailCache = new Map();

  // Reads the efetch XML for one paper into a simple object
  function parsePaper(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, "text/xml");
    const art = doc.querySelector("PubmedArticle");
    if (!art) return null;
    const txt = (sel, el = art) => (el.querySelector(sel)?.textContent || "").trim();
    const all = (sel, el = art) => [...el.querySelectorAll(sel)];

    const authors = all("AuthorList > Author").map((a) => {
      const coll = txt("CollectiveName", a);
      const name = coll || [txt("ForeName", a) || txt("Initials", a), txt("LastName", a)].filter(Boolean).join(" ");
      const short = coll || [txt("LastName", a), txt("Initials", a)].filter(Boolean).join(" ");
      return { name, short, affil: txt("AffiliationInfo > Affiliation", a) };
    });

    const pd = art.querySelector("JournalIssue > PubDate");
    const pubDate = pd ? (txt("MedlineDate", pd) || [txt("Year", pd), txt("Month", pd), txt("Day", pd)].filter(Boolean).join(" ")) : "";

    const idOf = (type) => (art.querySelector(`PubmedData ArticleIdList ArticleId[IdType="${type}"]`)?.textContent || "").trim();

    return {
      pmid: txt("MedlineCitation > PMID"),
      title: txt("ArticleTitle"),
      abstract: all("Abstract > AbstractText").map((a) => ({ label: a.getAttribute("Label") || "", text: a.textContent.trim() })),
      authors,
      journal: txt("Journal > Title"),
      journalAbbr: txt("Journal > ISOAbbreviation") || txt("MedlineTA"),
      volume: txt("JournalIssue > Volume"),
      issue: txt("JournalIssue > Issue"),
      pages: txt("Pagination > MedlinePgn"),
      pubDate,
      year: yearOf(pubDate),
      types: all("PublicationTypeList > PublicationType").map((x) => x.textContent.trim()),
      mesh: all("MeshHeadingList > MeshHeading > DescriptorName").map((x) => x.textContent.trim()),
      keywords: all("KeywordList > Keyword").map((x) => x.textContent.trim()).filter(Boolean),
      doi: idOf("doi"),
      pmc: idOf("pmc"),
    };
  }

  function citation(p) {
    const names = p.authors.map((a) => a.short);
    const authorStr = names.length > 6 ? names.slice(0, 6).join(", ") + ", et al" : names.join(", ");
    let src = `${p.journalAbbr || p.journal}. ${p.year}`;
    if (p.volume) src += `;${p.volume}`;
    if (p.issue) src += `(${p.issue})`;
    if (p.pages) src += `:${p.pages}`;
    return `${authorStr ? authorStr + ". " : ""}${p.title.replace(/\.$/, "")}. ${src}.${p.doi ? ` doi:${p.doi}.` : ""} PMID: ${p.pmid}.`;
  }

  function detailHTML(p) {
    const types = p.types.filter((t) => !HIDE_TYPES.has(t));
    const abstract = p.abstract.length
      ? p.abstract.map((a) => `${a.label ? `<h4>${esc(a.label)}</h4>` : ""}<p>${esc(a.text)}</p>`).join("")
      : "<p>No abstract available. Use the links above to read the paper.</p>";
    const affils = [...new Set(p.authors.map((a) => a.affil).filter(Boolean))];
    const authorList = p.authors.map((a) => esc(a.name)).join(", ");
    const tags = [...new Set([...p.keywords, ...p.mesh])];

    return `
      <div class="d-head">
        <div class="card-top">
          ${p.year ? `<span class="badge" style="color:var(--plum)">${esc(p.year)}</span>` : ""}
          ${p.pmc ? '<span class="badge badge-free">Free full text</span>' : ""}
          ${types.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}
        </div>
        <h2 id="modalTitle">${esc(p.title)}</h2>
        <p class="official">${esc(p.journal)}${p.pubDate ? ` · ${esc(p.pubDate)}` : ""}</p>
        <div class="d-actions">
          <a class="btn btn-white" href="https://pubmed.ncbi.nlm.nih.gov/${esc(p.pmid)}/" target="_blank" rel="noopener">View on PubMed</a>
          ${p.pmc ? `<a class="btn btn-white" href="https://pmc.ncbi.nlm.nih.gov/articles/${esc(p.pmc)}/" target="_blank" rel="noopener">Read free full text</a>` : ""}
          ${p.doi ? `<a class="btn btn-white" href="https://doi.org/${esc(p.doi)}" target="_blank" rel="noopener">Publisher site</a>` : ""}
        </div>
      </div>
      <div class="d-body">
        <div class="d-section">
          <h3>Abstract</h3>
          <div class="abstract">${abstract}</div>
        </div>
        <div class="d-section">
          <h3>Authors</h3>
          <div class="author-full ${p.authors.length > 15 ? "collapsible" : ""}" id="authorBox">${authorList || "Not listed"}
            ${affils.length ? `<div class="affil"><b>Affiliation${affils.length > 1 ? "s" : ""}:</b> ${affils.slice(0, 5).map(esc).join("; ")}${affils.length > 5 ? "; …" : ""}</div>` : ""}
          </div>
          ${p.authors.length > 15 ? '<button class="link-btn" id="authorToggle">Show all authors</button>' : ""}
        </div>
        ${tags.length ? `
        <div class="d-section">
          <h3>Keywords</h3>
          <div class="kw-list">${tags.slice(0, 30).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>
        </div>` : ""}
        <div class="d-section">
          <h3>Cite this paper</h3>
          <p id="citeText">${esc(citation(p))}</p>
          <button class="link-btn" id="copyCite">Copy citation</button><span id="copyMsg"></span>
        </div>
        <div class="d-section">
          <div class="disclaimer-box">
            Research findings describe specific studies and may not apply to every patient. This is not medical advice. Talk with your care team about what this research means for you.
          </div>
        </div>
      </div>`;
  }

  async function openPaper(pmid) {
    $("#modal").hidden = false;
    document.body.classList.add("modal-open");
    $("#modalBody").innerHTML = '<div class="loading"><div class="spinner"></div>Loading paper…</div>';
    try {
      let p = detailCache.get(pmid);
      if (!p) {
        const xml = await eutils("efetch.fcgi", { id: pmid, retmode: "xml" }, "xml");
        p = parsePaper(xml);
        if (!p) throw new Error("Paper not found");
        detailCache.set(pmid, p);
      }
      if (location.hash !== "#pmid-" + pmid) return; // user moved on
      $("#modalBody").innerHTML = detailHTML(p);

      const at = $("#authorToggle");
      if (at) at.addEventListener("click", () => {
        const open = $("#authorBox").classList.toggle("open");
        at.textContent = open ? "Show fewer" : "Show all authors";
      });
      $("#copyCite").addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(citation(p)); $("#copyMsg").innerHTML = '<span class="copy-ok">Copied!</span>'; }
        catch (e) { $("#copyMsg").innerHTML = '<span class="copy-ok">Select the text above to copy it.</span>'; }
      });
      $(".modal-panel").scrollTop = 0;
      $("#modal").scrollTop = 0;
      $(".modal-close").focus();
    } catch (err) {
      $("#modalBody").innerHTML = `
        <div class="d-body" style="padding-top:40px">
          <div class="error-box"><h3>Couldn't load this paper</h3>
          <p>${err instanceof TypeError ? "Check your internet connection." : esc(err.message)}</p>
          <p><a href="https://pubmed.ncbi.nlm.nih.gov/${esc(pmid)}/" target="_blank" rel="noopener">Open it on PubMed instead ↗</a></p></div>
        </div>`;
    }
  }

  function closeModal() {
    $("#modal").hidden = true;
    document.body.classList.remove("modal-open");
  }

  function clearHash() {
    history.pushState("", document.title, location.pathname + location.search);
    onHash();
  }
  $("#modal").addEventListener("click", (e) => { if (e.target.hasAttribute("data-close")) clearHash(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#modal").hidden) clearHash(); });

  // paper links are shareable: index.html#pmid-12345678
  function onHash() {
    const m = location.hash.match(/^#pmid-(\d+)$/);
    if (m) openPaper(m[1]);
    else closeModal();
  }
  window.addEventListener("hashchange", onHash);

  // ---------- go ----------
  $("#year").textContent = THIS_YEAR;
  syncInputs();
  search();
  loadStats();
  onHash();
})();
