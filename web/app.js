import { ACTION, ADDRESSEE, COMMENTS_EN, COMMENTS_FR, DATE, EN, FR, ORG, REF, SECTOR_EN, SECTOR_FR, dateAnomaly, pageSize } from "./search.mjs";

const $ = id => document.getElementById(id);
const wholeNumber = new Intl.NumberFormat("en-CA");
const dateFormat = new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeZone: "UTC" });
const today = new Date().toISOString().slice(0, 10);
const actionNames = { D: "For decision", I: "For information", S: "For signature" };
const addressees = { D: "Deputy head or equivalent", M: "Minister" };
const officialBase = "https://search.open.canada.ca/briefingt/";
const atipBase = "https://coolcode.ca/atip/";
const fields = { q: "query", institution: "institution", from: "from", to: "to", action: "action", sort: "sort" };
const startParams = new URLSearchParams(location.hash.slice(1));
const searchForm = $("search-form");
const query = $("query");
const results = $("results");
const empty = $("empty");
const dialog = $("record");
const status = $("status");
let manifest;
let worker;
let currentPage = 1;
let lastResult;
let loadFailed = false;
let requestID = 0;
let requestRecord = startParams.get("ref") ? [startParams.get("org") ?? "", startParams.get("ref")] : null;
let debounce;

for (const [param, id] of Object.entries(fields)) {
  if (id !== "institution" && startParams.has(param)) $(id).value = startParams.get(param);
}
if (!$("sort").value) $("sort").value = "relevance";
query.value = query.value.slice(0, 240);

function el(tag, content, className) {
  const node = document.createElement(tag);
  if (content != null) node.textContent = content;
  if (className) node.className = className;
  return node;
}

function link(label, url) {
  const node = el("a", label);
  node.href = url;
  node.target = "_blank";
  node.rel = "noopener";
  return node;
}

function formatDate(value, fallback = "Date unavailable") {
  if (!value) return fallback;
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) ? dateFormat.format(date) : fallback;
}

function institution(row) {
  return manifest?.institutions[row[ORG]] || row[ORG] || "Institution unavailable";
}

function title(row) {
  return row[EN] || row[FR] || "Title unavailable";
}

function officialRecord(row) {
  return row[ORG] && row[REF]
    ? `${officialBase}record/${encodeURIComponent(`${row[ORG]},${row[REF]}`)}`
    : officialSearch(title(row), row[ORG]);
}

function officialSearch(text, org = "") {
  const url = new URL(officialBase);
  if (text) url.searchParams.set("search_text", text);
  if (org) url.searchParams.set("owner_org", org);
  return url.href;
}

function atipLink(text, org) {
  const params = new URLSearchParams();
  if (text) params.set("q", text.slice(0, 240));
  if (org) params.set("institution", org);
  return `${atipBase}#${params}`;
}

function shareLink(row) {
  const url = new URL(location.href);
  url.hash = new URLSearchParams({ org: row[ORG], ref: row[REF], q: row[REF], institution: row[ORG] });
  return url.href;
}

function selectedFilters() {
  return Object.fromEntries(Object.values(fields).map(id => [id, $(id).value.trim()]));
}

function writeLocation(filters) {
  const params = new URLSearchParams();
  Object.entries(fields).forEach(([param, id]) => {
    if (filters[id] && !(id === "sort" && filters[id] === "relevance")) params.set(param, filters[id]);
  });
  const encoded = params.toString();
  history.replaceState(null, "", `${location.pathname}${location.search}${encoded ? "#" + encoded : ""}`);
}

function updateSuggestions() {
  for (const button of document.querySelectorAll("[data-query]")) {
    button.setAttribute("aria-pressed", button.dataset.query === query.value ? "true" : "false");
  }
}

function reset() {
  searchForm.reset();
  requestRecord = null;
  updateSuggestions();
  pageSearch(1, true);
  query.focus();
}

function scheduleSearch(delay = 75) {
  requestRecord = null;
  requestID += 1;
  clearTimeout(debounce);
  debounce = setTimeout(() => pageSearch(1, true), delay);
  updateSuggestions();
}

