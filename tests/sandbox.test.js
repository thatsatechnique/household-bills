// Sandboxed environments: cross-origin iframe (no file picker) and blocked storage.
'use strict';
const { openPage, run, serve } = require('./_harness');

run('sandbox', async (t, browser) => {
  const app = serve(8441, '127.0.0.1');
  const host = serve(8442, 'localhost', () =>
    '<!doctype html><title>host</title><body style="margin:0">' +
    '<iframe id="f" src="http://127.0.0.1:8441/" style="width:1200px;height:900px;border:0"></iframe>');

  // --- A: cross-origin iframe
  {
    const { ctx, page, errs } = await openPage(browser, { clock: '2026-08-12T10:00:00', url: 'http://localhost:8442/', settle: 700 });
    const frame = page.frames().find(f => f.url().includes('8441'));
    t.ok('A app loaded in a cross-origin frame', !!frame);
    const chip = (await frame.textContent('#storageChip')).replace(/\s+/g, ' ').trim();
    t.ok('A chip reports preview mode', /Preview panel/.test(chip), chip);
    t.ok('A no file-picker buttons offered', !(await frame.$('#stNew')) && !(await frame.$('#stOpen')));
    t.ok('A Export offered instead', !!(await frame.$('#stExp')));
    t.ok('A explanatory tooltip', /browser tab/.test(await frame.getAttribute('#storageChip', 'title')));
    t.ok('A app still functions', (await frame.$$eval('.card', e => e.length)) > 5 && /\$1,764\.00/.test(await frame.textContent('#tiles')));
    await frame.click('#tabRep'); await frame.waitForTimeout(300);
    t.ok('A reports still render', (await frame.$$eval('#chart path', e => e.length)) > 0);
    const res = await frame.evaluate(async () => { try { await window.showSaveFilePicker({ suggestedName: 'x.json' }); return 'resolved'; } catch (e) { return e.name; } });
    t.ok('A the picker really is blocked here', res === 'SecurityError', res);
    t.ok('A no unhandled errors', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  // --- B: same build, top level
  {
    const { ctx, page, errs } = await openPage(browser, { url: 'http://127.0.0.1:8441/' });
    t.ok('B top-level offers Save to a file', !!(await page.$('#stNew')));
    t.ok('B no errors', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  // --- C: storage blocked entirely
  {
    const deny = `{
      const boom = () => { throw new DOMException('denied', 'SecurityError'); };
      Object.defineProperty(window, 'localStorage', { configurable: true, get(){ return { getItem: boom, setItem: boom, removeItem: boom }; } });
    }`;
    const { ctx, page, errs } = await openPage(browser, { clock: '2026-08-12T10:00:00', url: 'http://127.0.0.1:8441/', init: [deny], settle: 600 });
    t.ok('C app boots with no storage', (await page.$$eval('.card', e => e.length)) > 5);
    t.ok('C chip warns changes are not saved', /not being saved/.test(await page.textContent('#storageChip')));
    for (const v of ['1', '2', '3']) {
      await page.fill('#checklist input[data-actual="water"]', v);
      await page.dispatchEvent('#checklist input[data-actual="water"]', 'change');
      await page.waitForTimeout(120);
    }
    t.ok('C edits still work in memory', (await page.evaluate(() => BB.state.bills.find(b => b.id === 'water').actuals['2026-08'])) === 3);
    t.ok('C no errors with storage denied', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  app.close(); host.close();
});
