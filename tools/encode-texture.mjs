import { WASI } from 'node:wasi';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Download the upstream single-thread WASI encoder separately; no native install required.
const wasi = new WASI({ version: 'preview1', args: ['basisu', ...process.argv.slice(2)], preopens: { '/work': resolve('.') }, returnOnExit: true });
const module = await WebAssembly.compile(await readFile(resolve('tmp/art-tools/basisu_st.wasm')));
const instance = await WebAssembly.instantiate(module, wasi.getImportObject());
process.exitCode = wasi.start(instance);
