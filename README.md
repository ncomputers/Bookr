# Bookr

Bookr is an open-source, standalone accounting web application built with original application code. It uses Node.js, SQLite and a keyboard-oriented browser interface.

The application is a working prototype. Development currently focuses on completing the company layer before expanding the remaining accounting modules.

## Run locally

Requires Node.js **24.15 or newer** and npm.

```sh
npm ci
npm start
```

Open [Bookr](http://localhost:4315). On Windows, `start-bookr.cmd` starts the app using Node.js from your PATH.

Bookr creates its local SQLite data in `storage/`. Company books are separate, and selection belongs to each browser tab. Existing databases are never included in this repository.

## Current features

- Create, select and alter companies, including mailing and contact details.
- Revision checks, separate company books and missing-database protection.
- Ledger creation and alteration with supported account groups and opening balances.
- Sales, purchases, receipts, payments, contra and supported journal entries.
- Save and reopen vouchers, view postings, ledger statements and outstanding bills.
- Trial balance, financial reports and ledger monthly summaries.
- Shared keyboard pickers, date editors, bill allocations and discard dialogs.

Amounts use integer paise. A credit sale of ₹1,000 followed by a ₹400 receipt leaves ₹600 outstanding.

The supported company year is currently **1 April 2026–31 March 2027**. Custom company dates, configurable currency, company security, public backup/restore, wider account groups, tax, inventory and other advanced modules remain unfinished. Some legacy default-book date behavior also requires further company-layer work.

## Tests

```sh
npm test
npm run test:browser
```

Browser tests use disposable fictional books. On Windows they use Microsoft Edge by default. To use an installed Chromium-compatible browser elsewhere, set `BOOKR_BROWSER_PATH` to its executable before running the browser tests. Generated screenshots and test evidence stay local and are ignored by Git.

## Configuration

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port; default `4315` |
| `BOOKR_DB` | Local default-company database path |
| `BOOKR_TAILSCALE_IP` | Optional address on your own tailnet |
| `BOOKR_BROWSER_PATH` | Browser executable for automated UI tests |

## Development

Work proceeds one layer at a time: company management, groups and ledgers, vouchers, then reports. Each change is backed by observed behavior, focused tests and relevant screen checks. Planned features are not counted as completed features.

## License

[MIT](LICENSE).
