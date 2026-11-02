import {BookError} from './errors.mjs';

export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export const GST_REGISTRATION_TYPES = Object.freeze([
  'Regular',
  'Composition',
  'Consumer',
  'Unregistered'
]);

export const STATE_CODE_TO_NAME = Object.freeze({
  '01': 'Jammu & Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra & Nagar Haveli and Daman & Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman & Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory'
});

export const STATE_NAME_TO_CODE = Object.freeze(
  Object.fromEntries(
    Object.entries(STATE_CODE_TO_NAME).map(([code, name]) => [name.toLowerCase(), code])
  )
);

export function normalizeGstin(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new BookError('GSTIN must be a string.');
  const trimmed = value.trim().toUpperCase();
  if (!trimmed) return '';
  if (!GSTIN_REGEX.test(trimmed)) {
    throw new BookError('Enter a valid 15-character GSTIN.');
  }
  return trimmed;
}

export function stateCodeFromGstin(gstin) {
  const normalized = normalizeGstin(gstin);
  return normalized ? normalized.slice(0, 2) : null;
}

export function stateNameFromGstin(gstin) {
  const code = stateCodeFromGstin(gstin);
  return code ? (STATE_CODE_TO_NAME[code] ?? null) : null;
}

export function normalizeRegistrationType(type, hasGstin = false) {
  if (!type || typeof type !== 'string' || !type.trim()) {
    return hasGstin ? 'Regular' : 'Unregistered';
  }
  const trimmed = type.trim();
  const matched = GST_REGISTRATION_TYPES.find(t => t.toLowerCase() === trimmed.toLowerCase());
  if (matched) return matched;
  if (trimmed.length <= 30) return trimmed;
  throw new BookError('Enter a valid GST registration type.');
}

export function determineSupplyType(companyState, partyState, companyGstin = '', partyGstin = '') {
  const compCode = stateCodeFromGstin(companyGstin) || STATE_NAME_TO_CODE[(companyState || '').toLowerCase()];
  const partyCode = stateCodeFromGstin(partyGstin) || STATE_NAME_TO_CODE[(partyState || '').toLowerCase()];
  if (compCode && partyCode) {
    return compCode === partyCode ? 'intra_state' : 'inter_state';
  }
  const cState = (companyState || '').trim().toLowerCase();
  const pState = (partyState || '').trim().toLowerCase();
  if (cState && pState && cState !== 'not applicable' && pState !== 'not applicable') {
    return cState === pState ? 'intra_state' : 'inter_state';
  }
  return 'intra_state';
}

export function calculateLineGst(taxableAmountPaise, gstRatePercent, isIntraState) {
  if (!Number.isSafeInteger(taxableAmountPaise) || taxableAmountPaise < 0) {
    throw new BookError('Taxable amount must be a non-negative integer in paise.');
  }
  const rate = Number(gstRatePercent);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    throw new BookError('GST rate must be between 0 and 100 percent.');
  }
  if (rate === 0) {
    return {
      taxableAmount: taxableAmountPaise,
      taxable_amount: taxableAmountPaise,
      gstRate: 0,
      gst_rate: 0,
      isIntraState: Boolean(isIntraState),
      cgst: 0,
      cgst_amount: 0,
      sgst: 0,
      sgst_amount: 0,
      igst: 0,
      igst_amount: 0,
      totalTax: 0,
      total_tax: 0,
      totalAmount: taxableAmountPaise,
      total_amount: taxableAmountPaise
    };
  }
  if (isIntraState) {
    const halfRate = rate / 2;
    const cgst = Math.round((taxableAmountPaise * halfRate) / 100);
    const sgst = Math.round((taxableAmountPaise * halfRate) / 100);
    const totalTax = cgst + sgst;
    return {
      taxableAmount: taxableAmountPaise,
      taxable_amount: taxableAmountPaise,
      gstRate: rate,
      gst_rate: rate,
      isIntraState: true,
      cgst,
      cgst_amount: cgst,
      sgst,
      sgst_amount: sgst,
      igst: 0,
      igst_amount: 0,
      totalTax,
      total_tax: totalTax,
      totalAmount: taxableAmountPaise + totalTax,
      total_amount: taxableAmountPaise + totalTax
    };
  } else {
    const igst = Math.round((taxableAmountPaise * rate) / 100);
    const totalTax = igst;
    return {
      taxableAmount: taxableAmountPaise,
      taxable_amount: taxableAmountPaise,
      gstRate: rate,
      gst_rate: rate,
      isIntraState: false,
      cgst: 0,
      cgst_amount: 0,
      sgst: 0,
      sgst_amount: 0,
      igst,
      igst_amount: igst,
      totalTax,
      total_tax: totalTax,
      totalAmount: taxableAmountPaise + igst,
      total_amount: taxableAmountPaise + igst
    };
  }
}
