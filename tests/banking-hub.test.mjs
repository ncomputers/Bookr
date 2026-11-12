import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Book} from '../lib/accounting.mjs';

function createBankingFixture(book) {
  const customer = book.createCustomer({name: 'Banking Customer'});
  const supplier = book.saveSupplier({name: 'Banking Supplier'});
  const bank = book.saveBank({name: 'Demo Bank', bank: {account_number: '11223344'}});
  const salesAccount = book.ledgers().find(l => l.kind === 'sales').id;
  const purchaseAccount = book.ledgers().find(l => l.kind === 'purchase').id;

  const bankAlloc = (type, amount, date, instNo = '500001') => ({
    account_id: bank.id,
    transaction_type: type === 'payment' ? 'Cheque' : 'Cheque/DD',
    amount,
    instrument_number: instNo,
    instrument_date: date,
    bank_name: 'Not Applicable',
    cheque_range: type === 'payment' ? 'Not Applicable' : ''
  });

  // Sales for bill allocations: 5,000.00
  const s1 = book.saveVoucher({
    type: 'sale',
    date: '2026-04-05',
    customer_id: customer.id,
    account_id: salesAccount,
    amount: 500000,
    narration: 'Credit sale 1'
  });

  // Purchase for bill allocations: 2,000.00
  const p0 = book.saveVoucher({
    type: 'purchase',
    date: '2026-04-06',
    supplier_id: supplier.id,
    account_id: purchaseAccount,
    amount: 200000,
    narration: 'Credit purchase 1'
  });

  // 1. Receipt from customer into bank: 1,500.00
  const r1 = book.saveVoucher({
    type: 'receipt',
    date: '2026-04-10',
    customer_id: customer.id,
    account_id: bank.id,
    amount: 150000,
    allocations: [{bill_id: s1.bill.id, amount: 150000}],
    details: {bank: bankAlloc('receipt', 150000, '2026-04-10', 'CHK-101')},
    narration: 'Customer cheque 1'
  });

  // 2. Receipt from customer into bank: 2,500.00 (reconciled)
  const r2 = book.saveVoucher({
    type: 'receipt',
    date: '2026-04-12',
    customer_id: customer.id,
    account_id: bank.id,
    amount: 250000,
    allocations: [{bill_id: s1.bill.id, amount: 250000}],
    details: {
      bank: {
        ...bankAlloc('receipt', 250000, '2026-04-12', 'CHK-102'),
        bank_date: '2026-04-14'
      }
    },
    narration: 'Customer cheque 2'
  });

  // 3. Payment to supplier from bank: 800.00
  const p1 = book.saveVoucher({
    type: 'payment',
    date: '2026-04-15',
    supplier_id: supplier.id,
    account_id: bank.id,
    amount: 80000,
    allocations: [{bill_id: p0.bill.id, amount: 80000}],
    details: {bank: bankAlloc('payment', 80000, '2026-04-15', 'PAY-201')},
    narration: 'Supplier cheque'
  });

  // 4. Contra: Cash deposit into bank: 500.00
  const c1 = book.saveVoucher({
    type: 'contra',
    date: '2026-04-16',
    source_id: 1,
    destination_id: bank.id,
    amount: 50000,
    details: {
      bank: {
        account_id: bank.id,
        transaction_type: 'Cash',
        amount: 50000,
        instrument_number: 'CASH-DEP',
        instrument_date: '2026-04-16',
        bank_name: 'Not Applicable',
        cheque_range: '',
        denominations: { counts: {}, others: 0 }
      }
    },
    narration: 'Cash deposit'
  });

  return {customer, supplier, bank};
}

test('Book chequeRegister(): computes bank summaries and item-level details', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bookr-cheque-reg-test-'));
  const file = join(dir, 'book.sqlite');
  const book = new Book(file);
  try {
    const {bank} = createBankingFixture(book);

    // Summary of all banks
    const summary = book.chequeRegister();
    assert.equal(summary.banks.length, 1);
    const b = summary.banks[0];
    assert.equal(b.name, 'Demo Bank');
    assert.equal(b.total_cheques, 4);
    assert.equal(b.reconciled, 1);
    assert.equal(b.unreconciled, 3);

    // Detail items for Demo Bank
    const details = book.chequeRegister(bank.id);
    assert.equal(details.bank.id, bank.id);
    assert.equal(details.items.length, 4);

    const chk101 = details.items.find(i => i.instrument_number === 'CHK-101');
    assert.ok(chk101);
    assert.equal(chk101.amount, 150000);
    assert.equal(chk101.status, 'Unreconciled');
    assert.equal(chk101.type, 'Receipt');

    const chk102 = details.items.find(i => i.instrument_number === 'CHK-102');
    assert.ok(chk102);
    assert.equal(chk102.amount, 250000);
    assert.equal(chk102.status, 'Reconciled');
    assert.equal(chk102.bank_date, '2026-04-14');

    const pay201 = details.items.find(i => i.instrument_number === 'PAY-201');
    assert.ok(pay201);
    assert.equal(pay201.amount, 80000);
    assert.equal(pay201.type, 'Payment');
  } finally {
    book.close();
    rmSync(dir, {recursive: true, force: true});
  }
});

test('Book depositSlip(): lists incoming bank deposits with instrument details', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bookr-deposit-slip-test-'));
  const file = join(dir, 'book.sqlite');
  const book = new Book(file);
  try {
    const {bank} = createBankingFixture(book);
    const slip = book.depositSlip(bank.id);

    // Incoming deposits: 2 receipts (1500 + 2500) and 1 contra deposit (500) = 4,500.00
    assert.equal(slip.items.length, 3);
    assert.equal(slip.totals.count, 3);
    assert.equal(slip.totals.total_amount, 450000);

    const items = slip.items;
    assert.equal(items[0].instrument_number, 'CHK-101');
    assert.equal(items[0].amount, 150000);
    assert.equal(items[1].instrument_number, 'CHK-102');
    assert.equal(items[1].amount, 250000);
    assert.equal(items[2].instrument_number, 'CASH-DEP');
    assert.equal(items[2].amount, 50000);
  } finally {
    book.close();
    rmSync(dir, {recursive: true, force: true});
  }
});

test('Book paymentAdvice(): lists outgoing bank payments with instrument details', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bookr-payment-advice-test-'));
  const file = join(dir, 'book.sqlite');
  const book = new Book(file);
  try {
    const {bank} = createBankingFixture(book);
    const advice = book.paymentAdvice(bank.id);

    // Outgoing payments: 1 payment (800) = 800.00
    assert.equal(advice.items.length, 1);
    assert.equal(advice.totals.count, 1);
    assert.equal(advice.totals.total_amount, 80000);
    assert.equal(advice.items[0].instrument_number, 'PAY-201');
    assert.equal(advice.items[0].amount, 80000);
  } finally {
    book.close();
    rmSync(dir, {recursive: true, force: true});
  }
});
