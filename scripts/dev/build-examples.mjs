#!/usr/bin/env node
/**
 * build-examples.mjs — regenerate the committed sample scripts in /scripts
 * from the shared test fixture. Run from the repo root after changing either
 * generator:
 *
 *   node scripts/dev/build-examples.mjs
 *
 * core/test/scripts.test.js has a sync test that fails when these files are
 * stale.
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FIXTURE } from '../../core/test/fixture.js';
import { generatePyGMT } from '../../core/src/scripts/pygmt.js';
import { generateRScript } from '../../core/src/scripts/rscript.js';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await writeFile(path.join(dir, 'example-figure.py'), generatePyGMT(FIXTURE));
await writeFile(path.join(dir, 'example-figure.R'), generateRScript(FIXTURE));
console.log('wrote scripts/example-figure.py and scripts/example-figure.R');
