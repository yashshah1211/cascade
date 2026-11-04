import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFixtures } from '../cli/load.js';
import { traceImpact } from '../engine/impact.js';
import { evaluatePlan } from '../engine/evaluate.js';

const staticRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'web');
const port = Number(process.env.PORT ?? 4173);
const server = createServer(async (req, res) => {
  try {
    if (req.method !== 'GET') {
      res.writeHead(405); res.end('Read-only server'); return;
    }
    if (req.url === '/api/demo') {
      const { scenario, plans, disruption } = await loadFixtures();
      const body = JSON.stringify({
        mode: 'OFFLINE_SIMULATION', switchStatus: 'NOT_CONNECTED', scenario, disruption,
        impacted: traceImpact(scenario, disruption),
        evaluations: plans.map(plan => ({ plan, result: evaluatePlan(scenario, plan) })),
      });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(body); return;
    }
    if (req.url !== '/' && req.url !== '/index.html') { res.writeHead(404); res.end('Not found'); return; }
    const body = await readFile(join(staticRoot, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'" });
    res.end(body);
  } catch (e) {
    console.error(e);
    res.writeHead(500); res.end('Server error');
  }
});
server.listen(port, '127.0.0.1', () => console.log(`CASCADE read-only dashboard → http://127.0.0.1:${port}`));
