/** Rebuild original Blender models without depending on a user's install path. */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const builder = fileURLToPath(new URL('./build_assets.py', import.meta.url));
const names = process.argv.slice(2);
if (names.some(name => !['speeder', 'atlas'].includes(name))) {
  console.error('Usage: npm run art:models -- [speeder] [atlas]');
  process.exit(1);
}
const result = spawnSync(process.env.BLENDER || 'blender', [
  '--background', '--python', builder, ...(names.length ? ['--', ...names] : []),
], { cwd: root, stdio: 'inherit', windowsHide: true });
if (result.error) {
  console.error('Blender could not be launched. Install Blender 5.2 or set BLENDER to its executable path.');
  console.error(result.error.message);
}
process.exit(result.status ?? 1);
