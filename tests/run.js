#!/usr/bin/env node
// Runs every *.test.js in this directory in sequence and exits non-zero on any failure.
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.js')).sort();
let failed = 0;
const summary = [];

for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(dir, f)], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/FAILURES: (\d+)/);
  const n = m ? parseInt(m[1], 10) : 1;
  failed += n;
  if (n || r.status) {
    console.log(out);
  } else {
    const line = out.split('\n').find(l => /passed, FAILURES/.test(l));
    console.log(line || out);
  }
  summary.push(`${n === 0 && !r.status ? 'ok  ' : 'FAIL'} ${f}`);
}

console.log('\n' + summary.join('\n'));
process.exit(failed ? 1 : 0);