function pageSearch(page, updateURL = false) {
  if (loadFailed || !worker) return;
  const filters = selectedFilters();
  $("source-search").href = officialSearch(filters.query, filters.institution);
  if (filters.from && filters.to && filters.from > filters.to) {
    displayEmpty("Check the date range", "The first date must come before or match the last date.");
    status.textContent = "Date range needs attention.";
    return;
  }
  if (updateURL) writeLocation(filters);
  status.textContent = manifest && lastResult ? "Updating results…" : "Loading searchable data…";
  worker.postMessage({ type: "search", id: ++requestID, page, filters, record: requestRecord });
}

function displayEmpty(heading, message) {
  results.replaceChildren();
  $("pager").hidden = true;
  empty.replaceChildren(el("h3", heading), el("p", message));
  empty.hidden = false;
}

function highlightTitle(text) {
  const tokens = query.value.match(/[\p{L}\p{N}]{3,}/gu)?.slice(0, 12) ?? [];
  const fragment = document.createDocumentFragment();
  if (!tokens.length) {
    fragment.append(text);
    return fragment;
  }
  // Tokens contain letters and numbers only, so they can be used as literal alternatives.
  const matcher = new RegExp(tokens.join("|"), "giu");
  let offset = 0;
  for (const match of text.matchAll(matcher)) {
    fragment.append(text.slice(offset, match.index), el("mark", match[0], "mark"));
    offset = match.index + match[0].length;
  }
  fragment.append(text.slice(offset));
  return fragment;
}

function resultCard(row) {
  const item = el("li", null, "result");
  const copy = el("div");
  const heading = el("h3");
  heading.append(highlightTitle(title(row)));
  const meta = [institution(row), formatDate(row[DATE]), actionNames[row[ACTION]]].filter(Boolean);
  copy.append(el("div", row[REF] || "Reference unavailable", "ref"), heading, el("p", meta.join(" · "), "meta"));
  if (dateAnomaly(row[DATE], today)) copy.append(el("div", "Unusual date in the official listing", "note"));
  const open = el("button", "View note details");
  open.type = "button";
  open.setAttribute("aria-label", `View note details for ${row[REF] || title(row)}`);
  open.addEventListener("click", () => openNote(row));
  item.append(copy, open);
  return item;
}

function render(result) {
  lastResult = result;
  currentPage = result.page;
  empty.hidden = true;
  const count = wholeNumber.format(result.total);
  status.textContent = `${count} ${result.total === 1 ? "note" : "notes"} found`;
  if (!result.total) {
    displayEmpty("No matching notes", "Try fewer words, a reference number, or a wider date range. A note may still exist outside the published register.");
    const clear = el("button", "Clear all filters");
    clear.addEventListener("click", reset);
    empty.append(clear);
    return;
  }
  results.replaceChildren(...result.rows.map(resultCard));
  $("pager").hidden = result.pages <= 1;
  $("previous").disabled = currentPage <= 1;
  $("next").disabled = currentPage >= result.pages;
  $("page").textContent = `Page ${wholeNumber.format(currentPage)} of ${wholeNumber.format(result.pages)}`;
}

function prepareMetadata(data) {
  manifest = data;
  $("record-count").textContent = wholeNumber.format(data.records);
  const entries = Object.entries(data.institutions).sort((left, right) => left[1].localeCompare(right[1], "en-CA"));
  $("coverage").textContent = `titles · ${wholeNumber.format(entries.filter(([slug]) => slug).length)} institutions`;
  $("source-date").textContent = data.sourceUpdated ? `Source updated ${formatDate(data.sourceUpdated)}` : "Source update date unavailable";
  $("build-date").textContent = `Snapshot built ${formatDate(data.snapshotBuilt)}`;
  for (const [slug, name] of entries) {
    if (!slug) continue;
    const option = el("option", name);
    option.value = slug;
    $("institution").append(option);
  }
  if (startParams.has("institution")) $("institution").value = startParams.get("institution");
  pageSearch(1);
}

