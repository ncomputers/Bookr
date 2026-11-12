import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Book} from '../lib/accounting.mjs';

function createFinancialDataFixture(book) {
  const customer = book.createCustomer({name: 'Demo Customer'});
  const supplier = book.saveSupplier({name: 'Demo Supplier'});
  const salesAccount = book.ledgers().find(l => l.kind === 'sales').id;
  const purchaseAccount = book.ledgers().find(l => l.kind === 'purchase').id;
  const expense = book.saveAccount({name: 'Office Tea Expense', kind: 'expense'});
  const bank = book.saveBank({name: 'HDFC Bank', bank: {account_number: '123456'}});

  const bankAlloc = (type, amount, date) => ({
    account_id: bank.id,
    transaction_type: type === 'payment' ? 'Cheque' : 'Cheque/DD',
    amount,
    instrument_number: '100001',
    instrument_date: date,
    bank_name: 'Not Applicable',
    cheque_range: type === 'payment' ? 'Not Applicable' : ''
  });

  // 1. Capital funding receipt into Bank: 50,000.00
  const capital = book.saveAccount({name: 'Owner Capital', kind: 'capital'});
  book.saveVoucher({
    type: 'receipt',
    date: '2026-04-01',
    ledger_id: capital.id,
    account_id: bank.id,
    amount: 5000000,
    details: {bank: bankAlloc('receipt', 5000000, '2026-04-01')},
    narration: 'Owner capital introduced'
  });

  // 2. Cash Sale: 10,000.00
  book.saveVoucher({
    type: 'sale',
    date: '2026-04-02',
    customer_id: 1, // Cash
    account_id: salesAccount,
    amount: 1000000,
    narration: 'Cash sale'
  });

  // 3. Credit Sale to Demo Customer: 5,000.00
  const creditSale = book.saveVoucher({
    type: 'sale',
    date: '2026-04-03',
    customer_id: customer.id,
    account_id: salesAccount,
    amount: 500000,
    narration: 'Credit sale'
  });

  // 4. Cash Purchase: 4,000.00
  book.saveVoucher({
    type: 'purchase',
    date: '2026-04-04',
    supplier_id: 1, // Cash
    account_id: purchaseAccount,
    amount: 400000,
    narration: 'Cash purchase'
  });

  // 5. Credit Purchase from Demo Supplier: 3,000.00
  const creditPurchase = book.saveVoucher({
    type: 'purchase',
    date: '2026-04-05',
    supplier_id: supplier.id,
    account_id: purchaseAccount,
    amount: 300000,
    narration: 'Credit purchase'
  });

  // 6. Expense paid from Cash: 500.00
  book.saveVoucher({
    type: 'payment',
    date: '2026-04-06',
    ledger_id: expense.id,
    account_id: 1,
    amount: 50000,
    narration: 'Office tea'
  });

  // 7. Customer partial receipt into Bank: 2,000.00
  book.saveVoucher({
    type: 'receipt',
    date: '2026-04-07',
    customer_id: customer.id,
    account_id: bank.id,
    amount: 200000,
    allocations: [{bill_id: creditSale.bill.id, amount: 200000}],
    details: {bank: bankAlloc('receipt', 200000, '2026-04-07')},
    narration: 'Customer payment'
  });

  // 8. Supplier partial payment from Bank: 1,500.00
  book.saveVoucher({
    type: 'payment',
    date: '2026-04-08',
    supplier_id: supplier.id,
    account_id: bank.id,
    amount: 150000,
    allocations: [{bill_id: creditPurchase.bill.id, amount: 150000}],
    details: {bank: bankAlloc('payment', 150000, '2026-04-08')},
    narration: 'Supplier payment'
  });

  // 9. Contra: Cash deposited to Bank: 1,000.00
  book.saveVoucher({
    type: 'contra',
    date: '2026-04-09',
    source_id: 1,
    destination_id: bank.id,
    amount: 100000,
    details: {
      bank: {
        account_id: bank.id,
        transaction_type: 'Cash',
        amount: 100000,
        instrument_number: '',
        instrument_date: '2026-04-09',
        bank_name: 'Not Applicable',
        cheque_range: '',
        denominations: { counts: {}, others: 0 }
      }
    },
    narration: 'Deposit cash to bank'
  });

  return {customer, supplier, bank, expense, capital};
}

