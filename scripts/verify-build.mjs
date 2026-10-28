import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const distDir = join(projectRoot, 'dist');

const failures = [];

function fail(message) {
  failures.push(message);
}

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
  fail('dist/ directory is missing - run `npm run build` first.');
} else {
  const files = listFiles(distDir);
  const htmlFiles = files.filter((file) => file.toLowerCase().endsWith('.html'));
  const jsFiles = files.filter((file) => file.toLowerCase().endsWith('.js'));
  const cssFiles = files.filter((file) => file.toLowerCase().endsWith('.css'));

  if (htmlFiles.length !== 1) {
    fail(`expected exactly one HTML file in dist/, found ${htmlFiles.length}`);
  } else if (relative(distDir, htmlFiles[0]).replace(/\\/g, '/') !== 'index.html') {
    fail(`the only HTML file must be dist/index.html, found ${relative(distDir, htmlFiles[0])}`);
  }

  if (jsFiles.length === 0) {
    fail('no JavaScript bundle found in dist/');
  }
  for (const file of jsFiles) {
    if (statSync(file).size === 0) {
      fail(`JavaScript bundle is empty: ${relative(distDir, file)}`);
    }
  }

  if (cssFiles.length === 0) {
    fail('no CSS bundle found in dist/');
  }
  for (const file of cssFiles) {
    if (statSync(file).size === 0) {
      fail(`CSS bundle is empty: ${relative(distDir, file)}`);
    }
  }

  const indexHtml = join(distDir, 'index.html');
  if (existsSync(indexHtml)) {
    const html = readFileSync(indexHtml, 'utf8');
    if (!html.includes('dual-orbit:demo')) {
      fail('dist/index.html is missing the dual-orbit:demo meta marker');
    }
    if (!html.includes('content="n8n-workflows"')) {
      fail('dist/index.html is missing the n8n-workflows demo marker value');
    }
  }
}

if (failures.length > 0) {
  console.error('VERIFY_FAILED n8n-workflows');
  for (const failure of failures) {
    console.error(` - ${failure}`);
  }
  process.exit(1);
}

console.log('VERIFY_OK n8n-workflows');
