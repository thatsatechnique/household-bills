// File binding: File System Access API simulated end to end, including reload, permission lapse, disconnect.
'use strict';
const { openPage, run, serve, waitText, setInput, openSettings, closeSettings } = require('./_harness');

// A fake showSaveFilePicker/showOpenFilePicker plus an IndexedDB that keeps object identity.
// The "file" and the remembered handle live in localStorage so they survive reloads.
const FAKE_FS = `{
  function makeHandle(name){
    return {
      name,
      queryPermission: async () => localStorage.getItem('__perm') || 'granted',
      requestPermission: async () => { localStorage.setItem('__perm', 'granted'); return 'granted'; },
      getFile: async () => ({ text: async () => localStorage.getItem('__fd') || '' }),
      createWritable: async () => {
        let buf = '';
        return {
          write: async (t) => { buf = t; },
          close: async () => {
            localStorage.setItem('__fd', buf);
            localStorage.setItem('__writes', String((+localStorage.getItem('__writes') || 0) + 1));
          }
        };
      }
    };
  }
  if (!window.__noFS) {
    window.showSaveFilePicker = async () => makeHandle('household-bills.json');
    window.showOpenFilePicker  = async () => [makeHandle('household-bills.json')];
  }
  const store = {};
  const bound = localStorage.getItem('__bound');
  if (bound) store.datafile = makeHandle(bound);
  const fakeIDB = {
    open(){
      const req = {};
      setTimeout(() => {
        req.result = {
          createObjectStore(){},
          transaction(){
            const tx = {};
            tx.objectStore = () => ({
              put(v, k){ store[k] = v; if (k === 'datafile') { v ? localStorage.setItem('__bound', v.name) : localStorage.removeItem('__bound'); } },
              get(k){ const q = {}; setTimeout(() => { q.result = store[k]; q.onsuccess && q.onsuccess(); }, 0); return q; }
            });
            Object.defineProperty(tx, 'oncomplete', { set(f){ setTimeout(f, 0); } });
            return tx;
          }
        };
        req.onsuccess && req.onsuccess();
      }, 0);
      return req;
    }
  };
  Object.defineProperty(window, 'indexedDB', { value: fakeIDB, configurable: true, writable: true });
}`;

run('file-binding', async (t, browser) => {
  const server = serve(8431);
  const URL = 'http://127.0.0.1:8431/';
  {
    const { ctx, page, errs } = await openPage(browser, { clock: '2026-08-12T10:00:00', url: URL, init: [FAKE_FS] });

    t.ok('header status starts browser-only', /Saved in this browser/.test(await page.textContent('#storageMini')));
    await openSettings(page, 'data');
    t.ok('starts unbound', /this browser only/.test(await page.textContent('#storageChip')));
    t.ok('offers Save to a file', await page.isVisible('#stNew'));

    await page.click('#stNew');
    t.ok('chip shows bound', /Saving to household-bills\.json/.test(await waitText(page, '#storageChip', /Saving to/)));
    const fd1 = await page.evaluate(() => JSON.parse(localStorage.getItem('__fd')));
    t.ok('file written with the full state', fd1.bills.length === 9 && fd1.people.length === 2);
    t.ok('handle remembered', (await page.evaluate(() => localStorage.getItem('__bound'))) === 'household-bills.json');
    t.ok('header status reflects the file', /Saving to household-bills\.json/.test(await page.textContent('#storageMini')));
    await closeSettings(page);

    await setInput(page, '#checklist input[data-actual="streaming"]', '17.15');
    await page.waitForTimeout(800);
    const fd2 = await page.evaluate(() => JSON.parse(localStorage.getItem('__fd')));
    t.ok('edits write through', fd2.bills.find(b => b.id === 'streaming').actuals['2026-08'] === 17.15);

    await page.evaluate(() => localStorage.setItem('__writes', '0'));
    for (const v of ['1', '2', '3', '4', '5']) {
      await page.fill('#checklist input[data-actual="water"]', v);
      await page.dispatchEvent('#checklist input[data-actual="water"]', 'change');
    }
    await page.waitForTimeout(900);
    t.ok('rapid edits debounce to one write', (await page.evaluate(() => +localStorage.getItem('__writes'))) === 1);
    t.ok('last value wins', (await page.evaluate(() => JSON.parse(localStorage.getItem('__fd')).bills.find(b => b.id === 'water').actuals['2026-08'])) === 5);

    // the file wins over localStorage on reload (edited elsewhere and synced)
    await page.evaluate(() => {
      const f = JSON.parse(localStorage.getItem('__fd'));
      f.bills.push({ id: 'fromfile', name: 'Added Elsewhere', totalAmount: 42, period: 'MONTHLY', dueDay: 9, isActive: true, splits: null, paidMonths: {}, actuals: {} });
      localStorage.setItem('__fd', JSON.stringify(f));
    });
    await page.reload();
    await waitText(page, '#storageChip', /Saving to/);
    t.ok('file contents adopted over localStorage', (await page.evaluate(() => BB.state.bills.map(b => b.name))).includes('Added Elsewhere'));
    t.ok('localStorage mirror updated', await page.evaluate(() => JSON.parse(localStorage.getItem('householdBills.data')).bills.some(b => b.id === 'fromfile')));

    // permission lapse
    await page.evaluate(() => localStorage.setItem('__perm', 'prompt'));
    await page.reload();
    const chip = await waitText(page, '#storageChip', /needs permission/);
    t.ok('chip flags missing permission', /needs permission/.test(chip), chip.replace(/\s+/g, ' ').trim());
    t.ok('header status flags it too', /needs permission/.test(await page.textContent('#storageMini')));
    t.ok('app still works from localStorage', (await page.evaluate(() => BB.state.bills.length)) === 10);
    await setInput(page, '#checklist input[data-actual="electric"]', '99');
    t.ok('edits persist locally while stale', (await page.evaluate(() => JSON.parse(localStorage.getItem('householdBills.data')).bills.find(b => b.id === 'electric').actuals['2026-08'])) === 99);
    await openSettings(page, 'data');
    await page.click('#stRecon');
    t.ok('reconnect restores bound state', /Saving to/.test(await waitText(page, '#storageChip', /Saving to/)));

    // disconnect
    await page.click('#stDisc');
    t.ok('disconnect returns to browser-only', /this browser only/.test(await waitText(page, '#storageChip', /this browser only/)));
    await page.evaluate(() => localStorage.setItem('__writes', '0'));
    await setInput(page, '#checklist input[data-actual="streaming"]', '7');
    await page.waitForTimeout(700);
    t.ok('no further file writes after disconnect', (await page.evaluate(() => +localStorage.getItem('__writes'))) === 0);
    t.ok('no console errors', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  // browser without the API (Safari / Firefox)
  {
    const { ctx, page, errs } = await openPage(browser, {
      url: URL,
      init: ['window.__noFS = true;', FAKE_FS, 'delete window.showSaveFilePicker; delete window.showOpenFilePicker;'],
    });
    await openSettings(page, 'data');
    const chip = await waitText(page, '#storageChip', /Export JSON/);
    t.ok('unsupported browser: browser-only + Export', /this browser only/.test(chip) && await page.isVisible('#stExp'));
    t.ok('unsupported browser: no Save-to-file button', !(await page.$('#stNew')));
    t.ok('unsupported browser: no console errors', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }
  server.close();
});
