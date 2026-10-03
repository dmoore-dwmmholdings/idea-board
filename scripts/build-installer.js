#!/usr/bin/env node
// Builds install.ps1: a self-contained Windows installer with the app embedded. Commit it after changing the app.
//
//   node scripts/build-installer.js            # write install.ps1
//   node scripts/build-installer.js --serve    # also serve it on the LAN and print the one-liner
//   node scripts/build-installer.js --serve --seed  # also embed data/ideas.json in the served copy (used only if the server has no data yet)
//   --port 8080                                # port for --serve
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const TEMPLATE = path.join(__dirname, 'install.template.ps1');
const OUT = path.join(ROOT, 'install.ps1');
const SEED_FILE = path.join(ROOT, 'data', 'ideas.json');

const args = process.argv.slice(2);
const serve = args.includes('--serve');
const seed = args.includes('--seed');
const portArg = args.indexOf('--port');
const SERVE_PORT = portArg === -1 ? 8080 : Number(args[portArg + 1]);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.')) return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function build() {
  const files = [path.join(ROOT, 'server.js'), path.join(ROOT, 'package.json'), ...walk(path.join(ROOT, 'public'))];
  const entries = files
    .map((file) => {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      return `  '${rel}' = '${fs.readFileSync(file).toString('base64')}'`;
    })
    .join('\n');
  const seedData = seed && fs.existsSync(SEED_FILE) ? fs.readFileSync(SEED_FILE).toString('base64') : '';

  const template = fs.readFileSync(TEMPLATE, 'utf8').replace('__FILES__', () => entries);
  // install.ps1 is committed to a public repo, so seed data only ever goes into the served copy.
  fs.writeFileSync(OUT, template.replace('__SEED__', ''));
  const script = template.replace('__SEED__', () => seedData);
  return { script, count: files.length, seeded: Boolean(seedData) };
}

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'))
    .map((a) => a.address);
}

const { count, seeded } = build();
console.log(`Built ${path.relative(process.cwd(), OUT)} (${count} files)${seeded && serve ? ' - serving it with seed data' : ''}`);

if (serve) {
  // Rebuild on every request so edits are picked up without restarting.
  http
    .createServer((req, res) => {
      if (req.url !== '/install.ps1') {
        res.writeHead(404);
        return res.end();
      }
      console.log(`${new Date().toLocaleTimeString()}  ${req.socket.remoteAddress} fetched the installer`);
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(build().script);
    })
    .listen(SERVE_PORT, '0.0.0.0', () => {
      console.log('\nOn the Windows server, in PowerShell run as Administrator:\n');
      for (const ip of lanAddresses()) console.log(`  irm http://${ip}:${SERVE_PORT}/install.ps1 | iex`);
      console.log('\nOr from cmd run as Administrator:\n');
      for (const ip of lanAddresses()) {
        console.log(`  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm http://${ip}:${SERVE_PORT}/install.ps1 | iex"`);
      }
      console.log('\nCtrl+C to stop serving.');
    });
}
