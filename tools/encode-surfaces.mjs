import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

mkdirSync('public/assets/textures', { recursive: true });
for (const surface of ['sand', 'rock']) for (const channel of ['color', 'normal', 'orm']) {
  const name = `${surface}-${channel}`;
  const result = spawnSync(process.execPath, ['tools/encode-texture.mjs', '-file', `/work/art/surfaces/${name}.png`, '-output_file', `/work/public/assets/textures/${name}.ktx2`, '-uastc', '-uastc_level', '1', '-mipmap', '-ktx2', '-no_multithreading', ...(channel === 'color' ? [] : ['-linear'])], { stdio: 'inherit' });
  if (result.status) process.exit(result.status);
}
