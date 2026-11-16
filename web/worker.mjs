import { findNotes, ORG, REF, LOOKUP, pageSize } from "./search.mjs";

let rows = [];
let ready = false;
let queued;
let cache = {};
const today = new Date().toISOString().slice(0, 10);

async function checkedFetch(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
}

async function loadShard(shard) {
  const response = await checkedFetch(new URL(shard.file, new URL("./data/", import.meta.url)));
  const bytes = new Uint8Array(await response.arrayBuffer());
  const blob = new Blob([bytes]);
  const body = bytes[0] === 31 && bytes[1] === 139
    ? await new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).text()
    : await blob.text();
  const records = JSON.parse(body);
  if (!Array.isArray(records) || records.length !== shard.rows || records.some(row => typeof row[LOOKUP] !== "string")) {
    throw new Error("Search data shard failed validation.");
  }
  return records;
}

async function initialize() {
  const response = await checkedFetch(new URL("./data/manifest.json", import.meta.url));
  const manifest = await response.json();
  if (manifest.version !== 1 || !manifest.records || !Array.isArray(manifest.shards)) {
    throw new Error("The search manifest is invalid.");
  }
  self.postMessage({ type: "metadata", manifest });
  const pieces = [];
  let loaded = 0;
  let next = 0;
  async function load() {
    while (next < manifest.shards.length) {
      const index = next++;
      pieces[index] = await loadShard(manifest.shards[index]);
      loaded += pieces[index].length;
      self.postMessage({ type: "progress", loaded });
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, manifest.shards.length) }, load));
  if (loaded !== manifest.records) throw new Error("The search snapshot is incomplete.");
  rows = pieces.flat();
  ready = true;
  self.postMessage({ type: "ready" });
  if (queued) search(queued);
}

function search(message) {
  const { filters, id, record } = message;
  const key = JSON.stringify(filters);
  if (key !== cache.key) cache = { key, results: findNotes(rows, filters, today) };
  const total = cache.results.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, message.page), pages);
  const first = (page - 1) * pageSize;
  const linked = record?.length === 2 ? rows.find(row => row[ORG] === record[0] && row[REF] === record[1]) : null;
  self.postMessage({
    type: "results", id, total, page, pages,
    rows: cache.results.slice(first, first + pageSize).map(row => row.slice(0, LOOKUP)),
    linked: linked?.slice(0, LOOKUP) ?? null,
  });
}

self.onmessage = ({ data }) => {
  if (data.type !== "search") return;
  if (ready) search(data);
  else queued = data;
};
initialize().catch(error => self.postMessage({ type: "error", message: error.message }));
