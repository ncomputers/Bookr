import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Book} from '../lib/accounting.mjs';

function createAllVouchersFixture(book) {
  const customer = book.createCustomer({name: 'Demo Customer'});
  const supplier = book.saveSupplier({name: 'Demo Supplier'});
  const salesAccount = book.ledgers().find(l => l.kind === 'sales').id;
  const purchaseAccount = book.ledgers().find(l => l.kind === 'purchase').id;
  const expense = book.saveAccount({name: 'Office Cleaning Expense', kind: 'expense'});
  const bank = book.saveBank({name: 'Test Bank Account', bank: {account_number: '123'}});

  // 1. Sale (100.00)
  const sale = book.saveVoucher({type: 'sale', date: '2026-04-05', customer_id: customer.id, account_id: salesAccount, amount: 10000});

  // 2. Purchase (200.00)
  const purchase = book.saveVoucher({type: 'purchase', date: '2026-04-06', supplier_id: supplier.id, account_id: purchaseAccount, amount: 20000});

  // 3. Receipt (50.00)
  book.saveVoucher({type: 'receipt', date: '2026-04-07', customer_id: customer.id, account_id: 1, amount: 5000, allocations: [{bill_id: sale.bill.id, amount: 5000}]});

  // 4. Payment (60.00)
  book.saveVoucher({type: 'payment', date: '2026-04-08', supplier_id: supplier.id, account_id: 1, amount: 6000, allocations: [{bill_id: purchase.bill.id, amount: 6000}]});

  // 5. Contra (30.00: cash to bank deposit)
  book.saveVoucher({
    type: 'contra',
    date: '2026-04-09',
    source_id: 1,
    destination_id: bank.id,
    amount: 3000,
    details: {
      bank: {
        account_id: bank.id,
        transaction_type: 'Cash',
        amount: 3000,
        instrument_number: '',
        instrument_date: '2026-04-09',
        bank_name: 'Not Applicable',
        cheque_range: '',
        denominations: { counts: {}, others: 0 }
      }
    }
  });

  // 6. Journal (40.00)
  book.saveVoucher({type: 'journal', date: '2026-04-10', debit_ledger_id: expense.id, credit_ledger_id: supplier.id, debit_amount: 4000, credit_amount: 4000});

  // 7. Credit Note (15.00: sales return)
  book.saveVoucher({type: 'credit_note', date: '2026-04-11', customer_id: customer.id, account_id: salesAccount, amount: 1500});

  // 8. Debit Note (25.00: purchase return)
  book.saveVoucher({type: 'debit_note', date: '2026-04-12', supplier_id: supplier.id, account_id: purchaseAccount, amount: 2500});

  return {customer, supplier, bank, expense};
}

test('Book statistics(): counts all 8 voucher types and total correctly', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bookr-stats-'));
  const file = join(directory, 'book.sqlite');
  let book = new Book(file);
  try {
    const emptyStats = book.statistics();
    assert.equal(emptyStats.voucher_total, 0);
    assert.equal(emptyStats.voucher_types.every(v => v.count === 0), true);

    createAllVouchersFixture(book);

    const stats = book.statistics();
    assert.equal(stats.voucher_total, 8);
    const countMap = Object.fromEntries(stats.voucher_types.map(v => [v.type, v.count]));
    assert.equal(countMap.sales, 1);
    assert.equal(countMap.purchase, 1);
    assert.equal(countMap.receipt, 1);
    assert.equal(countMap.payment, 1);
    assert.equal(countMap.contra, 1);
    assert.equal(countMap.journal, 1);
    assert.equal(countMap.credit_note, 1);
    assert.equal(countMap.debit_note, 1);
  } finally {
    book.close();
    rmSync(directory, {recursive: true, force: true});
  }
});

test('Registers: Payment, Receipt, Contra, Credit Note, Debit Note monthly summaries and drilldowns', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bookr-all-registers-'));
  const file = join(directory, 'book.sqlite');
  let book = new Book(file);
  try {
    createAllVouchersFixture(book);

    // Payment Register
    const paySum = book.voucherRegisterSummary('payment');
    assert.equal(paySum.totals.voucher_count, 1);
    assert.equal(paySum.totals.credit, 6000);
    const payMonth = book.voucherRegisterMonth('payment', 2026, 4);
    assert.equal(payMonth.rows.length, 1);
    assert.equal(payMonth.rows[0].particulars, 'Demo Supplier');
    assert.equal(payMonth.rows[0].debit, 6000);

    // Receipt Register
    const recSum = book.voucherRegisterSummary('receipt');
    assert.equal(recSum.totals.voucher_count, 1);
    assert.equal(recSum.totals.debit, 5000);
    const recMonth = book.voucherRegisterMonth('receipt', 2026, 4);
    assert.equal(recMonth.rows.length, 1);
    assert.equal(recMonth.rows[0].particulars, 'Demo Customer');
    assert.equal(recMonth.rows[0].credit, 5000);

    // Contra Register
    const conSum = book.voucherRegisterSummary('contra');
    assert.equal(conSum.totals.voucher_count, 1);
    const conMonth = book.voucherRegisterMonth('contra', 2026, 4);
    assert.equal(conMonth.rows.length, 1);
    assert.equal(conMonth.rows[0].amount, 3000);

    // Credit Note Register
    const cnSum = book.voucherRegisterSummary('credit_note');
    assert.equal(cnSum.totals.voucher_count, 1);
    assert.equal(cnSum.totals.debit, 1500);
    const cnMonth = book.voucherRegisterMonth('credit_note', 2026, 4);
    assert.equal(cnMonth.rows.length, 1);
    assert.equal(cnMonth.rows[0].particulars, 'Demo Customer');
    assert.equal(cnMonth.rows[0].credit, 1500);

    // Debit Note Register
    const dnSum = book.voucherRegisterSummary('debit_note');
    assert.equal(dnSum.totals.voucher_count, 1);
    assert.equal(dnSum.totals.credit, 2500);
    const dnMonth = book.voucherRegisterMonth('debit_note', 2026, 4);
    assert.equal(dnMonth.rows.length, 1);
    assert.equal(dnMonth.rows[0].particulars, 'Demo Supplier');
    assert.equal(dnMonth.rows[0].debit, 2500);
  } finally {
    book.close();
    rmSync(directory, {recursive: true, force: true});
  }
});
