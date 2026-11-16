import test from "node:test";
import assert from "node:assert/strict";
import { findNotes, normalize, REF, dateAnomaly } from "../web/search.mjs";

function row(ref, en, fr, date, action, org, sector = "", comments = "") {
  return [ref, en, fr, sector, "", "D", date, action, comments, "", org,
    " " + [ref, en, fr, sector, comments, org].map(normalize).join(" | ") + " "];
}

const today = "2026-11-16";
const rows = [
  row("2023FIN020068", "Real-Time Rail Payment System", "Système de paiement en temps réel", "2023-06-19", "I", "fin"),
  row("FIN-2", "Rail operations and safety", "Opérations ferroviaires", "2024-08-31", "D", "fin", "Economic Policy", "Records about digital identity"),
  row("TC-8", "Rail scheduling in real time", "Horaires ferroviaires", "2024-03-16", "I", "tc"),
  row("FIN-3", "Rail schedules", "", "2027-01-04", "I", "fin"),
  row("FIN-4", "Environmental regulation", "Évaluation environnementale", "", "I", "fin"),
  row("OPS-0", "Time", "Rail", "2024-10-01", "S", "tc"),
];
const refs = filters => findNotes(rows, filters, today).map(row => row[REF]);

test("finds accent-insensitive bilingual titles and prefixes", () => {
  assert.deepEqual(refs({ query: "systeme de paiement" }), ["2023FIN020068"]);
  assert.deepEqual(refs({ query: "environnement" }), ["FIN-4"]);
  assert.deepEqual(refs({ query: "2023fin0200" }), ["2023FIN020068"]);
});

test("quotes preserve phrase order and prevent matches across fields", () => {
  assert.deepEqual(refs({ query: '"real-time rail"' }), ["2023FIN020068"]);
  assert.deepEqual(refs({ query: '"time rail"' }), ["2023FIN020068"]);
  assert.deepEqual(refs({ query: 'rail -"real time" -operations -schedules' }), ["OPS-0"]);
});

test("uses all filters and allows searching sectors and public comments", () => {
  assert.deepEqual(refs({ query: "economic policy digital identity", institution: "fin", from: "2024-01-01", to: "2024-12-31", action: "D" }), ["FIN-2"]);
  assert.deepEqual(refs({ query: "economic policy digital identity", institution: "tc" }), []);
  assert.deepEqual(refs({ query: "environnement", from: "2020-01-01" }), []);
});

test("places unusual and unavailable dates after normal dates", () => {
  assert.equal(dateAnomaly("2027-01-04", today), true);
  assert.equal(dateAnomaly("", today), false);
  assert.deepEqual(refs({ sort: "oldest" }), ["2023FIN020068", "TC-8", "FIN-2", "OPS-0", "FIN-3", "FIN-4"]);
});
