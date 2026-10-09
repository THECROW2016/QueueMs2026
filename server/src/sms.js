// SMS via Africa's Talking. If AT_USERNAME / AT_API_KEY are not set,
// messages are logged to the console instead, so the app works without SMS.

const username = process.env.AT_USERNAME;
const apiKey = process.env.AT_API_KEY;
const senderId = process.env.AT_SENDER_ID; // optional
const countryCode = process.env.SMS_COUNTRY_CODE || '254';

const endpoint =
  username === 'sandbox'
    ? 'https://api.sandbox.africastalking.com/version1/messaging'
    : 'https://api.africastalking.com/version1/messaging';

export const smsEnabled = Boolean(username && apiKey);

/** Normalise local numbers like 0712345678 to +254712345678. */
export function normalizePhone(raw) {
  if (!raw) return null;
  let p = String(raw).replace(/[\s\-()]/g, '');
  if (!p) return null;
  if (p.startsWith('+')) return /^\+\d{9,15}$/.test(p) ? p : null;
  if (p.startsWith('00')) p = p.slice(2);
  else if (p.startsWith('0')) p = countryCode + p.slice(1);
  else if (!p.startsWith(countryCode)) p = countryCode + p;
  return /^\d{9,15}$/.test(p) ? `+${p}` : null;
}

export async function sendSms(to, message) {
  if (!to) return { skipped: true };
  if (!smsEnabled) {
    console.log(`[sms:console] to=${to} :: ${message}`);
    return { console: true };
  }
  try {
    const body = new URLSearchParams({ username, to, message });
    if (senderId) body.set('from', senderId);
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        apiKey,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) console.error('[sms] failed', res.status, data);
    return data;
  } catch (err) {
    // Never let an SMS failure break the queue flow.
    console.error('[sms] error', err.message);
    return { error: err.message };
  }
}
