// Core: seed, contributions, split editor, people, export, theme, layout.
'use strict';
const { openPage, run, setInput } = require('./_harness');

// The seed, restated, so the expected contribution figures are derived rather than typed.
const SEED = [
  // [amount, monthly factor, alex %, sam %]
  [2400, 1, 60, 40],        // Rent
  [180, 1, 70, 30],         // Car Insurance
  [150, 1, 50, 50],         // Electric & Gas
  [80, 1, 50, 50],          // Internet
  [120, 1 / 3, 50, 50],     // Trash Service (quarterly)
  [60, 1, 50, 50],          // Water
  [16, 1, 50, 50],          // Streaming
];
const UNSPLIT = 50;         // Pet Supplies
const r2 = n => Math.round(n * 100) / 100;
const EXP = (() => {
  let alex = 0, sam = 0, total = UNSPLIT;
  for (const [amt, f, a, s] of SEED) { const m = amt * f; total += m; alex += m * a / 100; sam += m * s / 100; }
  return { alex: r2(alex), sam: r2(sam), total: r2(total) };
})();

run('core', async (t, browser) => {
  const { ctx, page, errs } = await openPage(browser, { clock: '2026-08-12T10:00:00', viewport: { width: 1200, height: 900 } });

  // --- seed + contributions
  t.ok('seed loads 9 bills', (await page.evaluate(() => BB.state.bills.length)) === 9);
  const c = await page.evaluate(() => BB.contributions());
  t.ok('Alex monthly', Math.abs(c.people[0].monthly - EXP.alex) < 0.01, `${c.people[0].monthly} vs ${EXP.alex}`);
  t.ok('Sam monthly', Math.abs(c.people[1].monthly - EXP.sam) < 0.01, `${c.people[1].monthly} vs ${EXP.sam}`);
  t.ok('household total', Math.abs(c.total - EXP.total) < 0.01, `${c.total} vs ${EXP.total}`);
  t.ok('unsplit bucket holds Pet Supplies', c.unsplit === UNSPLIT && c.unsplitCount === 1, c.unsplit);
  t.ok('quarterly normalized to 40/mo', Math.abs(c.total - (2400 + 180 + 150 + 80 + 40 + 60 + 16 + 50)) < 0.01);

  const sum = await page.evaluate(() => BB.splitSummary(BB.state.bills.find(b => b.id === 'rent')));
  t.ok('split summary, percent form', sum === 'Alex 60% ($1,440.00) / Sam 40% ($960.00)', sum);
  t.ok('split summary, unsplit', (await page.evaluate(() => BB.splitSummary(BB.state.bills.find(b => b.id === 'pet')))) === 'No split assigned');

  const tiles = await page.$$eval('#tiles .val', els => els.map(e => e.textContent));
  t.ok('tiles show exact cents', tiles.every(v => /^\$[\d,]+\.\d{2}$/.test(v)), tiles.join(' | '));
  const cardAmt = await page.$$eval('.card .amount', els => els.map(e => e.firstChild.textContent.trim()));
  t.ok('cards show whole dollars', cardAmt.every(v => /^\$[\d,]+$/.test(v)), cardAmt.slice(0, 4).join(' | '));

  // --- checklist ordering
  const names = await page.$$eval('#checklist .cl-name', e => e.map(x => x.textContent));
  const dues = await page.$$eval('#checklist .cl-due', e => e.map(x => x.textContent));
  t.ok('checklist excludes inactive bills', !names.includes('Household Misc'));
  t.ok('checklist excludes off-cycle quarterly bills', !names.includes('Trash Service'), names.join(','));
  t.ok('checklist has 7 rows in August', names.length === 7, names.length);
  const dueNums = dues.filter(d => d !== 'No due day').map(d => parseInt(d.replace(/\D/g, ''), 10));
  t.ok('checklist ascending by due day', dueNums.every((v, i, a) => i === 0 || a[i - 1] <= v), dueNums.join(','));
  t.ok('ordinal suffixes', dues.includes('Due 1st') && dues.includes('Due 13th') && dues.includes('Due 21st'), dues.join(' | '));

  // --- paid toggle persists
  await page.click('#checklist input[data-paid="water"]');
  await page.waitForTimeout(150);
  t.ok('paid counter updates', /^1 of 7 paid/.test(await page.textContent('#paidCounter')), await page.textContent('#paidCounter'));
  t.ok('paidMonths written', (await page.evaluate(() => BB.state.bills.find(b => b.id === 'water').paidMonths['2026-08'])) === true);
  await page.reload(); await page.waitForTimeout(300);
  t.ok('paid state survives reload', /^1 of 7 paid/.test(await page.textContent('#paidCounter')));
  t.ok('past-due rows highlighted (Rent 1st, Pet 10th)', (await page.$$eval('#checklist .cl-row.overdue', e => e.length)) === 2);

  // --- split editor: percent validation
  await page.click('[data-edit="rent"]');
  await page.waitForTimeout(150);
  t.ok('edit modal prefilled', (await page.inputValue('#fName')) === 'Rent' && (await page.inputValue('#fAmount')) === '2400');
  await page.fill('#splitRows input[data-pid="alex"]', '70');
  await page.waitForTimeout(80);
  t.ok('save blocked when percents != 100', (await page.getAttribute('#billSave', 'disabled')) !== null, await page.textContent('#splitSummary'));
  t.ok('running total shown red', (await page.getAttribute('#splitSummary', 'class')) === 'sum-bad');
  t.ok('live $ share for 70% of 2400', (await page.textContent('[data-calc="alex"]')) === '$1,680.00', await page.textContent('[data-calc="alex"]'));
  await page.fill('#splitRows input[data-pid="sam"]', '30');
  await page.waitForTimeout(80);
  t.ok('save unblocked at 100%', (await page.getAttribute('#billSave', 'disabled')) === null);

  // --- mode toggle converts
  await page.click('#modeAmt');
  await page.waitForTimeout(80);
  t.ok('pct -> amount conversion', (await page.inputValue('#splitRows input[data-pid="alex"]')) === '1680');
  t.ok('amount mode shows computed pct', (await page.textContent('[data-calc="alex"]')) === '70%');
  await page.fill('#splitRows input[data-pid="sam"]', '1000');
  await page.waitForTimeout(80);
  t.ok('amount mismatch warns', /exceed/.test(await page.textContent('#splitNote')), await page.textContent('#splitNote'));
  t.ok('amount mismatch still saveable', (await page.getAttribute('#billSave', 'disabled')) === null);
  await page.click('#billSave');
  await page.waitForTimeout(150);
  t.ok('amount-mode summary form', (await page.evaluate(() => BB.splitSummary(BB.state.bills.find(b => b.id === 'rent')))) === 'Alex $1,680.00 / Sam $1,000.00');
  const c2 = await page.evaluate(() => BB.contributions());
  t.ok('amount mode uses fixed amounts in contributions', Math.abs(c2.people[1].monthly - (EXP.sam - 960 + 1000)) < 0.01, c2.people[1].monthly);

  // restore
  await page.click('[data-edit="rent"]');
  await page.waitForTimeout(150);
  t.ok('reopens in amount mode', /on/.test(await page.getAttribute('#modeAmt', 'class')));
  await page.click('#modePct');
  await page.fill('#splitRows input[data-pid="alex"]', '60');
  await page.fill('#splitRows input[data-pid="sam"]', '40');
  await page.click('#billSave');
  await page.waitForTimeout(150);
  t.ok('restored percent split', (await page.evaluate(() => BB.splitSummary(BB.state.bills.find(b => b.id === 'rent')))) === 'Alex 60% ($1,440.00) / Sam 40% ($960.00)');

  // --- add a bill: even split with remainder on first person
  await page.click('#btnAdd');
  await page.waitForTimeout(120);
  await page.fill('#fName', 'Gym');
  await page.fill('#fAmount', '100.01');
  await page.click('#btnEven');
  await page.waitForTimeout(60);
  t.ok('even percent split', (await page.inputValue('#splitRows input[data-pid="alex"]')) === '50');
  await page.click('#modeAmt');
  await page.click('#btnEven');
  await page.waitForTimeout(60);
  const a1 = await page.inputValue('#splitRows input[data-pid="alex"]');
  const a2 = await page.inputValue('#splitRows input[data-pid="sam"]');
  t.ok('even amount split puts the odd cent on the first person', a1 === '50.01' && a2 === '50', `${a1}/${a2}`);
  await page.click('#billSave');
  await page.waitForTimeout(150);
  t.ok('bill added', (await page.evaluate(() => BB.state.bills.length)) === 10);

  // --- unsplit yearly + weekly normalization
  await page.click('#btnAdd');
  await page.waitForTimeout(120);
  await page.fill('#fName', 'Yard');
  await page.fill('#fAmount', '1200');
  await page.selectOption('#fPeriod', 'YEARLY');
  await page.uncheck('#fSplitOn');
  await page.click('#billSave');
  await page.waitForTimeout(150);
  t.ok('yearly normalized (1200/12) into unsplit bucket', (await page.evaluate(() => BB.contributions().unsplit)) === UNSPLIT + 100);
  await page.click('#btnAdd');
  await page.waitForTimeout(120);
  await page.fill('#fName', 'Coffee');
  await page.fill('#fAmount', '12');
  await page.selectOption('#fPeriod', 'WEEKLY');
  await page.uncheck('#fSplitOn');
  await page.click('#billSave');
  await page.waitForTimeout(150);
  t.ok('weekly x 52/12', Math.abs((await page.evaluate(() => BB.contributions().unsplit)) - (UNSPLIT + 100 + 52)) < 0.01);

  // --- delete asks first
  const coffeeId = await page.evaluate(() => BB.state.bills.find(b => b.name === 'Coffee').id);
  await page.click(`[data-del="${coffeeId}"]`);
  await page.waitForTimeout(120);
  t.ok('delete asks for confirmation', await page.isVisible('#confirmOverlay.open'));
  await page.click('#confirmYes');
  await page.waitForTimeout(120);
  t.ok('deleted after confirm', !(await page.evaluate(() => BB.state.bills.some(b => b.name === 'Coffee'))));

  // --- people
  await page.click('#btnPeople');
  await page.waitForTimeout(120);
  await page.click('#btnAddPerson');
  const inputs = await page.$$('#peopleRows input');
  await inputs[inputs.length - 1].fill('Riley');
  await page.click('#peopleSave');
  await page.waitForTimeout(150);
  t.ok('third person gets a tile', (await page.evaluate(() => BB.contributions().people.map(p => p.name))).join(',') === 'Alex,Sam,Riley');
  await page.click('[data-edit="water"]');
  await page.waitForTimeout(120);
  t.ok('new person appears in split editor', (await page.$$eval('#splitRows .nm', e => e.map(x => x.textContent))).join('/') === 'Alex/Sam/Riley');
  await page.click('#btnEven');
  await page.waitForTimeout(60);
  const r3 = await page.$$eval('#splitRows input', e => e.map(x => parseFloat(x.value)));
  t.ok('3-way even split sums to 100', Math.abs(r3.reduce((a, v) => a + v, 0) - 100) < 0.011, r3.join('/'));
  await page.click('#billSave');
  await page.waitForTimeout(150);
  await page.click('#btnPeople');
  await page.waitForTimeout(120);
  const rm = await page.$$('#peopleRows [data-prm]');
  await rm[2].click();
  await page.click('#peopleSave');
  await page.waitForTimeout(150);
  const ws = await page.evaluate(() => BB.state.bills.find(b => b.id === 'water').splits);
  t.ok('removing a person renormalizes to 100%', Math.abs(ws.reduce((a, s) => a + s.percent, 0) - 100) < 0.011, JSON.stringify(ws));
  t.ok('removing a person keeps dollars on the bill total', Math.abs(ws.reduce((a, s) => a + s.amount, 0) - 60) < 0.011);
  t.ok('people back to two', (await page.evaluate(() => BB.state.people.length)) === 2);

  // --- export, theme, layout
  const dl = page.waitForEvent('download');
  await page.click('#btnExport');
  t.ok('export downloads a dated json', /bills-budgets-\d{8}\.json/.test((await dl).suggestedFilename()));
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(100);
  t.ok('dark scheme applies', (await page.evaluate(() => getComputedStyle(document.body).backgroundColor)) === 'rgb(15, 18, 24)');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 375, height: 800 });
  await page.waitForTimeout(200);
  t.ok('no horizontal overflow at 375px', (await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 1);

  t.ok('no console errors', errs.length === 0, errs.join(' | '));
  await ctx.close();
});