function openNote(row) {
  $("detail-ref").textContent = row[REF] || "Reference unavailable";
  $("detail-title").textContent = title(row);
  const details = el("dl", null, "detail-metadata");
  const properties = [
    ["Institution", institution(row)],
    ["Received", `${formatDate(row[DATE])}${dateAnomaly(row[DATE], today) ? " (unusual source date, verify)" : ""}`],
    ["French title", row[FR]],
    ["Originating sector", row[SECTOR_EN] || row[SECTOR_FR]],
    ["Addressee", addressees[row[ADDRESSEE]] || row[ADDRESSEE]],
    ["Action", actionNames[row[ACTION]] || row[ACTION]],
    ["Published comments", row[COMMENTS_EN] || row[COMMENTS_FR]],
  ];
  for (const [label, value] of properties) {
    if (value) details.append(el("dt", label), el("dd", value));
  }
  const actions = el("div", null, "detail-actions");
  actions.append(link("Official record ↗", officialRecord(row)));
  if (row[REF]) {
    actions.append(link("Check this reference in ATIP Explorer ↗", atipLink(`"${row[REF].replaceAll('"', " ")}"`, row[ORG])));
    const share = el("button", "Copy note link");
    share.type = "button";
    share.addEventListener("click", () => copy(shareLink(row), share, "Link copied"));
    actions.append(share);
  }
  const activeQuery = query.value.trim();
  const topic = activeQuery && activeQuery !== row[REF] ? activeQuery : title(row);
  actions.append(link("Look for related releases ↗", atipLink(topic, row[ORG])));
  $("detail-metadata").replaceChildren(details, actions);

  const label = row[EN] || row[FR];
  const identifiers = [
    row[REF] && `Reference number: ${row[REF]}`,
    label && `Published title: ${label}`,
    row[DATE] && `Date received in the register: ${row[DATE]}`,
    institution(row) !== "Institution unavailable" && `Institution: ${institution(row)}`,
    (row[SECTOR_EN] || row[SECTOR_FR]) && `Originating sector: ${row[SECTOR_EN] || row[SECTOR_FR]}`,
    `Official listing: ${officialRecord(row)}`,
  ].filter(Boolean);
  $("draft-text").value = [
    "Under the Access to Information Act, I request an electronic copy of the briefing note identified below, including any annexes and attachments that accompanied it.",
    identifiers.join("\n"),
    "If any material is withheld, please release the severable portions.",
  ].join("\n\n");
  $("copy-status").textContent = "";
  if (!dialog.open) dialog.showModal();
}

async function copy(value, statusElement, success, input) {
  try {
    await navigator.clipboard.writeText(value);
    statusElement.textContent = success;
  } catch {
    if (input) {
      input.focus();
      input.select();
      statusElement.textContent = "Press Ctrl+C or Command+C to copy the selected draft.";
    } else {
      const fallback = el("input");
      fallback.value = value;
      fallback.readOnly = true;
      fallback.setAttribute("aria-label", "Note link");
      statusElement.after(fallback);
      fallback.focus();
      fallback.select();
      statusElement.textContent = "Copy the selected link";
    }
  }
}

function failed() {
  loadFailed = true;
  status.textContent = "Search data unavailable.";
  displayEmpty("The snapshot could not load", "Reload this page to try again, or continue in the live government register.");
  empty.append(link("Use the official search ↗", officialSearch(query.value, $("institution").value)));
}

$("clear").addEventListener("click", reset);
$("clear").setAttribute("aria-label", "Clear search and filters");
query.addEventListener("input", () => scheduleSearch());
searchForm.addEventListener("submit", event => {
  event.preventDefault();
  scheduleSearch(0);
});
for (const id of ["institution", "from", "to", "action", "sort"]) $(id).addEventListener("change", () => scheduleSearch(0));
for (const button of document.querySelectorAll("[data-query]")) button.addEventListener("click", () => {
  query.value = button.dataset.query;
  scheduleSearch(0);
  query.focus();
});
for (const [id, shift] of [["previous", -1], ["next", 1]]) $(id).addEventListener("click", () => {
  pageSearch(currentPage + shift);
  $("results-title").focus();
});
$("copy-draft").addEventListener("click", () => copy($("draft-text").value, $("copy-status"), "Draft copied.", $("draft-text")));
updateSuggestions();

try {
  worker = new Worker(new URL("./worker.mjs", import.meta.url), { type: "module" });
  worker.addEventListener("message", ({ data }) => {
    if (data.type === "metadata") prepareMetadata(data.manifest);
    if (data.type === "progress" && !lastResult) {
      status.textContent = `Preparing search · ${wholeNumber.format(data.loaded)} notes loaded`;
    }
    if (data.type === "error") failed();
    if (data.type === "results" && data.id === requestID) {
      render(data);
      if (requestRecord) {
        requestRecord = null;
        if (data.linked) openNote(data.linked);
        else status.textContent += " · The linked note could not be found in this snapshot.";
      }
    }
  });
  worker.addEventListener("error", failed);
} catch {
  failed();
}
