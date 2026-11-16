# The Briefing Room

Search the Government of Canada's published briefing note titles and numbers. Filter by institution, date received, or action, and use a selected note to prepare a focused access-to-information request.

[Open the app](https://coolcode.ca/briefings/) · [ATIP Explorer](https://coolcode.ca/atip/) · [Official briefing register](https://search.open.canada.ca/briefingt/)

## Search and request records

- Search English and French titles, reference numbers, originating sectors, institutions, and published comments. Quotes keep a phrase together, a leading minus excludes a term, and the last unquoted word matches as you type.
- Open a result for the original government listing, a direct link to search its reference in ATIP Explorer, and a broader topic search. A match in ATIP Explorer can point to an earlier release. For example, Finance briefing `2023FIN020068` appears in completed ATI request `A-2023-00739`.
- The editable draft includes the institution, note reference, title, reported date, and a link to the official metadata. Copy it into the federal ATIP portal when ready.
- This register contains titles and published metadata. It does not contain the briefing note documents. Titles may be redacted, and some briefings are outside the published listing.
- The build keeps records with missing fields and flags received dates before 2019 or after the current day for verification.

## Data and reuse

The Treasury Board of Canada Secretariat publishes the [Briefing Note Titles and Numbers dataset](https://open.canada.ca/data/en/dataset/ee9bd7e8-90a5-45db-9287-85c8cf3589b6), including a [bilingual bulk CSV](https://open.canada.ca/data/dataset/ee9bd7e8-90a5-45db-9287-85c8cf3589b6/resource/299a2e26-5103-4a49-ac3a-53db9fcc06c7/download/briefingt.csv) and [data schema](https://open.canada.ca/data/recombinant-published-schema/briefingt.json). Updating the local snapshot does not change the upstream publication schedule.

Contains information licensed under the [Open Government Licence – Canada](https://open.canada.ca/en/open-government-licence-canada). CoolCode is an independent presentation of the government information.

## Build and deploy

```sh
python3 scripts/build.py
python3 -m http.server 8080 --directory dist
```

Python 3.9+ standard library is sufficient. To build offline, download the official bulk CSV and run `python3 scripts/build.py --csv /path/to/briefingt.csv`. The optional offline mode cannot determine the publisher's update date.

The builder checks the CSV columns, preserves both official languages, and makes compressed search files grouped by year. The generated `dist/data/manifest.json` carries the source URL, publisher's update date when available, build timestamp, coverage, record counts and CSV SHA-256. The preview server is for local development. On GitHub Pages the app runs entirely in a modern browser with JavaScript modules, Web Workers and gzip decompression support.

**GitHub Pages refresh:** the workflow in `.github/workflows/pages.yml` downloads the official CSV and rebuilds the site daily, on app source changes, and when started manually in the Actions tab. Select **GitHub Actions** as the Pages publishing source. The deployed Pages artifact contains `dist/`, including the public compressed data. The workflow does not add the CSV or build outputs to Git. If an upstream download or import fails, the deployment job is skipped and the previous published snapshot remains available.

Pages assets resolve relative to `/briefings/`. The existing account site's CoolCode.ca domain covers the project site. A project-specific custom domain is unnecessary.

Run targeted search checks with `node --test tests/search.test.mjs`.
