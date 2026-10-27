# Bookr

Bookr is an open-source, standalone accounting web application built with original application code. It uses Node.js, SQLite and a keyboard-oriented browser interface.

The application is a working prototype. Its supported local Company-management
workflow is complete; development proceeds to groups and ledger masters.
The limits and unfinished modules listed below remain explicit.

## Run locally

Requires Node.js **24.15 or newer** and npm.

```sh
npm ci
npm start
```

Open [Bookr](http://localhost:4315). On Windows, `start-bookr.cmd` starts the app using Node.js from your PATH.

Bookr creates its local SQLite data in `storage/`. Company books are separate, and selection belongs to each browser tab. Existing databases are never included in this repository.

## Current features

- Create companies and edit any loaded company's mailing and contact details.
- Edit a separate mobile calling code without changing the number or country.
- Choose India States, UK Regions and a bounded list of countries with the keyboard while preserving existing free-text values.
- Create reusable country and state suggestions without posting accounting entries.
- Use F12 in Company entry to hide contact fields or show the fixed currency format on this browser.
- Use F11 or the Company menu to see available and unfinished Bookr features.
- Load, change and shut companies independently in each browser tab.
- Revision checks, separate company books and missing-database protection.
- Reject conflicting stored company IDs or revisions without rewriting saved settings or books.
- Download a complete company backup and restore it as a separate new company.
- Choose the initial financial-year and books-beginning dates when creating a company.
- Alter saved start dates before financial records exist, using shared review confirmations.
- Configure a company's currency symbol and formal name before financial records exist.
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

For India companies, typing in State filters genuine catalog entries. Unmatched searches show No matches; Enter or Tab stays in the field until a genuine row is available. Enter or Tab accepts
the highlighted choice. Escape clears a search; another Escape requests exit.
Choosing No keeps the blank draft. Shift+Arrow keys retain normal text selection.
UK and United Kingdom use Region with the observed four UK suggestions. With
address-master support, other countries initially offer Not Applicable and any
explicitly created states. Unmatched Enter or Tab stays in the search. Existing
unknown metadata remains in its field and whole-form saving can preserve it
without adding a list option. Older servers retain plain State entry for
countries without a regional catalog. Group and Ledger
pickers share genuine filtering, clamped arrows and clear-then-close Escape.

The State or Region list's Change Country command opens a separate country
search with 31 observed country suggestions plus Not Applicable. Alt+Down
focuses list commands; Enter activates them. A Country-search Escape clears its
query; another Escape or Back returns to a blank State/Region without changing
the accepted country. Choose a country or go back before saving. Direct Country
text entry remains available. Phone codes, currency and dates never follow
country automatically. Create country and Create state actions open a shared
one-name dialog. Creating an address suggestion updates the draft; save the
company separately to retain that mailing choice. Suggestions belong to this
installation and remain available after restart. This catalog scope and its
validation are original Bookr choices. Expanded global discovery remains
unverified.

Amounts use integer paise. A credit sale of ₹1,000 followed by a ₹400 receipt leaves ₹600 outstanding.

New companies support a custom initial financial year, with books beginning within that year. A newly created company starts at its books-beginning date, which also labels its opening balances. Gateway F2 changes the working date within the displayed current period without changing company master dates or saved vouchers. Each browser tab keeps a separate working date for each company; this tab retention is a web convention. In the date dialog, Esc clears the field before a second Esc returns without accepting.

Gateway Alt+F2 changes the current period and moves an out-of-range working date to the nearest period boundary. Voucher entry uses the selected period, and monthly summaries follow it. Other reports retain their displayed All saved/F2 date filters. Period selection is separate for each company in each browser tab; tab retention is a web convention.

F3 changes among loaded companies, Alt+F3 lists all company books, and Ctrl+F3 shuts a loaded company. Company list dates show the initial financial year. Shutting leaves saved books intact. Shutting the last company leaves an empty workspace through reload, where Company Creation and Restore remain available. A fresh load starts at the later of Books and last-entry date, clipped to the retained period; this is Bookr's bounded reopen model. Changing among already loaded companies keeps their working dates. If a company saves successfully but opening it fails, the disabled form shows its saved metadata and target identity while retaining formatted dates. Open Company retries that saved result without saving it again.

Company alteration opens a selector of loaded companies. Editing another company uses its own saved profile and dates while preserving the active books, working date and period. Save and cancel return to that target in the selector. If saving succeeds but refreshing fails, Refresh retries the read without saving again. Start dates are editable only while financial tables are empty. Two shared review confirmations preserve the edited date and focus when No is chosen. Companies with financial records keep read-only dates; no entries or opening balances are rewritten. Already loaded tabs retain their working context, while a fresh tab opening the company starts at its revised Books date. API requests without a selected period retain the existing initial-window and default-company compatibility behavior.

Currency labels belong to each company and follow its entry screens, reports and backups. Label changes require empty financial tables; ordinary contact edits can retain unchanged labels on posted books. Amounts keep Bookr's existing integer-paise storage, 100 units per displayed whole amount, two decimal places and en-IN grouping. Labels do not convert amounts. Fixed cash denominations are available only for the default rupee/INR labels. Unsaved monetary drafts retain their original labels and reject a save if another tab changes them; reopen the entry against the refreshed company before continuing.

The mobile calling code is separate contact metadata. Existing companies without a recorded code remain blank; their number text is preserved. New creation drafts explicitly start with 91. Code entry offers the observed India/UK suggestions and accepts bounded digit strings without claiming a complete dialing catalog or international-number validation. Changing country never replaces a recorded code.

Address suggestions are stored separately from company books. Company backups
retain the saved mailing text but do not include this installation-wide catalog.

Company F12 display options belong to this browser and the selected company.
Hiding contacts preserves their values and skips them during keyboard entry.
The optional currency description shows Bookr's actual fixed format; it does
not change precision or amounts. F11 shows feature availability with optional
additional detail. It does not enable tax, inventory, payroll or security.

Company Data (Alt+Y) downloads an original Bookr version 3 JSON backup covering all saved dates, currency labels and the mobile calling code. Strict version 1 and 2 imports verify their original checksum before adding missing defaults to an internal copy; older files receive an unrecorded calling code. Restore requires a new company name and preserves saved identities, revisions, postings and bill allocations. It never merges into an existing company. Backups support up to 25 MB and 200,000 rows; a checksum detects corruption and does not authenticate a file. Legacy vouchers dated before Books cannot currently be restored into a new company because their date-edit policy differs.

Exchange conversion, configurable precision and numeric locale, changing posted-book currency, company security, wider account groups, tax, inventory and other advanced modules remain unfinished. Opening-bill dates currently use Bookr's earlier-than-books convention; full reference behaviour for historical bill reports is still under investigation.

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

Build related Company fields and workflows together in one development batch.
During coding, run the current feature's relevant test files. Run `npm test`
and then `npm run test:browser` serially at the final batch checkpoint before
committing. Later tax, inventory and security engines remain separate from
supported local company management.

## License

[MIT](LICENSE).
