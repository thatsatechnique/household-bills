// First run, Settings dialog, snapshots and restore, reset, versioning, keyboard behaviour.
'use strict';
const { openPage, run, openSettings, closeSettings, setInput } = require('./_harness');

run('onboarding-settings', async (t, browser) => {
  // --- A: first run -> welcome, named people, sample bills mapped onto them
  {
    const { ctx, page, errs } = await openPage(browser, { clock: '2026-08-12T10:00:00', welcome: true });
    t.ok('A welcome shows on first run', await page.isVisible('#welcomeOverlay.open'));
    t.ok('A nothing persisted before the choice', (await page.evaluate(() => localStorage.getItem('householdBills.data'))) === null);
    const inputs = await page.$$('#welcomePeople input');
    await inputs[0].fill('Jordan');
    await inputs[1].fill('Casey');
    await page.click('#welcomeSample');
    await page.waitForTimeout(250);
    t.ok('A welcome closes', !(await page.isVisible('#welcomeOverlay.open')));
    const people = await page.evaluate(() => BB.state.people.map(p => p.id + ':' + p.name));
    t.ok('A people come from the form', people.join(',') === 'jordan:Jordan,casey:Casey', people.join(','));
    const rent = await page.evaluate(() => BB.splitSummary(BB.state.bills.find(b => b.id === 'rent')));
    t.ok('A sample splits mapped onto the named people', rent === 'Jordan 60% ($1,440.00) / Casey 40% ($960.00)', rent);
    t.ok('A persisted after the choice', (await page.evaluate(() => JSON.parse(localStorage.getItem('householdBills.data')).people[0].name)) === 'Jordan');
    await page.reload(); await page.waitForTimeout(300);
    t.ok('A welcome does not return', !(await page.isVisible('#welcomeOverlay.open')));
    t.ok('A no console errors', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  // --- B: first run, start empty, three people, unusual names
  {
    const { ctx, page, errs } = await openPage(browser, { clock: '2026-08-12T10:00:00', welcome: true });
    await page.click('#welcomeAddPerson');
    const inputs = await page.$$('#welcomePeople input');
    await inputs[0].fill('Mx. Ó Brien');
    await inputs[1].fill('Sam');
    await inputs[2].fill('Sam');           // duplicate name -> ids must still be unique
    await page.click('#welcomeEmpty');
    await page.waitForTimeout(250);
    const ids = await page.evaluate(() => BB.state.people.map(p => p.id));
    t.ok('B three people with unique ids', ids.length === 3 && new Set(ids).size === 3, ids.join(','));
    t.ok('B no bills', (await page.evaluate(() => BB.state.bills.length)) === 0);
    t.ok('B empty-state copy', /No bills yet/.test(await page.textContent('#subtitle')));
    t.ok('B dashboard renders empty without error', await page.isVisible('#billGrid') && errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  // --- C: first run with one person -> sample is all unsplit; Escape keeps the sample
  {
    const { ctx, page } = await openPage(browser, { clock: '2026-08-12T10:00:00', welcome: true });
    t.ok('C welcome says nothing is sent anywhere', /Nothing you enter is sent anywhere/.test(await page.textContent('#welcomePrivacy')));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    t.ok('C Escape dismisses and keeps the sample', !(await page.isVisible('#welcomeOverlay.open')) && (await page.evaluate(() => BB.state.bills.length)) === 9);
    t.ok('C dismissal is remembered', (await page.evaluate(() => localStorage.getItem('householdBills.welcomed'))) === '1');
    await ctx.close();
  }
  {
    const { ctx, page } = await openPage(browser, { clock: '2026-08-12T10:00:00', welcome: true });
    const inputs = await page.$$('#welcomePeople input');
    await inputs[0].fill('Solo');
    await page.click('#welcomePeople [data-wrm="1"]');
    await page.click('#welcomeSample');
    await page.waitForTimeout(250);
    const c = await page.evaluate(() => BB.contributions());
    t.ok('C one person -> everything lands in Unsplit', c.people.length === 1 && c.people[0].monthly === 0 && c.unsplit === c.total, JSON.stringify([c.people[0].monthly, c.unsplit, c.total]));
    await ctx.close();
  }

  // --- D: settings dialog navigation + people editing in place
  {
    const { ctx, page, errs } = await openPage(browser, { clock: '2026-08-12T10:00:00' });
    await page.click('#btnSettings');
    await page.waitForTimeout(150);
    t.ok('D opens on People', await page.isVisible('[data-pane="people"]') && !(await page.isVisible('[data-pane="data"]')));
    await page.click('[data-sec="data"]');
    t.ok('D nav switches panes', await page.isVisible('[data-pane="data"]') && !(await page.isVisible('[data-pane="people"]')));
    t.ok('D storage chip lives here now', await page.isVisible('#storageChip'));
    await page.click('[data-sec="about"]');
    t.ok('D about shows version', /v\d+\.\d+\.\d+ · data format 1/.test(await page.textContent('#aboutVersion')), await page.textContent('#aboutVersion'));
    await page.click('[data-sec="people"]');
    const rows = await page.$$('#peopleRows input');
    await rows[1].fill('Samantha');
    await page.click('#peopleSave');
    await page.waitForTimeout(150);
    t.ok('D rename applies to every split', (await page.evaluate(() => BB.state.bills.find(b => b.id === 'rent').splits[1].name)) === 'Samantha');
    t.ok('D settings stays open after saving people', await page.isVisible('#settingsOverlay.open'));
    await closeSettings(page);
    t.ok('D close button works', !(await page.isVisible('#settingsOverlay.open')));
    t.ok('D no console errors', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  // --- E: snapshots, restore, reset
  {
    const { ctx, page, errs } = await openPage(browser, { clock: '2026-08-12T10:00:00' });
    t.ok('E no snapshot before the first change', (await page.evaluate(() => BB.snapshots().length)) === 0);
    await setInput(page, '#checklist input[data-actual="water"]', '61');
    const snaps = await page.evaluate(() => BB.snapshots());
    t.ok('E first change of the day takes a Daily snapshot of the prior state', snaps.length === 1 && snaps[0].label === 'Daily', JSON.stringify(snaps.map(s => s.label)));
    t.ok('E snapshot holds the pre-change data', JSON.parse(snaps[0].raw).bills.find(b => b.id === 'water').actuals['2026-08'] === undefined);
    await setInput(page, '#checklist input[data-actual="water"]', '62');
    t.ok('E second change the same day does not add another', (await page.evaluate(() => BB.snapshots().length)) === 1);

    await openSettings(page, 'data');
    t.ok('E snapshot listed', (await page.$$eval('#snapshots .snap', e => e.length)) === 1);
    await page.click('#snapshots [data-restore]');
    await page.waitForTimeout(120);
    t.ok('E restore asks first', await page.isVisible('#confirmOverlay.open') && (await page.textContent('#confirmYes')) === 'Restore');
    await page.click('#confirmYes');
    await page.waitForTimeout(200);
    t.ok('E restore reverts the change', (await page.evaluate(() => BB.state.bills.find(b => b.id === 'water').actuals['2026-08'])) === undefined);
    const labels = await page.evaluate(() => BB.snapshots().map(s => s.label));
    t.ok('E restore snapshots the state it replaced', labels.includes('Before restore'), labels.join(','));

    await page.click('#btnResetEmpty');
    await page.waitForTimeout(120);
    await page.click('#confirmYes');
    await page.waitForTimeout(200);
    t.ok('E delete-all empties bills, keeps people', (await page.evaluate(() => BB.state.bills.length)) === 0 && (await page.evaluate(() => BB.state.people.length)) === 2);
    t.ok('E reset snapshots first', (await page.evaluate(() => BB.snapshots().map(s => s.label))).includes('Before reset'));
    await page.click('#btnResetSample');
    await page.waitForTimeout(120);
    await page.click('#confirmYes');
    await page.waitForTimeout(200);
    t.ok('E sample reload restores nine bills', (await page.evaluate(() => BB.state.bills.length)) === 9);
    t.ok('E snapshot cap respected', (await page.evaluate(() => BB.snapshots().length)) <= 10);
    t.ok('E no console errors', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  // --- F: versioning on import
  {
    const { ctx, page, errs } = await openPage(browser, { clock: '2026-08-12T10:00:00' });
    const v = await page.evaluate(() => JSON.parse(localStorage.getItem('householdBills.data')).version);
    t.ok('F stored data carries version 1', v === 1, v);
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('householdBills.data'));
      delete s.version;                       // an old export without the field
      localStorage.setItem('householdBills.data', JSON.stringify(s));
    });
    await page.reload(); await page.waitForTimeout(300);
    t.ok('F missing version is treated as 1', (await page.evaluate(() => BB.state.version)) === 1 && (await page.evaluate(() => BB.state.bills.length)) === 9);
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('householdBills.data'));
      s.version = 99;
      localStorage.setItem('householdBills.data', JSON.stringify(s));
    });
    await page.reload(); await page.waitForTimeout(600);
    t.ok('F newer version still loads with a warning', (await page.evaluate(() => BB.state.bills.length)) === 9 && /newer version/.test(await page.textContent('#toast')));
    t.ok('F no console errors', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  // --- G: keyboard: Tab stays inside an open dialog
  {
    const { ctx, page } = await openPage(browser, { clock: '2026-08-12T10:00:00' });
    await page.click('#btnAdd');
    await page.waitForTimeout(150);
    let inside = true;
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      const ok = await page.evaluate(() => document.getElementById('billOverlay').contains(document.activeElement));
      if (!ok) { inside = false; break; }
    }
    t.ok('G focus never escapes the bill dialog', inside);
    await page.keyboard.press('Escape');
    t.ok('G Escape closes it', !(await page.isVisible('#billOverlay.open')));
    await ctx.close();
  }
});
