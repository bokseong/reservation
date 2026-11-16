import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'public/js/menu.js');
const target = resolve(root, 'functions/menu.js');
const content = await readFile(source, 'utf8');
const banner = '// GENERATED FROM public/js/menu.js. Run `npm run sync:menu` after editing the menu.\n';

await writeFile(target, banner + content.replace(/^\/\/ 메뉴를 변경할 때[^\n]*\n\/\/ id는[^\n]*\n/, ''), 'utf8');
