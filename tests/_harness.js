// Shared harness for the browser test suites.
// Run everything with `npm test`, or one suite with `node tests/<name>.test.js`.
'use strict';

const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');

const APP = path.resolve(__dirname, '..', 'index.html');

// Every suite loads the app over http from a throwaway local server: Chromium
// does not persist file:// localStorage reliably across reloads, and http is
// what real use looks like anyway.
const appServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(fs.readFileSync(APP));
}).listen(0, '127.0.0.1');
function appUrl() {
  return new Promise(resolve => {
    const done = () => resolve(`http://127.0.0.1:${appServer.address().port}/`);
    appServer.listening ? done() : appServer.once('listening', done);
  });
}

// Freeze the page clock so due-date and month-rollover logic is deterministic.
function clockScript(iso) {
  return `{
    const F = new Date('${iso}').getTime();
    const R = Date;
    class D extends R { constructor(...a){ a.length ? super(...a) : super(F); } static now(){ return F; } }
    window.Date = D;
  }`;
}

// Serve index.html over http (file:// localStorage is not reliable across reloads in Chromium).
function serve(port, host = '127.0.0.1', body) {
  return http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(body ? body() : fs.readFileSync(APP));
  }).listen(port, host);
}

class Suite {
  constructor(name) { this.name = name; this.results = []; }
  ok(label, cond, extra) {
    this.results.push({ pass: !!cond, label, extra });
  }
  report() {
    for (const r of this.results) {
      const tail = r.extra !== undefined ? '  -> ' + r.extra : '';
      console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.label}${tail}`);
    }
    const failed = this.results.filter(r => !r.pass).length;
    console.log(`\n${this.name}: ${this.results.length - failed}/${this.results.length} passed, FAILURES: ${failed}`);
    return failed;
  }
}

async function openPage(browser, opts = {}) {
  const ctx = await browser.newContext({
    viewport: opts.viewport || { width: 1280, height: 950 },
    permissions: opts.permissions || [],
  });
  if (opts.clock) await ctx.addInitScript(clockScript(opts.clock));
  // Tests start from empty storage; mark the first-run welcome as seen unless a test wants it.
  if (!opts.welcome) await ctx.addInitScript(`try{ localStorage.setItem('householdBills.welcomed','1'); }catch(e){}`);
  for (const s of opts.init || []) await ctx.addInitScript(s);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(opts.url || await appUrl());
  await page.waitForTimeout(opts.settle || 350);
  return { ctx, page, errs };
}

// Poll for text in an element, for async paths (file restore etc.).
async function waitText(page, selector, re, ms = 6000) {
  const end = Date.now() + ms;
  let last = '';
  while (Date.now() < end) {
    last = (await page.textContent(selector).catch(() => '')) || '';
    if (re.test(last)) return last;
    await page.waitForTimeout(100);
  }
  return last;
}

// Open Settings on a given pane (people | data | reminders | appearance | about).
async function openSettings(page, pane) {
  await page.evaluate(p => BB.openSettings(p), pane);
  await page.waitForTimeout(120);
}
async function closeSettings(page) {
  await page.click('#settingsClose');
  await page.waitForTimeout(100);
}

async function setInput(page, selector, value) {
  await page.fill(selector, value);
  await page.dispatchEvent(selector, 'change');
  await page.waitForTimeout(150);
}

async function run(name, body) {
  const suite = new Suite(name);
  const browser = await chromium.launch();
  try {
    await body(suite, browser);
  } catch (e) {
    suite.ok('suite completed without throwing', false, e && e.message);
    console.error(e);
  } finally {
    await browser.close();
    appServer.close();
  }
  const failed = suite.report();
  if (require.main === module.parent) process.exitCode = failed ? 1 : 0;
  return failed;
}

module.exports = { chromium, APP, appUrl, clockScript, serve, Suite, openPage, waitText, setInput, openSettings, closeSettings, run };
