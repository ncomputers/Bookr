// Original Bookr metadata convention. This is not a complete dialing catalog.
export const NEW_COMPANY_MOBILE_CALLING_CODE='91';
export class MobileCodeError extends Error {constructor(message){super(message);this.name='MobileCodeError';this.status=400;}}
export function normalizeMobileCallingCode(value){
 if(typeof value!=='string'||/[\u0000-\u001f\u007f]/.test(value))throw new MobileCodeError('Enter a mobile calling code using up to eight digits, or leave it blank.');
 const code=value.trim();if(!/^[0-9]{0,8}$/.test(code))throw new MobileCodeError('Enter a mobile calling code using up to eight digits, without a plus sign.');return code;
}
export function companyMobileCallingCode(profile){
 if(!profile||typeof profile!=='object'||Array.isArray(profile))throw new MobileCodeError('Unsupported stored mobile calling code.');
 if(!Object.hasOwn(profile,'mobile_calling_code'))return '';
 const code=normalizeMobileCallingCode(profile.mobile_calling_code);if(code!==profile.mobile_calling_code)throw new MobileCodeError('Unsupported stored mobile calling code; the profile has not been changed.');return code;
}
