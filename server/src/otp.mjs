import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

const DEV_TTL_SECONDS = 5 * 60;

const hashCode = (phone, code) => createHash('sha256').update(`${phone}:${code}`).digest();

async function post(url, token, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Darwish OTP ${res.status}: ${data.message ?? data.error ?? 'error'}`);
  return data;
}

/**
 * Sends and checks login codes.
 * - `url` set: the Darwish OTP platform (same one the Quran site uses) generates, sends (WhatsApp) and checks the code:
 *     POST {url}                 {phone}              → {request_id, expires_in}
 *     POST {url with /send→/verify} {request_id, code} → {valid}
 * - `devCodes`: local codes passed to `onDevCode` (tests and local development only).
 * - neither: disabled.
 */
export function createOtp({ url, token, devCodes = false, onDevCode = (phone, code) => console.log(`[DEV OTP] ${phone}: ${code}`) }) {
  const verifyUrl = url ? url.replace(/\/send\/?\s*$/, '/verify') : null;
  return {
    enabled: !!url || devCodes,

    /** Returns what to store for this phone: {requestId} or {codeHash}, plus expiresIn seconds. */
    async send(phone) {
      if (url) {
        const data = await post(url, token, { phone });
        if (!data.request_id) throw new Error('Darwish OTP: no request_id');
        return { requestId: String(data.request_id), expiresIn: Number(data.expires_in ?? DEV_TTL_SECONDS) };
      }
      if (!devCodes) throw new Error('otp-disabled');
      const code = String(randomInt(100000, 1000000));
      onDevCode(phone, code);
      return { codeHash: hashCode(phone, code).toString('hex'), expiresIn: DEV_TTL_SECONDS };
    },

    /** True when `code` matches the stored request. */
    async check(phone, record, code) {
      if (record.request_id) {
        if (!verifyUrl) return false;
        const data = await post(verifyUrl, token, { request_id: record.request_id, code });
        return data.valid === true;
      }
      if (!record.code_hash) return false;
      return timingSafeEqual(hashCode(phone, code), Buffer.from(record.code_hash, 'hex'));
    },
  };
}

/** Egyptian local numbers (01xxxxxxxxx) become 201xxxxxxxxx; others need the country code. Returns digits or null. */
export function normalizePhone(raw) {
  if (typeof raw !== 'string') return null;
  let p = raw.replace(/[\s\-().]/g, '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  if (p.startsWith('+')) p = p.slice(1);
  else if (p.startsWith('00')) p = p.slice(2);
  else if (/^01\d{9}$/.test(p)) p = `20${p.slice(1)}`;
  return /^[1-9]\d{7,14}$/.test(p) ? p : null;
}
