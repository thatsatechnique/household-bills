// Set-aside funds and billing cycles: quarterly/yearly bills, accrual vs cash reporting.
'use strict';
const { openPage, run, setInput } = require('./_harness');

const trash = () => 'BB.state.bills.find(b => b.id === "trash")';

run('set-aside', async (t, browser) => {
  // --- A/B: August. Trash Service is $120 quarterly, billed Jan/Apr/Jul/Oct.
  {
    const { ctx, page, errs } = await openPage(browser, { clock: '2026-08-12T10:00:00' });
    const tr = await page.evaluate(() => BB.state.bills.find(b => b.id === 'trash'));
    t.ok('A quarterly seed: 120, Jan cycle, 60/60', tr.totalAmount === 120 && tr.billMonth === 1 && tr.splits[0].amount === 60);
    const cyc = await page.evaluate(() => { const b = BB.state.bills.find(x => x.id === 'trash'); return [...Array(12).keys()].map(m => BB.billsInMonth(b, 2026, m)); });
    t.ok('A cycle = Jan/Apr/Jul/Oct', cyc.map((v, i) => v ? i + 1 : 0).filter(Boolean).join(',') === '1,4,7,10');
    t.ok('A August checklist omits it', !(await page.$$eval('#checklist .cl-name', e => e.map(x => x.textContent))).includes('Trash Service'));
    await page.evaluate(() => BB.setMonth(2026, 9));
    await page.waitForTimeout(150);
    t.ok('A October checklist includes it', (await page.$$eval('#checklist .cl-name', e => e.map(x => x.textContent))).includes('Trash Service'));
    await page.evaluate(() => BB.setMonth(2026, 7));
    await page.waitForTimeout(120);
    const chips = await page.$$eval('.card', els => [...els.find(e => e.textContent.includes('Trash Service')).querySelectorAll('.chip')].map(c => c.textContent));
    t.ok('A card shows the billing months', chips.includes('Jan · Apr · Jul · Oct'), chips.join(' | '));

    // seeded on track: next bill Oct (2 months out) at $40/mo -> $40 banked now
    const st = await page.evaluate(() => BB.fundStatus(BB.state.bills.find(b => b.id === 'trash')));
    t.ok('B seeded balance leaves it on track', st.balance === 40 && st.monthly === 40, `${st.balance}/${st.monthly}`);
    t.ok('B next due is October', st.nextIdx === 2026 * 12 + 9 && st.monthsUntil === 2);
    t.ok('B projection lands on the amount due', st.projected === 120 && st.state === 'ontrack', `${st.projected} ${st.state}`);
    const card = await page.textContent('#funds');
    t.ok('B panel shows balance of need', /\$40\.00/.test(card) && /set aside of \$120\.00/.test(card));
    t.ok('B panel shows per-person contribution', /Alex \$20\.00 \/ Sam \$20\.00/.test(card));
    t.ok('B On track chip', /On track/.test(await page.textContent('.fund-state')));
    t.ok('B payments recorded in future months are ignored', (await page.evaluate(() => { const b = BB.state.bills.find(x => x.id === 'trash'); b.actuals['2026-12'] = 999; return BB.fundStatus(b).balance; })) === 40);
    t.ok('A/B no console errors', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  // --- C/D: October is a billing month.
  {
    const { ctx, page, errs } = await openPage(browser, { clock: '2026-10-05T09:00:00' });
    const s0 = await page.evaluate(() => BB.fundStatus(BB.state.bills.find(b => b.id === 'trash')));
    t.ok('C full amount banked in a billing month', s0.balance === 120 && s0.monthsUntil === 0 && s0.state === 'funded');
    t.ok('C Funded chip', /Funded/.test(await page.textContent('.fund-state')));
    await setInput(page, '#checklist input[data-actual="trash"]', '130');
    await page.waitForTimeout(150);
    const s1 = await page.evaluate(() => BB.fundStatus(BB.state.bills.find(b => b.id === 'trash')));
    t.ok('C paying draws the balance down', s1.balance === -10, s1.balance);
    t.ok('C next due rolls to January', s1.nextIdx === 2027 * 12);
    t.ok('C overpayment leaves it short by $10', s1.state === 'short' && s1.shortBy === 10);
    t.ok('C panel names the shortfall', /Short \$10\.00 at \$40\.00\/month/.test(await page.textContent('#funds')));
    await setInput(page, '#funds input[data-fund="trash"]', '80');
    await page.waitForTimeout(150);
    const s2 = await page.evaluate(() => BB.fundStatus(BB.state.bills.find(b => b.id === 'trash')));
    t.ok('D manual balance sticks', s2.balance === 80 && s2.state === 'ontrack', `${s2.balance} ${s2.state}`);
    await page.reload(); await page.waitForTimeout(400);
    t.ok('D correction survives reload', (await page.evaluate(() => BB.fundStatus(BB.state.bills.find(b => b.id === 'trash')).balance)) === 80);
    t.ok('C/D no console errors', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  // --- E: accrual vs cash
  {
    const { ctx, page, errs } = await openPage(browser, { clock: '2026-08-12T10:00:00' });
    await page.evaluate(() => {
      const b = BB.state.bills.find(x => x.id === 'trash');
      b.actuals['2026-01'] = 120; b.actuals['2026-04'] = 120; b.actuals['2026-07'] = 120;
      BB.render(); BB.setView('reports');
    });
    await page.waitForTimeout(300);
    const d = await page.evaluate(() => BB.reportData(2026));
    t.ok('E cash basis spikes in billing months', d.byMonth[0].actual === 120 && d.byMonth[1].actual === null);
    t.ok('E accrual spreads to 40/mo', [3, 4, 5].every(i => d.accrual[i].actual === 40), JSON.stringify(d.accrual.slice(0, 8).map(m => m.actual)));
    t.ok('E prior-year spill trimmed at January', d.accrual[0].actual === 40);
    t.ok('E accrual is the default', /on/.test(await page.getAttribute('#basisAccrual', 'class')));
    await page.click('#basisCash');
    await page.waitForTimeout(200);
    t.ok('E toggle switches to cash', /on/.test(await page.getAttribute('#basisCash', 'class')) && /Cash basis/.test(await page.textContent('#chartCap')));
    await page.reload(); await page.waitForTimeout(350);
    await page.click('#tabRep'); await page.waitForTimeout(250);
    t.ok('E basis preference persists', /on/.test(await page.getAttribute('#basisCash', 'class')));
    const off = await page.$$eval('#billTable tr', rows => [...rows.find(r => r.textContent.includes('Trash Service')).querySelectorAll('td.mcell')].map(td => td.classList.contains('offcycle')));
    t.ok('E off-cycle months dimmed', off.map((v, i) => v ? '' : i + 1).filter(Boolean).join(',') === '1,4,7,10');
    t.ok('E no console errors', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  // --- F: modal cycle field
  {
    const { ctx, page, errs } = await openPage(browser, { clock: '2026-08-12T10:00:00' });
    await page.click('[data-edit="rent"]'); await page.waitForTimeout(200);
    t.ok('F cycle field hidden for a monthly bill', !(await page.isVisible('#fBillMonth')));
    await page.click('#billCancel'); await page.waitForTimeout(150);
    await page.click('[data-edit="trash"]'); await page.waitForTimeout(200);
    t.ok('F cycle field shown for quarterly, prefilled', await page.isVisible('#fBillMonth') && (await page.inputValue('#fBillMonth')) === '1');
    t.ok('F hint explains the set-aside', /Set aside \$40\.00\/month/.test(await page.textContent('#billMonthHint')));
    await page.selectOption('#fBillMonth', '2'); await page.waitForTimeout(120);
    t.ok('F hint follows the cycle', /Feb · May · Aug · Nov/.test(await page.textContent('#billMonthHint')));
    await page.click('#billSave'); await page.waitForTimeout(250);
    const b = await page.evaluate(() => BB.state.bills.find(x => x.id === 'trash'));
    t.ok('F cycle saved and fund re-seeded', b.billMonth === 2 && b.fund && b.fund.asOf === '2026-08');
    const st = await page.evaluate(() => BB.fundStatus(BB.state.bills.find(x => x.id === 'trash')));
    t.ok('F August now a billing month -> fully banked', st.monthsUntil === 0 && st.balance === 120);
    t.ok('F back on the August checklist', (await page.$$eval('#checklist .cl-name', e => e.map(x => x.textContent))).includes('Trash Service'));
    await page.click('[data-edit="trash"]'); await page.waitForTimeout(200);
    await page.selectOption('#fPeriod', 'MONTHLY'); await page.waitForTimeout(120);
    t.ok('F field hides when switched to monthly', !(await page.isVisible('#fBillMonth')));
    await page.click('#billSave'); await page.waitForTimeout(250);
    const b2 = await page.evaluate(() => BB.state.bills.find(x => x.id === 'trash'));
    t.ok('F monthly clears cycle and fund', b2.billMonth === null && b2.fund === null);
    t.ok('F set-aside panel hides with nothing to show', !(await page.isVisible('#funds')));
    t.ok('F no console errors', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  // --- G: yearly bill
  {
    const { ctx, page, errs } = await openPage(browser, { clock: '2026-08-12T10:00:00' });
    await page.click('#btnAdd'); await page.waitForTimeout(200);
    await page.fill('#fName', 'Property Tax');
    await page.fill('#fAmount', '3600');
    await page.selectOption('#fPeriod', 'YEARLY'); await page.waitForTimeout(120);
    await page.selectOption('#fBillMonth', '11');
    await page.fill('#fDueDay', '15'); await page.waitForTimeout(120);
    t.ok('G yearly hint', /once a year in Nov/.test(await page.textContent('#billMonthHint')) && /\$300\.00\/month/.test(await page.textContent('#billMonthHint')));
    await page.click('#billSave'); await page.waitForTimeout(300);
    const st = await page.evaluate(() => BB.fundStatus(BB.state.bills.find(b => b.name === 'Property Tax')));
    t.ok('G monthly set-aside 300, due in 3 months', st.monthly === 300 && st.monthsUntil === 3);
    t.ok('G seeded balance = need minus remaining contributions', st.balance === 2700 && st.state === 'ontrack');
    t.ok('G absent from the August checklist', !(await page.$$eval('#checklist .cl-name', e => e.map(x => x.textContent))).includes('Property Tax'));
    await page.evaluate(() => BB.setMonth(2026, 10)); await page.waitForTimeout(150);
    t.ok('G present in November', (await page.$$eval('#checklist .cl-name', e => e.map(x => x.textContent))).includes('Property Tax'));
    t.ok('G no console errors', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }
});
