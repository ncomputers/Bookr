// Signed debit balance includes the master opening exactly once. The pending
// entry is added by its form, and a saved voucher being edited is excluded.
export function savedLedgerBalance(book,ledgerId,excludeId=null) {
  const opening=book.ledgers.find(ledger=>ledger.id===ledgerId)?.opening_balance ?? 0;
  const vouchers=book.vouchers;
  return vouchers.filter(voucher=>voucher.id!==excludeId).reduce((total,voucher)=>{
    if(voucher.type==='journal' && voucher.journal_mode==='general' && Array.isArray(voucher.entries))return total+voucher.entries.filter(entry=>entry.ledger_id===ledgerId).reduce((sum,entry)=>sum+(entry.side==='debit'?entry.amount:-entry.amount),0);
    const accountDebit=['receipt','purchase','contra','journal'].includes(voucher.type),sign=accountDebit?1:-1;
    return total+(voucher.account_id===ledgerId?sign*voucher.amount:0)+(voucher.customer_id===ledgerId?-sign*voucher.amount:0);
  },opening);
}
