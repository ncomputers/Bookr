import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Book } from '../lib/accounting.mjs';

test('Funds Flow Statement calculations and month drilldown', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bookr-funds-flow-test-'));
  const dbPath = join(dir, 'test.db');
  const book = new Book(dbPath);

  t.after(async () => {
    book.close();
    await rm(dir, { recursive: true, force: true });
  });

  const salesAccount = book.ledgers().find(l => l.kind === 'sales').id;
  const purchaseAccount = book.ledgers().find(l => l.kind === 'purchase').id;
  const customer = book.createCustomer({ name: 'Demo Client', state: 'Delhi' });
  const supplier = book.saveSupplier({ name: 'Raw Material Supplier', state: 'Delhi' });
  const bank = book.saveBank({ name: 'State Bank', bank: { account_number: 'SB-001' } });
  const capital = book.saveAccount({ name: 'Owner Capital', kind: 'capital' });

  // 1. Capital introduced into Bank: 10,000.00
  book.saveVoucher({
    type: 'receipt',
    date: '2026-04-01',
    ledger_id: capital.id,
    account_id: bank.id,
    amount: 1000000,
    details: {
      bank: {
        account_id: bank.id,
        transaction_type: 'Cheque/DD',
        amount: 1000000,
        instrument_number: '100001',
        instrument_date: '2026-04-01',
        bank_name: 'State Bank',
        cheque_range: ''
      }
    }
  });

  // 2. Sale to customer: 5,000.00 on 2026-04-05
  const saleVch = book.saveVoucher({
    type: 'sale',
    number: 'INV-01',
    date: '2026-04-05',
    customer_id: customer.id,
    account_id: salesAccount,
    amount: 500000
  });

  // 3. Receipt from customer into bank: 3,000.00 on 2026-04-10
  const bill = book.billBalances(customer.id)[0];
  book.saveVoucher({
    type: 'receipt',
    number: 'REC-01',
    date: '2026-04-10',
    customer_id: customer.id,
    account_id: bank.id,
    amount: 300000,
    allocations: [{ bill_id: bill.bill_id, amount: 300000 }],
    details: {
      bank: {
        account_id: bank.id,
        transaction_type: 'Cheque/DD',
        amount: 300000,
        instrument_number: '100002',
        instrument_date: '2026-04-10',
        bank_name: 'State Bank',
        cheque_range: ''
      }
    }
  });

  // 4. Purchase from supplier: 2,000.00 on 2026-04-15
  book.saveVoucher({
    type: 'purchase',
    date: '2026-04-15',
    supplier_id: supplier.id,
    account_id: purchaseAccount,
    amount: 200000
  });

  // Test monthly Funds Flow summary
  const summary = book.fundsFlow();
  assert.equal(summary.months.length, 12, 'Funds flow summary covers all 12 months');

  const april = summary.months[0];
  assert.equal(april.month, '2026-04');
  assert.equal(april.name, 'April');
  assert.equal(april.opening, 0, 'Opening WC before April is 0');

  // At end of April:
  // Bank = 10,000 + 3,000 = 13,000
  // Debtors = 5,000 - 3,000 = 2,000
  // Total Current Assets = 15,000
  // Creditors = 2,000
  // Total Current Liabilities = 2,000
  // Closing WC = 15,000 - 2,000 = 13,000
  assert.equal(april.closing, 1300000, 'Closing WC is 13,000');
  assert.equal(april.funds_flow, 1300000, 'Funds flow increase is 13,000');

  // Test April Drilldown
  const aprilDrilldown = book.fundsFlow({ month: '2026-04' });
  assert.ok(aprilDrilldown.drilldown, 'Drilldown details present');
  const dd = aprilDrilldown.drilldown;

  // Verify Sources and Applications
  assert.equal(dd.totals.balanced, true, 'Sources and Applications balance exactly');
  const opsProfit = dd.sources.find(s => s.particular.includes('Nett Profit'));
  assert.ok(opsProfit, 'Nett profit is listed under Sources');
  assert.equal(opsProfit.amount, 300000, 'Operations profit is 3,000 (5,000 sales - 2,000 purchase)');

  const capSource = dd.sources.find(s => s.particular.includes('Capital Account'));
  assert.ok(capSource, 'Capital addition is listed under Sources');
  assert.equal(capSource.amount, 1000000, 'Capital introduced is 10,000');

  const balancingApp = dd.applications.find(a => a.particular.includes('Increase in Working Capital'));
  assert.ok(balancingApp, 'Increase in Working Capital balances the statement');
  assert.equal(balancingApp.amount, 1300000);

  // Verify Working Capital Movement
  const wcm = dd.working_capital_movement;
  assert.equal(wcm.current_assets.opening, 0);
  assert.equal(wcm.current_assets.closing, 1500000);
  assert.equal(wcm.current_assets.change, 1500000);

  assert.equal(wcm.current_liabilities.opening, 0);
  assert.equal(wcm.current_liabilities.closing, 200000);
  assert.equal(wcm.current_liabilities.change, -200000);

  assert.equal(wcm.working_capital.net_change, 1300000);
});

