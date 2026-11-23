// `npm run dev:lan` / `npm run preview:lan`: run Vite bound to THIS machine's private LAN address only (not 0.0.0.0, no
// tunnel, no public URL), print the address and a QR code for the phone. The plugin also refuses non-local clients.
import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import qrcode from 'qrcode-terminal';

const PRIVATE = [/^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./];

export function privateAddresses(ifs = networkInterfaces()): { name: string; address: string }[] {
  const out: { name: string; address: string }[] = [];
  for (const [name, list] of Object.entries(ifs)) {
    for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal && PRIVATE.some((r) => r.test(i.address))) out.push({ name, address: i.address });
  }
  return out;
}

function main(): void {
  const mode = process.argv[2] === 'preview' ? 'preview' : 'dev';
  const found = privateAddresses();
  if (found.length === 0) {
    console.error('Không thấy địa chỉ mạng nội bộ (10.x / 172.16-31.x / 192.168.x). Kết nối Wi-Fi rồi chạy lại. Không mở ra ngoài mạng nội bộ.');
    process.exit(1);
  }
  const pick = found.find((f) => /^(en|wlan|wl)/.test(f.name)) ?? found[0]!;
  const port = mode === 'preview' ? 4173 : 5173;
  const url = `http://${pick.address}:${port}/`;
  console.log(`\n  Tiên Nghịch 2D (${mode}) chỉ mở trong mạng nội bộ qua ${pick.name}.\n  Trên điện thoại (cùng Wi-Fi) mở:  ${url}\n`);
  qrcode.generate(url, { small: true });
  console.log('\n  Ctrl+C để dừng. Hướng dẫn: docs/PLAYTEST_LAN.md\n');
  const root = fileURLToPath(new URL('..', import.meta.url));
  const vite = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
  const args = mode === 'preview' ? [vite, 'preview'] : [vite];
  const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit', env: { ...process.env, TN2D_HOST: pick.address } });
  child.on('exit', (code) => process.exit(code ?? 0));
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => child.kill(sig));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
