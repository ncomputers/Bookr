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

- Create and alter companies, including mailing and contact details.
- Load, change and shut companies independently in each browser tab.
- Revision checks, separate company books and missing-database protection.
- Download a complete company backup and restore it as a separate new company.
- Choose the initial financial-year and books-beginning dates when creating a company.
- Change the working date from Gateway with F2; new vouchers use that date.
- Change the current period from Gateway with Alt+F2, including later years without changing company master dates.
- Ledger creation and alteration with supported account groups and opening balances.
- Sales, purchases, receipts, payments, contra and supported journal entries.
- Save and reopen vouchers, view postings, ledger statements and outstanding bills.
- Trial balance, financial reports and ledger monthly summaries.
- Shared keyboard pickers, date editors, bill allocations and discard dialogs.
- Home shows pending work and preserves unsaved-draft confirmation after failed requests.

In company addresses, Enter starts another line; Enter on an empty final line
moves to State. Shift+Enter inserts a newline without leaving the address.

Amounts use integer paise. A credit sale of ₹1,000 followed by a ₹400 receipt leaves ₹600 outstanding.

New companies support a custom initial financial year, with books beginning within that year. A newly created company starts at its books-beginning date, which also labels its opening balances. Gateway F2 changes the working date within the displayed current period without changing company master dates or saved vouchers. Each browser tab keeps a separate working date for each company; this tab retention is a web convention. In the date dialog, Esc clears the field before a second Esc returns without accepting.

Gateway Alt+F2 changes the current period and moves an out-of-range working date to the nearest period boundary. Voucher entry uses the selected period, and monthly summaries follow it. Other reports retain their displayed All saved/F2 date filters. Period selection is separate for each company in each browser tab; tab retention is a web convention.

F3 changes among loaded companies, Alt+F3 lists all company books, and Ctrl+F3 shuts a loaded company. Company list dates show the initial financial year. Shutting leaves saved books intact. Shutting the last company leaves an empty workspace through reload, where Company Creation and Restore remain available. A fresh load starts at the later of Books and last-entry date, clipped to the retained period; this is Bookr's bounded reopen model. Changing among already loaded companies keeps their working dates. If a company saves successfully but opening it fails, Open Company retries the saved result without saving it again.

Saved company master dates remain read-only. Alteration currently opens the active company; a selector for altering other loaded companies remains. API requests without a selected period retain the existing initial-window and default-company compatibility behavior.

Company Data (Alt+Y) downloads an original Bookr JSON backup covering all saved dates. Restore requires a new company name and preserves saved identities, revisions, postings and bill allocations. It never merges into an existing company. Backups support up to 25 MB and 200,000 rows; a checksum detects corruption and does not authenticate a file. Legacy vouchers dated before Books cannot currently be restored into a new company because their date-edit policy differs.

Configurable currency, company security, wider account groups, tax, inventory and other advanced modules remain unfinished. Opening-bill dates currently use Bookr's earlier-than-books convention; full reference behaviour for historical bill reports is still under investigation.

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