test('Negative Ledgers exception report detects abnormal balances', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bookr-neg-ledgers-test-'));
  const dbPath = join(dir, 'test.db');
  const book = new Book(dbPath);

  t.after(async () => {
    book.close();
    await rm(dir, { recursive: true, force: true });
  });

  // Normal credit account (Capital) with a DEBIT balance:
  const owner = book.saveLedger({ name: 'Study Owner', group_name: 'Capital Account', kind: 'capital', opening_balance: 20000 }); // 200 Dr!
  // Normal debit account (Bank) with a CREDIT balance (overdrawn):
  const bank = book.saveBank({ name: 'Overdrawn Bank', group_name: 'Bank Accounts', kind: 'bank', opening_balance: -50000 }); // 500 Cr!
  // Normal debit account (Petty Cash) with normal debit balance (should NOT appear in negative ledgers):
  const pettyCash = book.saveLedger({ name: 'Petty Cash', group_name: 'Cash-in-Hand', kind: 'cash', opening_balance: 100000 }); // 1,000 Dr

  const report = book.negativeLedgers();
  assert.equal(report.rows.length, 2, 'Detects both abnormal ledgers');

  const studyOwner = report.rows.find(r => r.name === 'Study Owner');
  assert.ok(studyOwner, 'Study Owner detected');
  assert.equal(studyOwner.debit, 20000);
  assert.equal(studyOwner.side, 'Dr');

  const overdrawnBank = report.rows.find(r => r.name === 'Overdrawn Bank');
  assert.ok(overdrawnBank, 'Overdrawn Bank detected');
  assert.equal(overdrawnBank.credit, 50000);
  assert.equal(overdrawnBank.side, 'Cr');

  assert.equal(report.totals.debit, 20000);
  assert.equal(report.totals.credit, 50000);
});

test('Overdue Bills exception report filters bills by due date and calculates overdue days', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bookr-overdue-bills-test-'));
  const dbPath = join(dir, 'test.db');
  const book = new Book(dbPath);

  t.after(async () => {
    book.close();
    await rm(dir, { recursive: true, force: true });
  });

  const customer = book.createCustomer({ name: 'Late Customer', state: 'Delhi' });
  const salesAccount = book.ledgers().find(l => l.kind === 'sales').id;

  // Bill 1: Date 2026-04-01
  const v1 = book.saveVoucher({
    type: 'sale',
    date: '2026-04-01',
    customer_id: customer.id,
    account_id: salesAccount,
    amount: 100000
  });

  // Bill 2: Date 2026-04-25
  const v2 = book.saveVoucher({
    type: 'sale',
    date: '2026-04-25',
    customer_id: customer.id,
    account_id: salesAccount,
    amount: 200000
  });

  // Query overdue as of 2026-04-15:
  // Bill 1 (date 2026-04-01 <= 2026-04-15) is overdue by 14 days!
  // Bill 2 (date 2026-04-25 > 2026-04-15) is not yet due/not in this cutoff.
  const overdueReport = book.overdueBills('receivable', { asOf: '2026-04-15' });
  assert.ok(overdueReport.rows.length >= 1, 'Found overdue bill');
  const b1 = overdueReport.rows.find(r => r.id === v1.id);
  assert.ok(b1, 'v1 is in overdue list');
  assert.equal(b1.overdue_days, 14, 'Overdue days is exactly 14');
  assert.equal(b1.pending, 100000);

  const b2 = overdueReport.rows.find(r => r.id === v2.id);
  assert.equal(b2, undefined, 'Future bill is not overdue');
});
