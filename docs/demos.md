# Demonstrations

## Reproducible mocked partial failure and recovery

This is a separate, explicitly synthetic demo. It starts the real API, collector,
comparison logic, SQLite store and built React UI. Only GitLab HTTP responses are
mocked on localhost. It does not load `.env`, use your token, access GitLab.com, or
open your normal database. A temporary database is deleted when the demo exits.
You may leave the normal application running; this demo uses an available random port.

```bash
npm ci
npm run build
npm run demo:mock
```

1. Open the **exact local URL printed by the demo**, rather than port 3001. The project
   IDs are **1, 2, 3**, with synthetic names/links. Those are fixture IDs, not live IDs.
2. A complete baseline already exists for protected, unprotected and empty repositories.
   The mock is now configured to deny project 1's protected-branches endpoint with 403.
3. Click **Start collection**. Inspect project 1: it is partial, its branch still reports
   protected, and configuration is unreadable. Projects 2 and 3 complete successfully.
   Open sources/errors to show the denied request, and the historical last-complete
   evidence panel. The comparison is incomplete; no removed setting is invented.
4. In the **same terminal running the demo**, type `recover` and press Enter. This changes
   the mock's responses; it does not retry or rewrite the failed observation.
5. In the UI, click **Start collection** to collect all three again. Project 1 now completes
   and compares with its last complete baseline, skipping the partial attempt. It has
   unchanged settings. Other projects can use their complete result from the partial run.
6. Open the partial run in history: it remains partial with its original error and baseline.
7. Type `quit` in the demo terminal to stop and delete its temporary database. To repeat,
   rerun the command. `fail` re-enables the same 403; `status` prints the current mode.
   Mode changes are refused during an active run. Ctrl+C also stops the demo.

No real outages or rate limits are induced. The fixture's permission denial is
illustrative; a real 403 requires checking token scope, account access and provider
permissions before recollecting. Its synthetic HTTPS source links identify the API
shape being exercised; they are not proof of a request to GitLab.com.

### Credential-free evidence check

```bash
npm run demo:verify
```

This executes complete -> partial 403 -> recovery through the actual HTTP API and
asserts outcomes, fixed per-project baselines, no fabricated removals, retained useful
branch evidence, and unchanged history. It writes clearly labeled synthetic JSON to
`artifacts/mock-demo.json`. It needs no browser or UI build. A generated example is
included in [demo-mocked-evidence.json](demo-mocked-evidence.json); regenerate it with
`npm run demo:verify -- docs/demo-mocked-evidence.json` if desired.

The optional automated browser check is `npm run test:ui` after
`npx playwright install chromium` and `npm run build`. It drives the real backend and
mocked GitLab HTTP through the UI, including success, partial failure and recovery.
See frontend.md. Automated checks and this interactive demo serve different purposes.

## Live GitLab UI walkthrough (about 3–5 minutes)

The screen recording linked from the README follows this walkthrough on the normal
server and the seeded project IDs, not the mock. Live collection of the three project
states and force-push changes in both directions was checked on the seeded account.

**Screen recording:** [GitLab evidence collection and mocked failure recovery](https://drive.google.com/file/d/1-kZmV2F_UDa1GbOhmmycZU1QuiJUWBiC/view?usp=drive_link)

1. Run `npm run build`, `npm start`; open http://127.0.0.1:3001. Show the saved three
   project IDs and collect. Open each result: protected restrictions, successful empty
   rules for unprotected, and no default branch for the empty repository.
2. Open the protected result's sources and note the collection time and run ID. A run
   that finishes executing can still contain partial results; show the individual states.
3. In GitLab, manually change **Allow force push** for the protected default branch.
   This is a seed-project administration action; the application remains read-only.
4. Return to the application, collect again, and show the protected project's exact
   before/after change and the baseline run ID. Other projects should be unchanged.
5. Refresh during a collection to demonstrate reconnecting to the same run. Open an
   earlier run and show that its original observation/comparison remains intact.
6. Restore the force-push setting in GitLab, collect once more, and show the reverse
   change. Finish with the protected project's original setting restored.

### Capture and sanitization

The published recording shows the three project outcomes, the changed field with
baseline and time, and evidence/source detail. It is limited to the app and synthetic
test settings. It does not include `.env`, PAT pages, terminal environment variables,
unrelated tabs, account menus, personal email, or private non-test projects. No media
files are stored in this repository.

**Live media:** [screen recording](https://drive.google.com/file/d/1-kZmV2F_UDa1GbOhmmycZU1QuiJUWBiC/view?usp=drive_link),
also linked from the README. Live validation notes are in test-projects.md. Do not
substitute the included mocked JSON for the live portion of the recording.
