// Expand the original application's CHECK constraints without changing saved
// ledger/voucher identities. Foreign keys are checked before the swap commits.
export function expandAccountingSchema(db) {
  const ledgerSql=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ledgers'").get().sql;
  const voucherSql=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='vouchers'").get().sql;
  if(ledgerSql.includes("'expense'") && ledgerSql.includes("'income'") && ledgerSql.includes("'capital'") && voucherSql.includes("'contra'") && voucherSql.includes("'journal'"))return;
  db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE');
  try {
    db.exec(`CREATE TABLE expanded_ledgers(
      id INTEGER PRIMARY KEY,name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      kind TEXT NOT NULL CHECK(kind IN ('customer','supplier','cash','bank','sales','purchase','expense','income','capital')),
      alias TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 1,
      mailing_name TEXT NOT NULL DEFAULT '',address TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT 'Not Applicable',country TEXT NOT NULL DEFAULT 'India',pincode TEXT NOT NULL DEFAULT ''
    );
    INSERT INTO expanded_ledgers SELECT id,name,kind,alias,revision,mailing_name,address,state,country,pincode FROM ledgers;
    CREATE TABLE expanded_vouchers(
      id INTEGER PRIMARY KEY,type TEXT NOT NULL CHECK(type IN ('sale','receipt','purchase','payment','contra','journal')),
      number INTEGER NOT NULL,date TEXT NOT NULL,
      customer_id INTEGER NOT NULL REFERENCES ledgers(id),account_id INTEGER NOT NULL REFERENCES ledgers(id),
      amount INTEGER NOT NULL CHECK(amount>0),narration TEXT NOT NULL DEFAULT '',
      sale_id INTEGER REFERENCES vouchers(id),revision INTEGER NOT NULL DEFAULT 1,details TEXT NOT NULL DEFAULT '{}',
      UNIQUE(type,number)
    );
    INSERT INTO expanded_vouchers SELECT id,type,number,date,customer_id,account_id,amount,narration,sale_id,revision,details FROM vouchers;
    DROP TABLE vouchers; DROP TABLE ledgers;
    ALTER TABLE expanded_ledgers RENAME TO ledgers;
    ALTER TABLE expanded_vouchers RENAME TO vouchers;`);
    if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Accounting migration failed its foreign key check.');
    db.exec('COMMIT');
  } catch(error) { db.exec('ROLLBACK');throw error; }
  finally { db.exec('PRAGMA foreign_keys=ON'); }
}

// Additive zero-default migration: absent rows mean zero. No existing master,
// voucher, posting, bill, allocation or bank metadata is rewritten.
export function initializeOpeningSchema(db){
  db.exec(`CREATE TABLE IF NOT EXISTS ledger_openings(
    ledger_id INTEGER PRIMARY KEY REFERENCES ledgers(id),
    amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount<>0 AND amount BETWEEN -100000000000 AND 100000000000)
  );`);
}
