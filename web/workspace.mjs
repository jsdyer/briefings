import { REF, EN, FR, DATE, ORG, SECTOR_EN, SECTOR_FR } from './search.mjs';

export function key(row) {
  return JSON.stringify([row[ORG] || '', row[REF] || '', row[EN] || row[FR] || '', row[DATE] || '']);
}

export function readSaved(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    if (!Array.isArray(parsed)) return [];
    const seen = new Set();
    return parsed.filter(row => Array.isArray(row) && row.length >= 11 && row.slice(0, 11).every(v => typeof v === 'string') && !seen.has(key(row)) && seen.add(key(row))).map(row => row.slice(0, 11));
  } catch {
    return [];
  }
}

export function draftFor(rows, org, orgName) {
  const notes = rows.filter(row => row[ORG] === org);
  if (!notes.length) return '';
  const entries = notes.map(row => {
    const values = [row[REF] && `Reference: ${row[REF]}`, (row[EN] || row[FR]) && `Title: ${row[EN] || row[FR]}`, row[DATE] && `Received: ${row[DATE]}`, (row[SECTOR_EN] || row[SECTOR_FR]) && `Sector: ${row[SECTOR_EN] || row[SECTOR_FR]}`].filter(Boolean);
    if (row[ORG] && row[REF]) values.push(`Official listing: https://search.open.canada.ca/briefingt/record/${encodeURIComponent(`${row[ORG]},${row[REF]}`)}`);
    return values.join('\n');
  });
  return [`Under the Access to Information Act, I request electronic copies of the following briefing notes from ${orgName}, including any annexes and attachments that accompanied each note.`, entries.join('\n\n'), 'If any material is withheld, please release the severable portions.'].join('\n\n');
}
