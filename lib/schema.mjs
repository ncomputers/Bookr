// Expand the original application's CHECK constraints without changing saved
// ledger/voucher identities. Foreign keys are checked before the swap commits.
export function expandAccountingSchema(db) {
  const ledgerSql=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ledgers'").get().sql;
  const voucherSql=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='vouchers'").get().sql;
  if(ledgerSql.includes("'expense'") && ledgerSql.includes("'income'") && ledgerSql.includes("'capital'") && ledgerSql.includes("'general'") && voucherSql.includes("'contra'") && voucherSql.includes("'journal'") && voucherSql.includes("'credit_note'") && voucherSql.includes("'debit_note'"))return;
  const ledgerColumns=new Set(db.prepare('PRAGMA table_info(ledgers)').all().map(row=>row.name));
  const groupId=ledgerColumns.has('group_id')?'group_id':'NULL';
  const groupName=ledgerColumns.has('group_name')?'group_name':"''";
  const gstin=ledgerColumns.has('gstin')?'gstin':"''";
  const gstRegType=ledgerColumns.has('gst_registration_type')?'gst_registration_type':"'Unregistered'";
  const taxType=ledgerColumns.has('tax_type')?'tax_type':"''";
  const taxRate=ledgerColumns.has('tax_rate')?'tax_rate':'0';
  db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE');
  try {
    db.exec(`CREATE TABLE expanded_ledgers(
      id INTEGER PRIMARY KEY,name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      kind TEXT NOT NULL CHECK(kind IN ('customer','supplier','cash','bank','sales','purchase','expense','income','capital','general')),
      alias TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 1,
      mailing_name TEXT NOT NULL DEFAULT '',address TEXT NOT NULL DEFAULT '',group_id INTEGER,group_name TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT 'Not Applicable',country TEXT NOT NULL DEFAULT 'India',pincode TEXT NOT NULL DEFAULT '',
      gstin TEXT NOT NULL DEFAULT '',gst_registration_type TEXT NOT NULL DEFAULT 'Unregistered',
      tax_type TEXT NOT NULL DEFAULT '',tax_rate REAL NOT NULL DEFAULT 0
    );
    INSERT INTO expanded_ledgers(id,name,kind,alias,revision,mailing_name,address,group_id,group_name,state,country,pincode,gstin,gst_registration_type,tax_type,tax_rate)
      SELECT id,name,kind,alias,revision,mailing_name,address,${groupId},${groupName},state,country,pincode,${gstin},${gstRegType},${taxType},${taxRate} FROM ledgers;
    CREATE TABLE expanded_vouchers(
      id INTEGER PRIMARY KEY,type TEXT NOT NULL CHECK(type IN ('sale','receipt','purchase','payment','contra','journal','credit_note','debit_note')),
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

export function initializeLedgerGroupSchema(db){
  const columns=new Set(db.prepare('PRAGMA table_info(ledgers)').all().map(row=>row.name));
  if(!columns.has('group_id'))db.exec('ALTER TABLE ledgers ADD COLUMN group_id INTEGER');
  if(!columns.has('group_name'))db.exec("ALTER TABLE ledgers ADD COLUMN group_name TEXT NOT NULL DEFAULT ''");
}

// Additive zero-default migration: absent rows mean zero. No existing master,
// voucher, posting, bill, allocation or bank metadata is rewritten.
export function initializeOpeningSchema(db){
  db.exec(`CREATE TABLE IF NOT EXISTS ledger_openings(
    ledger_id INTEGER PRIMARY KEY REFERENCES ledgers(id),
    amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount<>0 AND amount BETWEEN -100000000000 AND 100000000000)
  );`);
}

export function initializeGstLedgerSchema(db){
  const columns=new Set(db.prepare('PRAGMA table_info(ledgers)').all().map(row=>row.name));
  if(!columns.has('gstin'))db.exec("ALTER TABLE ledgers ADD COLUMN gstin TEXT NOT NULL DEFAULT ''");
  if(!columns.has('gst_registration_type'))db.exec("ALTER TABLE ledgers ADD COLUMN gst_registration_type TEXT NOT NULL DEFAULT 'Unregistered'");
  if(!columns.has('tax_type'))db.exec("ALTER TABLE ledgers ADD COLUMN tax_type TEXT NOT NULL DEFAULT ''");
  if(!columns.has('tax_rate'))db.exec("ALTER TABLE ledgers ADD COLUMN tax_rate REAL NOT NULL DEFAULT 0");
}
