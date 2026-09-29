// Opt-in, local-only video capture transport for the managed runtime.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export function campCapturePlugin() {
  return {
    name: 'prometheus-video-capture',
    apply: 'serve',
    configureServer(server) {
      const pending = new Map();
      server.ws.on('camp-video:result', ({ id, result }) => {
        pending.get(id)?.(result);
        pending.delete(id);
      });
      server.middlewares.use('/__camp-video', async (req, res) => {
        if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) || req.method !== 'POST') {
          res.writeHead(403).end(); return;
        }
        try {
          const chunks = []; let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 100_000_000) throw new Error('Capture exceeds size limit');
            chunks.push(chunk);
          }
          const body = Buffer.concat(chunks);
          const url = new URL(req.url, 'https://localhost');
          const name = url.searchParams.get('name');
          if (name) {
            if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Invalid capture name');
            const folder = resolve('design/verify/videos');
            await mkdir(folder, { recursive: true });
            await writeFile(resolve(folder, `${name}.webm`), body);
            res.writeHead(200).end(JSON.stringify({ saved: name, bytes: size })); return;
          }
          const command = JSON.parse(body.toString());
          if (!['start', 'stop', 'view', 'status', 'click-enter'].includes(command.action)) throw new Error('Unknown action');
          const id = crypto.randomUUID();
          const result = await new Promise((resolveResult, reject) => {
            const timer = setTimeout(() => { pending.delete(id); reject(new Error('Runtime capture timed out')); }, 20000);
            pending.set(id, value => { clearTimeout(timer); resolveResult(value); });
            server.ws.send('camp-video:command', { id, ...command });
          });
          res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
        } catch (error) { res.writeHead(500).end(JSON.stringify({ error: String(error) })); }
      });
    },
  };
}
