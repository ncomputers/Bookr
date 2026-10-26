const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const rupees = new Intl.NumberFormat('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
export function validIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(value+'T12:00:00Z');
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0,10) === value;
}
export function parseEntryDate(value) {
  value = value.trim();
  const parts = value.match(/^(\d{1,2})-([a-z]{3})-(\d{4})$/i);
  if (parts) {
    const month = months.findIndex(name => name.toLowerCase() === parts[2].toLowerCase())+1;
    value = `${parts[3]}-${String(month).padStart(2,'0')}-${parts[1].padStart(2,'0')}`;
  }
  const numeric=value.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if(numeric)value=`${numeric[3]}-${numeric[2].padStart(2,'0')}-${numeric[1].padStart(2,'0')}`;
  if (!validIsoDate(value)) throw new Error('Enter a valid date as 1-Apr-2026, 1-4-2026 or 2026-04-01.');
  return value;
}
export function entryDate(value) {
  return `${Number(value.slice(8,10))}-${months[Number(value.slice(5,7))-1]}-${value.slice(0,4)}`;
}
export function parseRupees(value) {
  const match = String(value).trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) throw new Error('Enter a positive amount using digits and up to two decimal places.');
  const paise = BigInt(match[1])*100n+BigInt((match[2] || '').padEnd(2,'0'));
  if (paise <= 0n || paise > 100000000000n) throw new Error('Enter an amount above zero and within this demo’s limit of ₹1,00,00,00,000.');
  return Number(paise);
}
export const formatRupees = paise => rupees.format(paise/100);
// Signed posting balances are debit-positive throughout the application.
export const formatBalance = paise => `${formatRupees(Math.abs(paise))} ${paise<0?'Cr':'Dr'}`;
export const inputRupees = paise => `${Math.floor(paise/100)}.${String(paise%100).padStart(2,'0')}`;
