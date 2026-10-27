import { createServer } from 'node:http';
import { createApp } from './app.mjs';

const port = Number(process.env.PORT ?? 3020);
const host = process.env.HOST ?? '127.0.0.1';
const dataDir = process.env.DATA_DIR ?? '/opt/darwish-kitchen/data';

const app = createApp({ dataDir });
const server = createServer(app);
server.requestTimeout = 120_000;
server.listen(port, host, () => console.log(`Darwish Kitchen API on http://${host}:${port} (data: ${dataDir})`));

const stop = () => server.close(() => {
  app.close();
  process.exit(0);
});
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
