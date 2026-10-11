// Run through playwright-cli run-code --filename=tests/ui/files-quick-look.mjs
// against the local files-bench.html fixture. All operations use synthetic in-memory data.
async page => {
  const origin = await page.evaluate(() => location.origin);
  const checks = [];
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const metrics = async () => JSON.parse(await page.locator('#files-bench-metrics').textContent());
  const goto = async query => {
    await page.goto(`${origin}/files-bench.html?${query}`);
    await page.getByRole('grid').waitFor();
  };
  const select = async title => {
    await page.getByRole('grid').locator('.fs-row').filter({ hasText: title }).click();
  };
  const show = async () => {
    await page.getByRole('grid').press('Space');
    await page.getByRole('dialog').waitFor();
  };
  const readReady = async () => { await page.getByRole('dialog').locator('.fs-markdown').waitFor(); };
  const noOverflow = async () => {
    check(await page.locator('.fs-quicklook').evaluate(element => {
      const bounds = element.getBoundingClientRect();
      return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight && element.scrollWidth <= element.clientWidth;
    }), 'Modal must fit within the viewport without horizontal overflow');
  };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const firstTitle = '2.03 WHERE и предикаты';

  await page.setViewportSize({ width: 1400, height: 900 });
  await goto('unselected');
  await page.getByRole('grid').focus();
  await page.getByRole('grid').press('Space');
  check(await page.getByRole('dialog').count() === 0, 'No selection must not open a preview');
  await select(firstTitle);
  check(await page.getByRole('button', { name: 'Быстрый просмотр', exact: true }).count() === 0, 'Properties must contain no preview action');
  check((await metrics()).reads === 0, 'Selecting a note must not read its body');
  await show(); await readReady();
  check((await metrics()).reads === 1, 'Opening note preview reads exactly one body');
  check(await page.getByRole('dialog').getByText('Это синтетическая заметка для проверки файлового интерфейса.').isVisible(), 'Modal must display the note body');
  await noOverflow();
  await page.screenshot({ path: '.impeccable/review/quicklook-note-desktop.png', fullPage: true });
  await page.getByRole('region', { name: 'Предпросмотр заметки' }).press('Delete');
  check((await metrics()).trashed === 0 && (await metrics()).deleted === 0, 'Delete inside preview must not invoke list operations');
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    check(await page.locator('.fs-quicklook').evaluate(element => element.contains(document.activeElement)), 'Tab must stay inside the modal');
  }
  await page.getByRole('region', { name: 'Предпросмотр заметки' }).focus();
  await page.keyboard.press('ArrowRight'); await readReady();
  check(await page.getByRole('dialog').locator('h2').textContent() !== firstTitle, 'ArrowRight must switch the previewed entry');
  check((await metrics()).reads === 2, 'Changing entry reads only the new note');
  await page.keyboard.press('ArrowLeft'); await readReady();
  check((await metrics()).reads === 2, 'Returning to a cached note must not read it again');
  await page.keyboard.press('Escape');
  check(await page.getByRole('dialog').count() === 0, 'Escape must dismiss the preview');
  check(await page.getByRole('grid').evaluate(element => document.activeElement === element), 'Dismiss must restore focus to the file list');
  await show(); await readReady();
  await page.getByRole('region', { name: 'Предпросмотр заметки' }).press('Space');
  check(await page.getByRole('dialog').count() === 0, 'Space must toggle the preview closed');
  await show(); await readReady();
  await page.keyboard.press('Space');
  check(await page.getByRole('dialog').count() === 0, 'Space on the default close control must also dismiss');
  const search = page.getByRole('textbox', { name: 'Поиск в папке', exact: true });
  await search.fill('sql'); await search.press('Space');
  check(await search.inputValue() === 'sql ', 'Space must remain normal text input in search');
  check(await page.getByRole('dialog').count() === 0, 'Search typing must not open preview');
  await select(firstTitle);
  await page.getByRole('grid').press('Shift+F10');
  await page.getByRole('menuitem', { name: /Быстрый просмотр/ }).click();
  await page.getByRole('dialog').waitFor(); await readReady();
  await page.keyboard.press('Escape');
  check(await page.getByRole('grid').evaluate(element => document.activeElement === element), 'Context-menu dismissal must restore list focus');
  const beforeArrow = await page.getByRole('grid').getAttribute('aria-activedescendant');
  await page.getByRole('grid').press('ArrowDown');
  check(await page.getByRole('grid').getAttribute('aria-activedescendant') !== beforeArrow, 'List keyboard navigation must work after menu preview dismissal');
  checks.push('Files note: explicit read, cached navigation, Space/Escape, focus containment and menu return, no destructive shortcuts, normal typing');

  await goto('unselected');
  await select('Архив'); await show();
  check(await page.getByRole('region', { name: 'Предпросмотр папки' }).getByText('В папке пока нет элементов').isVisible(), 'Empty folder must have a useful preview');
  check((await metrics()).reads === 0, 'Folder preview must read no Markdown');
  await page.keyboard.press('Escape');
  await page.locator('.fs-route').getByRole('button', { name: 'Хранилище', exact: true }).click();
  await select('Ascend'); await show();
  check(await page.locator('.fs-quicklook-folder-summary dd').first().textContent() === '13', 'Folder preview must show actual descendant note count');
  check(await page.locator('.fs-quicklook-children').getByText('RoadMaps', { exact: true }).isVisible(), 'Folder preview must show its immediate children');
  check((await metrics()).reads === 0, 'Nonempty folder preview is metadata-only');
  await page.screenshot({ path: '.impeccable/review/quicklook-folder-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Закрыть предпросмотр', exact: true }).click();
  checks.push('Files folder: real counts, bounded child list, empty state, zero body reads');

  await goto('trash&unselected');
  await select('Удалённое'); await show();
  check(await page.locator('.fs-quicklook-folder-summary dd').first().textContent() === '4', 'Trash folder must preview its own metadata');
  check((await metrics()).reads === 0, 'Trash folder preview must read no bodies');
  await page.keyboard.press('Escape');
  await page.getByRole('grid').locator('.fs-row').filter({ hasText: 'Удалённое' }).dblclick();
  await select('Удалённая заметка 0'); await show(); await readReady();
  check((await page.locator('.fs-quicklook-title p').textContent()).startsWith('.trash/'), 'Trash note must retain its source path');
  check(await page.getByRole('dialog').getByRole('button', { name: 'Открыть', exact: true }).count() === 0, 'Trash preview must not open the editor');
  await page.screenshot({ path: '.impeccable/review/quicklook-trash-desktop.png', fullPage: true });
  await page.keyboard.press('Escape');
  await page.getByRole('grid').locator('.fs-row').filter({ hasText: 'Удалённая заметка 0' }).dblclick();
  await page.getByRole('dialog').waitFor(); await readReady();
  await page.mouse.click(5, 5);
  check(await page.getByRole('dialog').count() === 0, 'Backdrop click must dismiss the preview');
  checks.push('Trash: folder and note sources, Space and double click, no editor action, backdrop dismiss');

  await goto('unselected&preview_error');
  await select(firstTitle); await show();
  await page.getByRole('dialog').getByRole('alert').waitFor();
  await page.getByRole('dialog').getByRole('button', { name: 'Повторить', exact: true }).click();
  await readReady();
  check((await metrics()).reads === 2, 'Read failure must provide a working retry');
  await page.keyboard.press('Escape');
  checks.push('Unavailable note: visible error and successful retry');

  await page.setViewportSize({ width: 480, height: 800 });
  await goto('unselected&large_preview&preview_limit&nodes=50000');
  await select('Заметка 00000'); await show(); await readReady();
  await page.getByRole('dialog').getByText('Показано начало длинной заметки').waitFor();
  await noOverflow();
  check(await page.locator('.fs-row').count() < 30, 'Preview must keep the 50,000-row table virtualized');
  await page.screenshot({ path: '.impeccable/review/quicklook-note-narrow.png', fullPage: true });
  await page.getByRole('button', { name: 'Закрыть предпросмотр', exact: true }).click();
  checks.push('Narrow window: contained modal, bounded long note, large list remains virtualized');

  await page.setViewportSize({ width: 1400, height: 900 });
  await goto('unselected&lang=en');
  await select(firstTitle); await show(); await readReady();
  check(await page.getByRole('button', { name: 'Close preview', exact: true }).isVisible(), 'Preview controls must support English');
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await page.getByRole('heading', { name: 'Локальная заметка', exact: true }).waitFor();
  check((await metrics()).opened.endsWith('/n-0'), 'Open must use the existing note route');
  check(errors.length === 0, `Unexpected browser errors: ${errors.join('; ')}`);
  checks.push('English controls and existing full-note opening');
  return { passed: checks.length, checks, browserErrors: errors };
}