test('Book ratioAnalysis(): computes accurate principal groups and ratios', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bookr-ratio-test-'));
  const file = join(dir, 'book.sqlite');
  const book = new Book(file);
  try {
    createFinancialDataFixture(book);
    const result = book.ratioAnalysis({from: '2026-04-01', to: '2026-04-30'});

    // Verify Principal Groups
    // Sales: 10,000 + 5,000 = 15,000.00
    assert.equal(result.groups.sales_accounts, 1500000);
    // Purchases: 4,000 + 3,000 = 7,000.00
    assert.equal(result.groups.purchase_accounts, 700000);
    // Gross Profit: 15,000 - 7,000 = 8,000.00
    // Net Profit: Gross Profit - Expenses (500) = 7,500.00
    assert.equal(result.groups.nett_profit, 750000);

    // Cash-in-Hand:
    // +10,000 (sale) - 4,000 (purchase) - 500 (expense) - 1,000 (contra deposit) = 4,500.00
    assert.equal(result.groups.cash_in_hand, 450000);
    // Bank Accounts:
    // +50,000 (capital) + 2,000 (debtor receipt) - 1,500 (supplier payment) + 1,000 (contra deposit) = 51,500.00
    assert.equal(result.groups.bank_accounts, 5150000);

    // Sundry Debtors: 5,000 - 2,000 = 3,000.00
    assert.equal(result.groups.sundry_debtors, 300000);
    // Sundry Creditors: 3,000 - 1,500 = 1,500.00
    assert.equal(result.groups.sundry_creditors, 150000);

    // Current Assets: Cash (4,500) + Bank (51,500) + Debtors (3,000) = 59,000.00
    // Current Liabilities: Creditors (1,500) = 1,500.00
    // Working Capital: 59,000 - 1,500 = 57,500.00
    assert.equal(result.groups.working_capital, 5750000);

    // Verify Principal Ratios:
    // Current Ratio: 59,000 / 1,500 = 39.33
    assert.equal(result.ratios.current_ratio, 39.33);
    // Quick Ratio (no stock): 39.33
    assert.equal(result.ratios.quick_ratio, 39.33);
    // Gross Profit %: (8,000 / 15,000) * 100 = 53.33 %
    assert.equal(result.ratios.gross_profit_pct, 53.33);
    // Net Profit %: (7,500 / 15,000) * 100 = 50.00 %
    assert.equal(result.ratios.nett_profit_pct, 50);
    // Cost %: (7,000 / 15,000) * 100 = 46.67 %
    assert.equal(result.ratios.cost_pct, 46.67);
    // Working Capital Turnover: 15,000 / 57,500 = 0.26
    assert.equal(result.groups.wkg_capital_turnover, 0.26);
  } finally {
    book.close();
    rmSync(dir, {recursive: true, force: true});
  }
});

test('Book cashBankSummary(): groups cash and bank ledgers with closing balances', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bookr-cash-bank-summary-test-'));
  const file = join(dir, 'book.sqlite');
  const book = new Book(file);
  try {
    createFinancialDataFixture(book);
    const summary = book.cashBankSummary({from: '2026-04-01', to: '2026-04-30'});

    assert.equal(summary.groups.length, 2);
    const cashGroup = summary.groups.find(g => g.key === 'cash');
    const bankGroup = summary.groups.find(g => g.key === 'bank');

    assert.equal(cashGroup.name, 'Cash-in-Hand');
    assert.equal(cashGroup.debit, 450000);
    assert.equal(cashGroup.credit, 0);
    assert.equal(cashGroup.ledgers.length, 1);
    assert.equal(cashGroup.ledgers[0].name, 'Cash');

    assert.equal(bankGroup.name, 'Bank Accounts');
    assert.equal(bankGroup.debit, 5150000);
    assert.equal(bankGroup.credit, 0);
    assert.equal(bankGroup.ledgers.length, 1);
    assert.equal(bankGroup.ledgers[0].name, 'HDFC Bank');

    assert.equal(summary.totals.debit, 5600000);
    assert.equal(summary.totals.credit, 0);
    assert.equal(summary.totals.closing, 5600000);
  } finally {
    book.close();
    rmSync(dir, {recursive: true, force: true});
  }
});

test('Book cashFlow(): accurately computes monthly inflow, outflow and group drilldowns', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bookr-cash-flow-test-'));
  const file = join(dir, 'book.sqlite');
  const book = new Book(file);
  try {
    createFinancialDataFixture(book);
    const flow = book.cashFlow({month: '2026-04'});

    // 12 months present
    assert.equal(flow.months.length, 12);
    const april = flow.months.find(m => m.month === '2026-04');
    assert.ok(april);

    // Cash & Bank Inflows in April:
    // 1. Capital receipt: 50,000.00
    // 2. Cash sale: 10,000.00
    // 3. Customer receipt: 2,000.00
    // (Contra deposit 1,000 is internal transfer between cash & bank, not an inflow/outflow)
    // Total Inflow = 50,000 + 10,000 + 2,000 = 62,000.00
    assert.equal(april.inflow, 6200000);

    // Cash & Bank Outflows in April:
    // 1. Cash purchase: 4,000.00
    // 2. Office tea payment: 500.00
    // 3. Supplier payment: 1,500.00
    // Total Outflow = 4,000 + 500 + 1,500 = 6,000.00
    assert.equal(april.outflow, 600000);

    // Nett Flow in April = 62,000 - 6,000 = 56,000.00
    assert.equal(april.nett_flow, 5600000);
    assert.equal(flow.totals.inflow, 6200000);
    assert.equal(flow.totals.outflow, 600000);
    assert.equal(flow.totals.nett_flow, 5600000);

    // Drilldown verification:
    assert.ok(flow.drilldown);
    assert.equal(flow.drilldown.totals.inflow, 6200000);
    assert.equal(flow.drilldown.totals.outflow, 600000);
    assert.equal(flow.drilldown.totals.nett_inflow, 5600000);

    const capitalInflow = flow.drilldown.inflow_groups.find(g => g.group_name === 'Capital Account');
    assert.equal(capitalInflow.amount, 5000000);

    const salesInflow = flow.drilldown.inflow_groups.find(g => g.group_name === 'Sales Accounts');
    assert.equal(salesInflow.amount, 1000000);

    const customerInflow = flow.drilldown.inflow_groups.find(g => g.group_name === 'Current Assets');
    assert.equal(customerInflow.amount, 200000);

    const purchaseOutflow = flow.drilldown.outflow_groups.find(g => g.group_name === 'Purchase Accounts');
    assert.equal(purchaseOutflow.amount, 400000);

    const expenseOutflow = flow.drilldown.outflow_groups.find(g => g.group_name === 'Indirect Expenses');
    assert.equal(expenseOutflow.amount, 50000);

    const supplierOutflow = flow.drilldown.outflow_groups.find(g => g.group_name === 'Current Liabilities');
    assert.equal(supplierOutflow.amount, 150000);
  } finally {
    book.close();
    rmSync(dir, {recursive: true, force: true});
  }
});
