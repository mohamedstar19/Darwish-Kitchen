import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { createApp } from './app.mjs';

// Secrets (OTP_URL, OTP_TOKEN) live in a root-managed file, not in PM2's saved process list.
const envFile = process.env.ENV_FILE ?? '/opt/darwish-kitchen/otp.env';
if (existsSync(envFile)) process.loadEnvFile(envFile);

const port = Number(process.env.PORT ?? 3020);
const host = process.env.HOST ?? '127.0.0.1';
const dataDir = process.env.DATA_DIR ?? '/opt/darwish-kitchen/data';

const app = createApp({
  dataDir,
  otp: {
    url: process.env.OTP_URL || undefined,
    token: process.env.OTP_TOKEN || undefined,
    // Local development only: print codes to the log instead of sending them.
    devCodes: process.env.OTP_DEV_CODES === '1',
  },
});
const server = createServer(app);
server.requestTimeout = 120_000;
server.listen(port, host, () =>
  console.log(`Darwish Kitchen API on http://${host}:${port} (data: ${dataDir}, OTP: ${process.env.OTP_URL ? 'Darwish OTP' : process.env.OTP_DEV_CODES === '1' ? 'dev codes' : 'NOT CONFIGURED'})`),
);

const stop = () => server.close(() => {
  app.close();
  process.exit(0);
});
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
