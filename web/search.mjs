export const [REF, EN, FR, SECTOR_EN, SECTOR_FR, ADDRESSEE, DATE, ACTION, COMMENTS_EN, COMMENTS_FR, ORG, LOOKUP] =
  Array.from({ length: 12 }, (_, index) => index);
export const pageSize = 16;

export function normalize(value) {
  return value.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function queryTerms(query) {
  const tokens = Array.from(query.replace(/[“”]/g, '"')
    .matchAll(/(^|\s)([-−]?)("([^"]*)"?|[^\s"]+)/g));
  return tokens.flatMap((token, index) => {
    const phrase = token[3].startsWith('"');
    const normalized = normalize(token[4] ?? token[3]);
    if (!normalized) return [];
    const words = phrase ? [normalized] : normalized.split(" ");
    return words.map((value, part) => ({
      value,
      exclude: Boolean(token[2]),
      prefix: !phrase && !token[2] && index === tokens.length - 1 && part === words.length - 1,
    }));
  });
}

function contains(haystack, term) {
  return haystack.includes(` ${term.value}${term.prefix ? "" : " "}`);
}

export function dateAnomaly(value, today) {
  return Boolean(value && (value < "2019-01-01" || value > today));
}

function dateRank(value, today) {
  if (!value) return 2;
  return dateAnomaly(value, today) ? 1 : 0;
}

export function findNotes(rows, filters, today) {
  const { query = "", institution = "", from = "", to = "", action = "", sort = "relevance" } = filters;
  const terms = queryTerms(query);
  const positives = terms.filter(term => !term.exclude);
  const key = normalize(query.replace(/(^|\s)[-−]("[^"]*"?|\S+)/g, " "));
  const matches = [];
  for (const row of rows) {
    if ((institution && row[ORG] !== institution) || (action && row[ACTION] !== action)) continue;
    if ((from || to) && (!row[DATE] || (from && row[DATE] < from) || (to && row[DATE] > to))) continue;
    if (!terms.every(term => contains(row[LOOKUP], term) !== term.exclude)) continue;
    let score = 0;
    if (sort === "relevance" && key) {
      const title = ` ${normalize(row[EN])} | ${normalize(row[FR])} `;
      const ref = normalize(row[REF]);
      if (ref === key) score += 100;
      else if (ref.startsWith(key)) score += 16;
      if (title.includes(` ${key} `)) score += 12;
      score += positives.filter(term => contains(title, term)).length * 3;
    }
    matches.push({ row, score });
  }
  matches.sort((a, b) => {
    const rank = b.score - a.score || dateRank(a.row[DATE], today) - dateRank(b.row[DATE], today);
    if (rank) return rank;
    return sort === "oldest" ? a.row[DATE].localeCompare(b.row[DATE]) : b.row[DATE].localeCompare(a.row[DATE]);
  });
  return matches.map(item => item.row);
}
