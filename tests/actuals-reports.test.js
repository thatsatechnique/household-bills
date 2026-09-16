// Actuals + reports: inline entry, month navigation, year summary, by-bill grid, sparklines.
'use strict';
const { openPage, run, setInput } = require('./_harness');

const BUDGET_MO = 2400 + 180 + 150 + 80 + 40 + 60 + 16 + 50;   // 2976, trash normalized to 40

run('actuals-reports', async (t, browser) => {
  {
    const { ctx, page, errs } = await openPage(browser, { clock: '2026-08-12T10:00:00' });

    t.ok('month label defaults to current', (await page.textContent('#monthLabel')) === 'August 2026');

    await setInput(page, '#checklist input[data-actual="water"]', '68.42');
    const stored = await page.evaluate(() => BB.state.bills.find(b => b.id === 'water').actuals);
    t.ok('actual saved under the viewed month', stored['2026-08'] === 68.42, JSON.stringify(stored));
    const rowVar = await page.$eval('#checklist input[data-actual="water"]', el => el.closest('.cl-row').querySelector('.var').textContent);
    t.ok('variance shown on the row', rowVar === '+$8.42', rowVar);
    t.ok('counter notes recorded actuals', /1 actual recorded/.test(await page.textContent('#paidCounter')));
    await setInput(page, '#checklist input[data-actual="water"]', '');
    t.ok('blank clears the actual', (await page.evaluate(() => BB.state.bills.find(b => b.id === 'water').actuals['2026-08'])) === undefined);
    await setInput(page, '#checklist input[data-actual="water"]', '68.42');

    // month navigation
    await page.click('#monthPrev');
    await page.waitForTimeout(150);
    t.ok('previous month', (await page.textContent('#monthLabel')) === 'July 2026');
    t.ok('past-month notice', /past month/.test(await page.textContent('#paidCounter')));
    t.ok('actual field empty for the other month', (await page.inputValue('#checklist input[data-actual="water"]')) === '');
    await setInput(page, '#checklist input[data-actual="water"]', '57.10');
    const two = await page.evaluate(() => BB.state.bills.find(b => b.id === 'water').actuals);
    t.ok('months stored independently', two['2026-07'] === 57.1 && two['2026-08'] === 68.42, JSON.stringify(two));
    const flags = await page.$$eval('#checklist .cl-flag', e => e.map(x => x.textContent));
    t.ok('past month shows Unpaid rather than Past due', flags.length === 7 && flags.every(f => f === 'Unpaid'), `${flags.length}: ${[...new Set(flags)]}`);
    t.ok('July includes the quarterly bill', (await page.$$eval('#checklist .cl-name', e => e.map(x => x.textContent))).includes('Trash Service'));
    await page.click('#monthToday');
    await page.waitForTimeout(120);
    t.ok('Today returns to the current month', (await page.textContent('#monthLabel')) === 'August 2026');
    t.ok('past-due highlighting is back', (await page.$$eval('#checklist .cl-row.overdue', e => e.length)) === 2);

    // reports
    await page.click('#tabRep');
    await page.waitForTimeout(250);
    t.ok('reports view visible', await page.isVisible('#billTable'));
    t.ok('dashboard hidden', !(await page.isVisible('#checklist')));

    const d = await page.evaluate(() => BB.reportData(2026));
    t.ok('per-month budget total', Math.abs(d.byMonth[0].budget - BUDGET_MO) < 0.01, `${d.byMonth[0].budget} vs ${BUDGET_MO}`);
    t.ok('quarterly bill budgets at 1/3', Math.abs(d.rows.find(r => r.bill.id === 'trash').perMonth - 40) < 0.01);
    t.ok('budget to date = 8 elapsed months', Math.abs(d.budgetYtd - BUDGET_MO * 8) < 0.02, d.budgetYtd);
    t.ok('actual to date sums recorded months only', Math.abs(d.actualYtd - (68.42 + 57.10)) < 0.01, d.actualYtd);
    t.ok('unrecorded months are null, not zero', d.byMonth[0].actual === null && d.byMonth[6].actual === 57.1);
    t.ok('inactive bill contributes no budget', !d.rows.some(r => r.bill.id === 'household' && r.perMonth > 0));

    const tiles = await page.$$eval('#reportTiles .val', e => e.map(x => x.textContent));
    t.ok('four report tiles', tiles.length === 4 && tiles.every(v => /^[−+]?\$/.test(v)), tiles.join(' | '));
    t.ok('variance reads under budget', /under budget/.test((await page.$$eval('#reportTiles .sub', e => e.map(x => x.textContent)))[2]));

    t.ok('chart: 12 budget bars + 2 actual bars', (await page.$$eval('#chart path', e => e.length)) === 14);
    t.ok('chart: 12 hover bands', (await page.$$eval('#chart .hoverband', e => e.length)) === 12);
    t.ok('legend names both series', /Budgeted/.test(await page.textContent('#legendKeys')) && /Actual/.test(await page.textContent('#legendKeys')));
    await page.hover('#chart .hoverband[data-mi="7"]');
    await page.waitForTimeout(150);
    t.ok('tooltip shows budget, actual, variance', /Aug 2026/.test(await page.textContent('#vtip')) && /Under by/.test(await page.textContent('#vtip')));
    t.ok('tooltip visible on hover', (await page.$eval('#vtip', e => getComputedStyle(e).opacity)) === '1');
    t.ok('bar fill resolves to a colour', /^rgb/.test(await page.$eval('#chart path', e => getComputedStyle(e).fill)));

    t.ok('table: one row per reportable bill', (await page.$$eval('#billTable tbody tr', e => e.length)) === d.rows.length);
    t.ok('table: 18 columns', (await page.$$eval('#billTable thead th', e => e.length)) === 18);
    t.ok('sparkline for the bill with two months', (await page.$$eval('#billTable .spark', e => e.length)) === 1);
    t.ok('sparkline stroke resolves to a colour', /^rgb/.test(await page.$eval('#billTable .spark path', e => getComputedStyle(e).stroke)));

    await setInput(page, '#billTable input[data-cell="streaming"][data-ym="2026-03"]', '14.99');
    await page.waitForTimeout(150);
    t.ok('grid cell edit stored', Math.abs((await page.evaluate(() => BB.reportData(2026).actualYtd)) - (68.42 + 57.10 + 14.99)) < 0.01);
    t.ok('footer March total', (await page.$$eval('#billTable tfoot td', e => e.map(x => x.textContent)))[4] === '$14.99');

    await page.evaluate(() => { BB.setActual('rent', '2025-11', 2500); BB.render(); BB.setYear(2025); });
    await page.waitForTimeout(200);
    t.ok('year picker lists years with data', (await page.$$eval('#yearSel option', e => e.map(x => x.value))).join(',') === '2026,2025');
    const d3 = await page.evaluate(() => BB.reportData(2025));
    t.ok('prior year uses 12 elapsed months', d3.elapsed === 12 && d3.actualYtd === 2500);

    await page.reload(); await page.waitForTimeout(300);
    const after = await page.evaluate(() => BB.state.bills.find(b => b.id === 'water').actuals);
    t.ok('actuals survive reload', after['2026-08'] === 68.42 && after['2026-07'] === 57.1);

    await page.click('#tabRep');
    await page.waitForTimeout(200);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.waitForTimeout(250);
    t.ok('reports: no page-level overflow at 375px', (await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 1);
    t.ok('no console errors', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  // empty state
  {
    const { ctx, page, errs } = await openPage(browser, { clock: '2026-01-05T10:00:00' });
    await page.evaluate(() => { BB.state.bills.length = 0; BB.render(); BB.setView('reports'); });
    await page.waitForTimeout(200);
    t.ok('empty: reports render an empty state', /No bills to report/.test(await page.textContent('#billTable')));
    t.ok('empty: no console errors', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }
});
