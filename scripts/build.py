#!/usr/bin/env python3
"""Build a static, searchable snapshot of the federal briefing note register."""
import argparse
from collections import Counter, defaultdict
import csv
from datetime import date, datetime, timezone
from email.utils import parsedate_to_datetime
import gzip
import hashlib
import json
from pathlib import Path
import re
import shutil
import sys
import tempfile
from time import sleep
import unicodedata
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
DATASET_ID = "ee9bd7e8-90a5-45db-9287-85c8cf3589b6"
RESOURCE_ID = "299a2e26-5103-4a49-ac3a-53db9fcc06c7"
CATALOG = f"https://open.canada.ca/data/en/dataset/{DATASET_ID}"
SOURCE = f"https://open.canada.ca/data/dataset/{DATASET_ID}/resource/{RESOURCE_ID}/download/briefingt.csv"
METADATA = f"https://open.canada.ca/data/api/3/action/package_show?id={DATASET_ID}"
FIELDS = (
    "tracking_number", "title_en", "title_fr", "originating_sector_en",
    "originating_sector_fr", "addressee", "date_received", "action_required",
    "additional_information_en", "additional_information_fr", "owner_org",
    "owner_org_title",
)


def download(path):
    for attempt in range(3):
        try:
            request = Request(SOURCE, headers={"User-Agent": "CoolCodeBriefings/1.0"})
            with urlopen(request, timeout=45) as response, path.open("wb") as handle:
                if response.headers.get_content_type() == "text/html":
                    raise ValueError("The CSV endpoint sent an HTML page.")
                shutil.copyfileobj(response, handle)
                expected = response.headers.get("Content-Length")
                if expected and handle.tell() != int(expected):
                    raise ValueError("The CSV download was incomplete.")
                modified = response.headers.get("Last-Modified")
                return parsedate_to_datetime(modified).date().isoformat() if modified else None
        except (OSError, ValueError) as error:
            if attempt == 2:
                raise RuntimeError(f"Official CSV download failed after three attempts: {error}") from error
            print(f"Download failed, retrying ({attempt + 1}/2): {error}", file=sys.stderr)
            sleep(2 ** (attempt + 1))


def official_updated(fallback):
    try:
        with urlopen(METADATA, timeout=15) as response:
            resources = json.load(response)["result"]["resources"]
        resource = next(item for item in resources if item["id"] == RESOURCE_ID)
        modified = resource.get("last_modified")
        return date.fromisoformat(modified[:10]).isoformat() if modified else fallback
    except (OSError, ValueError, KeyError, StopIteration) as error:
        print(f"Official catalog date unavailable: {error}", file=sys.stderr)
        return fallback


def clean(value):
    return re.sub(r"\s+", " ", value or "").strip()


def normalize(value):
    value = "".join(c for c in unicodedata.normalize("NFKD", value.lower()) if not unicodedata.combining(c))
    return " ".join(re.sub(r"[^\w]+|_", " ", value).split())


def read_rows(path):
    organizations = {}
    dates = Counter()
    records = []
    invalid_date = 0
    seen = set()
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames or set(FIELDS).difference(reader.fieldnames):
            raise ValueError("Bulk CSV is missing expected briefing register columns.")
        for row in reader:
            if None in row or any(row.get(field) is None for field in FIELDS):
                raise ValueError(f"Malformed CSV row near line {reader.line_num}.")
            ref, en, fr, sector_en, sector_fr, addressee, received, action, extra_en, extra_fr, org, org_title = [
                clean(row[field]) for field in FIELDS
            ]
            if not any((ref, en, fr, received, org, org_title)):
                continue
            entry = (ref, en, fr, sector_en, sector_fr, addressee, received, action, extra_en, extra_fr, org)
            if entry in seen:
                continue
            seen.add(entry)
            try:
                if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", received):
                    raise ValueError("Expected YYYY-MM-DD")
                date.fromisoformat(received)
            except ValueError:
                invalid_date += bool(received)
                received = ""
            if received:
                dates[received[:4]] += 1
            organization = org_title.partition("|")[0].strip()
            if org not in organizations or (org and organization and organizations[org] == org):
                organizations[org] = organization or org or "Institution unavailable"
            lookup = " " + " | ".join(normalize(field) for field in (
                ref, en, fr, sector_en, sector_fr, extra_en, extra_fr, org, organization
            ) if field) + " "
            records.append([ref, en, fr, sector_en, sector_fr, addressee, received, action, extra_en, extra_fr, org, lookup])
    if not records:
        raise ValueError("CSV contains no briefing note rows.")
    records.sort(key=lambda row: row[6], reverse=True)
    return records, organizations, dates, invalid_date


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def build(csv_path, output, source_updated):
    records, institutions, years, invalid_dates = read_rows(csv_path)
    with csv_path.open("rb") as handle:
        digest = hashlib.sha256()
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    groups = defaultdict(list)
    for row in records:
        groups[row[6][:4] or "undated"].append(row)
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="briefings-build-", dir=output.parent) as temporary:
        staged = Path(temporary) / "site"
        shutil.copytree(ROOT / "web", staged)
        data = staged / "data"
        data.mkdir()
        shards = []
        for index, (year, rows) in enumerate(groups.items(), 1):
            name = f"notes-{index:02d}.json.gz"
            payload = json.dumps(rows, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            (data / name).write_bytes(gzip.compress(payload, compresslevel=6, mtime=0))
            shards.append({"file": name, "rows": len(rows), "year": year})
        write_json(data / "manifest.json", {
            "version": 1, "records": len(records), "institutions": institutions, "years": dict(years),
            "undated": len(groups.get("undated", [])), "invalidDates": invalid_dates,
            "sourceUpdated": source_updated, "snapshotBuilt": datetime.now(timezone.utc).isoformat(),
            "source": SOURCE, "catalog": CATALOG, "sourceSha256": digest.hexdigest(),
            "shards": shards,
        })
        if output.exists():
            shutil.rmtree(output)
        staged.replace(output)
    size = sum(item.stat().st_size for item in (output / "data").glob("*.gz"))
    print(f"{len(records):,} briefing notes · {len(institutions):,} institutions · {len(shards)} shards · {size / 2**20:.1f} MiB compressed")
    if invalid_dates:
        print(f"Preserved {invalid_dates} records with invalid dates as undated.", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, help="Use a local copy of the official full CSV")
    parser.add_argument("--output", type=Path, default=ROOT / "dist")
    args = parser.parse_args()
    output = args.output.resolve()
    if output == ROOT or output in ROOT.parents or output in (ROOT / "web").parents or output == ROOT / "web":
        parser.error("Use a dedicated output directory outside the source tree's web directory.")
    if output.exists() and (not output.is_dir() or (any(output.iterdir()) and not (output / "data" / "manifest.json").is_file())):
        parser.error("Refusing to replace an output that does not look like a previous build.")
    if args.csv and args.csv.resolve().is_relative_to(output):
        parser.error("Place the input CSV outside the output directory.")
    try:
        if args.csv:
            build(args.csv.resolve(), output, None)
        else:
            with tempfile.TemporaryDirectory(prefix="briefings-source-") as temporary:
                csv_path = Path(temporary) / "briefingt.csv"
                modified = download(csv_path)
                build(csv_path, output, official_updated(modified))
    except (RuntimeError, OSError, ValueError, csv.Error) as error:
        parser.exit(1, f"Build failed: {error}\n")


if __name__ == "__main__":
    main()
