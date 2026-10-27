# AGENTS.md — Bookr

Bookr is an original, keyboard-first accounting web app (Node 24 + SQLite + plain JS).
Agents (Codex, Claude, etc.) must follow these rules for every change.

## 1. Build order (finish one layer before starting the next)

1. Company layer        — create/alter/load/shut, dates, periods, backup, features (CURRENT)
2. Masters              — all default groups, ledgers, cost centres
3. Vouchers             — multi-line invoices, multi-party journals, debit/credit notes
4. GST / Tax            — GSTIN, tax ledgers, HSN/SAC, CGST/SGST/IGST
5. Inventory            — stock items, units, godowns, item invoices
6. Reports              — GST returns, stock summary, ratios, day book polish
7. Banking              — reconciliation, cheque printing
8. Security / Users     — login, roles, audit trail
9. Print / Export       — invoice PDF, Excel/JSON export

Do not start a later layer while `docs/company-layer.json` (or the current
layer's checklist) says `"complete": false`, unless the user asks.

## 2. Workflow for every feature

1. **Study** — observe the reference app's behavior in the isolated sandbox
   only (screenshots, keystrokes, resulting balances). Fictional data only.
2. **Spec** — write `docs/<feature>.json`: fields, key behavior (Enter/Esc/
   shortcuts), defaults, validation, accounting effect.
3. **Red** — add a failing unit/HTTP test in `tests/`.
4. **Code** — implement the smallest change that passes.
5. **Green** — `npm test` passes.
6. **Browser** — add/update a `*-browser.mjs` test; `npm run test:browser` passes.
7. **Audit** — read-only check against the preview server (port 4780).
8. **Commit** — one feature per commit, tests included.
9. **Update** — mark the item done in the layer checklist and README
   "Current features". Never list planned work as done.

## 3. Hard rules

- **Behavior only, no decompiling.** Never disassemble, decompile or patch the
  reference executable (no Ghidra/IDA/Hopper/Frida on it).
- **Original work only.** No reference-app names, logos, icons, screen text,
  help text or file formats copied into Bookr. Use Bookr's own labels.
- **Fictional data only** in studies, fixtures and tests. Never real books.
- **Protected ports:** 4315 = user's real books, do not stop, reset or test
  against it. 4780 = preview, do not reset or reseed. Browser tests use
  `tests/owned-test-server.mjs` ports only.
- Run the unit and browser test chains **one after the other, not in parallel**.
- Amounts are **integer paise**. No floats in accounting code.
- Never commit `storage/` databases, screenshots or evidence files.

## 4. Housekeeping

- Study files live in `../rea-tools/`. When a feature is committed, move its
  logs/scripts to `../rea-tools/archive/<YYYYMMDD>-<feature>/`.
- Keep commit messages short: "Add <feature>" / "Fix <behavior>".
- If something is unclear about how a behavior should work, stop and ask the
  user instead of guessing.

## 5. Commands

    npm ci                 # install
    npm start              # run on http://localhost:4315
    npm test               # unit + HTTP tests
    npm run test:browser   # browser tests (Edge on Windows)
