// Voucher bills and master opening references have separate identity spaces.
// Keep wire allocations minimal even when the GET response contains labels.
export function billIdentity(row){
  if(row?.opening_bill_id!=null)return 'opening:'+row.opening_bill_id;
  if(row?.bill_id!=null)return 'voucher:'+row.bill_id;
  return '';
}
export const sameBill=(left,right)=>Boolean(billIdentity(left)) && billIdentity(left)===billIdentity(right);
export function billReference(row){
  if(row?.opening_bill_id!=null)return {opening_bill_id:row.opening_bill_id};
  if(row?.bill_id!=null)return {bill_id:row.bill_id};
  return {};
}
export const allocationPayload=rows=>rows.map(row=>({...billReference(row),amount:row.amount}));
