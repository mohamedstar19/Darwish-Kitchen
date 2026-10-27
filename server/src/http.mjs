/** Small HTTP helpers shared by the API modules. */

export class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export function send(res, status, body, headers = {}) {
  const isJson = body !== undefined && !Buffer.isBuffer(body);
  res.writeHead(status, {
    ...(isJson ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(body === undefined ? undefined : isJson ? JSON.stringify(body) : body);
}

export async function readBody(req, max) {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > max) throw new HttpError(413, 'too-large');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new HttpError(413, 'too-large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req, max = 64 * 1024) {
  if (!String(req.headers['content-type'] ?? '').includes('application/json')) throw new HttpError(415, 'json-required');
  try {
    return JSON.parse((await readBody(req, max)).toString('utf8'));
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, 'bad-json');
  }
}

export function clientIp(req) {
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '');
  // Only trust proxy headers when the request came through the local nginx.
  if (local) return String(req.headers['cf-connecting-ip'] ?? req.headers['x-real-ip'] ?? req.socket.remoteAddress);
  return req.socket.remoteAddress ?? 'unknown';
}
