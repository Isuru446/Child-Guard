// Allowlisted messages/paths only: never return submitted values or Zod internals.
const messages = {
 fullName:'Use 2–150 characters for the full name',
 username:'Use 3–100 letters, numbers or . _ @ + - for the username',
 email:'Enter a valid email address (at most 254 characters)',
 phone:'Use a phone number with 7–15 digits and optional + ( ) spaces or -',
 password:'Use 12+ characters and at most 72 UTF-8 bytes',
 centerId:'Select an available center',
 centerCode:'Enter the 64-character invitation code supplied by your center',
 role:'Select Parent or Teacher',acceptTerms:'Accept the privacy policy and terms',
 children:'Provide 1–10 child requests for a Parent and none for a Teacher',
 existingChildId:'Enter the complete child reference supplied by your center (UUID)',
 dateOfBirth:'Enter a real birth date, not in the future (YYYY-MM-DD)',
 relationship:'Use 2–80 characters for your relationship (for example, Parent)',
 hardwareId:'Enter a device identifier of at most 100 characters',
 claimCode:'Enter the 64-character one-time claim code supplied by your center',
};
export function registrationValidationFields(error) {
 const fields={};
 for(const issue of error.issues){
  const path=issue.path.join('.');
  if(/^(fullName|username|email|phone|password|centerId|centerCode|role|acceptTerms|children)$/.test(path) ||
    /^children\.\d+\.(fullName|existingChildId|dateOfBirth|relationship|wearable\.(hardwareId|claimCode))$/.test(path)) {
   fields[path]=messages[issue.path.at(-1)];
  }
 }
 return fields;
}
