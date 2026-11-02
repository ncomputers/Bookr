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
  const trimmed = String(value).trim().toUpperCase();
  if (!trimmed) return '';
  if (!GSTIN_REGEX.test(trimmed)) {
    throw new Error('Enter a valid 15-character GSTIN.');
  }
  return trimmed;
}

export function stateCodeFromGstin(gstin) {
  try {
    const normalized = normalizeGstin(gstin);
    return normalized ? normalized.slice(0, 2) : null;
  } catch {
    return null;
  }
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
  return matched || trimmed;
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
  const taxable = Number(taxableAmountPaise) || 0;
  const rate = Number(gstRatePercent) || 0;
  if (rate === 0 || taxable <= 0) {
    return {
      taxableAmount: taxable,
      taxable_amount: taxable,
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
      totalAmount: taxable,
      total_amount: taxable
    };
  }
  if (isIntraState) {
    const halfRate = rate / 2;
    const cgst = Math.round((taxable * halfRate) / 100);
    const sgst = Math.round((taxable * halfRate) / 100);
    const totalTax = cgst + sgst;
    return {
      taxableAmount: taxable,
      taxable_amount: taxable,
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
      totalAmount: taxable + totalTax,
      total_amount: taxable + totalTax
    };
  } else {
    const igst = Math.round((taxable * rate) / 100);
    const totalTax = igst;
    return {
      taxableAmount: taxable,
      taxable_amount: taxable,
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
      totalAmount: taxable + igst,
      total_amount: taxable + igst
    };
  }
}
