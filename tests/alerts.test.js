// Alerts: due windows, month-end rollover, short months, badge, desktop notifications.
'use strict';
const { openPage, run, serve } = require('./_harness');

run('alerts', async (t, browser) => {
  // --- A: mid-month. Rent (1st) and Pet Supplies (10th) are past due on the 12th; Internet (13th) is tomorrow.
  {
    const { ctx, page, errs } = await openPage(browser, { clock: '2026-08-12T10:00:00' });
    const occ = await page.evaluate(() => BB.dueOccurrences().map(o => [o.bill.name, o.kind, o.days, o.ym]));
    const overdue = occ.filter(o => o[1] === 'overdue').map(o => o[0]).sort();
    const soon = occ.filter(o => o[1] !== 'overdue').map(o => `${o[0]}:${o[2]}`);
    t.ok('A overdue = Rent + Pet Supplies', JSON.stringify(overdue) === JSON.stringify(['Pet Supplies', 'Rent']), overdue.join(','));
    t.ok('A due soon (lead 3) = Internet tomorrow', JSON.stringify(soon) === JSON.stringify(['Internet:1']), soon.join(','));
    const h = (await page.textContent('.abar.od .abar-h')).replace(/\s+/g, ' ');
    t.ok('A past-due banner text', /2 bills past due/.test(h) && /\$2,450\.00 outstanding/.test(h), h.trim());
    t.ok('A tab title badge', (await page.title()) === '(2) Bills & Budgets', await page.title());

    await page.selectOption('#leadSel', '7');
    await page.waitForTimeout(120);
    const soon2 = await page.$$eval('.abar.soon .apill', e => e.map(x => x.textContent.replace(/Mark paid/, '').trim()));
    t.ok('A lead=7 pulls in Car Insurance (17th)', soon2.length === 2 && /Car Insurance/.test(soon2[1]), soon2.join(' | '));
    await page.reload(); await page.waitForTimeout(300);
    t.ok('A lead setting persists', (await page.inputValue('#leadSel')) === '7');

    await page.click('.abar.od .apill');
    await page.waitForTimeout(150);
    t.ok('A pill marks paid and the banner shrinks', /1 bill past due/.test(await page.textContent('.abar.od .abar-h')));
    t.ok('A checklist agrees', /^1 of 7 paid/.test(await page.textContent('#paidCounter')));
    t.ok('A no console errors', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  // --- B: month-end rollover. On Aug 29, Rent due Sep 1 is 3 days out.
  {
    const { ctx, page, errs } = await openPage(browser, { clock: '2026-08-29T09:00:00' });
    const occ = await page.evaluate(() => BB.dueOccurrences().map(o => [o.bill.name, o.kind, o.days, o.ym]));
    const next = occ.filter(o => o[3] === '2026-09');
    t.ok('B next-month bills enter the window', next.length === 1 && next[0][0] === 'Rent' && next[0][2] === 3, JSON.stringify(next));
    const pill = await page.$('.apill[data-ym="2026-09"]');
    await pill.click();
    await page.waitForTimeout(150);
    const pm = await page.evaluate(() => BB.state.bills.find(b => b.id === 'rent').paidMonths);
    t.ok('B marking it writes September, not August', pm['2026-09'] === true && pm['2026-08'] === undefined, JSON.stringify(pm));
    t.ok('B no console errors', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  // --- C: a due day of 31 lands on the last day of a short month.
  {
    const { ctx, page, errs } = await openPage(browser, { clock: '2027-02-28T09:00:00' });
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('billsBudgets.v1'));
      s.bills.push({ id: 'eom', name: 'EOM Test', totalAmount: 80, period: 'MONTHLY', dueDay: 31, isActive: true, splits: null, paidMonths: {} });
      localStorage.setItem('billsBudgets.v1', JSON.stringify(s));
    });
    await page.reload(); await page.waitForTimeout(300);
    const occ = await page.evaluate(() => BB.dueOccurrences().filter(o => o.bill.id === 'eom').map(o => [o.kind, o.days, o.ym]));
    t.ok('C dueDay 31 clamps to Feb 28 = due today', occ.some(o => o[0] === 'today' && o[2] === '2027-02'), JSON.stringify(occ));
    const today = await page.$$eval('#checklist .cl-row.today .cl-name', e => e.map(x => x.textContent));
    t.ok('C checklist flags it due today', today.includes('EOM Test'), today.join(','));
    t.ok('C no console errors', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  // --- D: everything paid -> all clear.
  {
    const { ctx, page } = await openPage(browser, { clock: '2026-08-12T10:00:00' });
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('billsBudgets.v1'));
      s.bills.forEach(b => { b.paidMonths['2026-08'] = true; b.paidMonths['2026-09'] = true; });
      localStorage.setItem('billsBudgets.v1', JSON.stringify(s));
    });
    await page.reload(); await page.waitForTimeout(300);
    t.ok('D all-clear banner', await page.isVisible('.abar.clear'));
    t.ok('D title has no badge', (await page.title()) === 'Bills & Budgets');
    await ctx.close();
  }

  // --- E: desktop notifications (API stubbed; needs an http origin).
  {
    const server = serve(8421);
    const { ctx, page, errs } = await openPage(browser, { clock: '2026-08-12T10:00:00', url: 'http://127.0.0.1:8421/', permissions: ['notifications'] });
    await page.evaluate(() => {
      window.__n = [];
      window.Notification = function (t, o) { window.__n.push([t, o && o.body]); this.close = function () {}; };
      window.Notification.permission = 'granted';
      window.Notification.requestPermission = () => Promise.resolve('granted');
    });
    await page.click('#btnBell');
    await page.waitForTimeout(200);
    const fired = await page.evaluate(() => window.__n);
    t.ok('E enabling fires a summary notification', fired.length === 1 && /past due/.test(fired[0][0]), JSON.stringify(fired[0]));
    t.ok('E bell shows on', /Reminders on/.test(await page.textContent('#btnBell')));
    await page.evaluate(() => BB.fireNotification(false));
    await page.waitForTimeout(100);
    t.ok('E at most one per day', (await page.evaluate(() => window.__n.length)) === 1);
    await page.click('#btnBell');
    await page.waitForTimeout(150);
    t.ok('E bell toggles off', /Reminders off/.test(await page.textContent('#btnBell')));
    t.ok('E no console errors', errs.length === 0, errs.join(' | '));
    await ctx.close();
    server.close();
  }
});
