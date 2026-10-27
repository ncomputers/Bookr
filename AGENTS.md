# AGENTS.md — Bookr

Bookr is an original, keyboard-first accounting web app (Node 24 + SQLite + plain JS).
Agents (Codex, Claude, etc.) must follow these rules for every change.

## 0. Development pace (user direction)

This is an active development prototype, not a production-release exercise.
Deliver complete working workflows quickly, then improve them in useful steps.

For the remaining Company layer, implement the remaining fields and features as
one development batch, not one field per commit. While coding, run only the
current feature's relevant test files. Run the full `npm test` and then
`npm run test:browser` serially once at the very end of the completed batch,
before its commit. Do not start a full run after each component. Fix failures
with targeted checks and repeat broader checks only when the fix requires it.

- Group related fields, screens and behavior into one coherent workflow. Do not
  make every small field a separate release with a complete regression cycle.
- Study the actual reference workflow first, then reproduce its observed entry,
  keyboard navigation, lists, focus and accounting behavior with original code.
  Do not design a replacement from assumptions when the behavior can be observed.
- Reuse existing controls, pickers, dialogs, binders, accounting helpers and test
  fixtures. Avoid duplicate implementations and new release/proof machinery for
  ordinary development changes.
- Use focused tests while building. Defer optional rare-error hardening,
  production infrastructure and unrelated cleanup until requested or necessary
  to prevent a demonstrated accounting/data-loss problem.
- Use parallel agents when useful: give them separate implementation/review
  responsibilities and coordinate testing. Do not leave all agents waiting for
  the same test run when independent coding or review can continue.
- Continue authorized work without asking for approval after every small step.
  Keep updates concise and distinguish working, in progress and unverified work.

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

## 2. Workflow for each complete development flow

1. **Study** — observe the reference app's behavior in the isolated sandbox
   only (screenshots, keystrokes, resulting balances). Fictional data only.
2. **Spec** — keep `docs/<feature>.json` concise: fields, Enter/Esc/shortcuts,
   defaults, validation and accounting effect. Separate observations from original
   web conventions and unknown behavior; reuse existing study evidence.
3. **Red** — add meaningful failing tests for the new logic before implementation.
   Record actual failures honestly; do not count cases blocked by a missing module
   as executed failures. Test compatibility corrections need no separate ceremony.
4. **Code** — implement the complete flow using reusable components. Keep related
   backend and UI work moving in parallel without conflicting edits.
5. **Focused green** — run the affected unit/HTTP tests and relevant owned-browser
   scenarios. Check balanced entries, saved/reopened data, keyboard behavior and
   accounting reports where affected. Do not rerun unrelated suites for each field.
6. **Screen check** — inspect the actual resulting screens and compare the relevant
   reference screenshots, field focus, lists and dialogs. A responsive screenshot
   alone is not workflow verification. Do not claim exact visual parity without
   a valid comparison.
7. **Preview** — check the completed flow read-only on port 4780. Preserve existing
   preview data; reuse existing audit tooling rather than rebuilding it each time.
8. **Commit** — commit one coherent working flow with its tests. Do not describe
   focused checks as a full-suite pass. Documentation-only changes need no
   accounting or browser test rerun.
9. **Update** — mark only working items done in the layer checklist and README
   "Current features". Never list planned work as done.

Run `npm test` and `npm run test:browser` at layer/integration checkpoints,
before declaring a layer complete, or when changes to the shared posting/balance
engine, storage schema or unresolved failures justify broader checks. Batch these
full runs; do not repeat them after every minor development change or on unchanged
code that already passed. CI may run full unit checks after a push while other
development continues; monitor and fix failures.

## 3. Hard rules

- **Behavior only, no decompiling.** Never disassemble, decompile or patch the
  reference executable (no Ghidra/IDA/Hopper/Frida on it).
- **Original work only.** No reference-app names, logos, icons, screen text,
  help text or file formats copied into Bookr. Use Bookr's own labels.
- **Fictional data only** in studies, fixtures and tests. Never real books.
- **Protected ports:** 4315 = user's real books, do not stop, reset or test
  against it. 4780 = preview, do not reset or reseed. Browser tests use
  `tests/owned-test-server.mjs` ports only.
- Run a validation's unit/HTTP checks before its browser chain. Coordinate one
  local test lane by default; never overlap browser suites on shared data/ports.
  Other agents should continue independent editing or read-only review.
- Amounts are **integer paise**. No floats in accounting code.
- Never commit `storage/` databases, screenshots or evidence files.

## 4. Housekeeping

- Study files live in `../rea-tools/`. When a feature is committed, move its
  logs/scripts to `../rea-tools/archive/<YYYYMMDD>-<feature>/`.
- Keep commit messages short: "Add <feature>" / "Fix <behavior>".
- If behavior is unclear, consult existing evidence or study the fictional
  reference flow first. Mark unverified details pending and continue known work;
  never invent accounting rules. Ask the user only when a required decision
  genuinely blocks authorized progress.

## 5. Commands

    npm ci                 # install
    npm start              # run on http://localhost:4315
    npm test               # unit + HTTP tests
    npm run test:browser   # browser tests (Edge on Windows)
