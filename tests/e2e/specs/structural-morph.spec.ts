import { expect, test, type Frame, type Page } from '@playwright/test';
import { post, waitForPreviewFrame, waitForStarted } from '../helpers/preview';

/**
 * ADR 0008 §7 — the keyed morph's acceptance gates, in a real browser:
 * node identity survives a keyed move, focus and selection survive an edit
 * to the focused item, a custom element keeps its internal state, and a
 * visitor-opened `<details>` stays open. The `/structural/` page is framed
 * by `/bench`, and updates are posted from the parent window.
 */

const PATH = '/structural/';

async function open(page: Page): Promise<Frame> {
  await page.goto(`/bench?target=${PATH}`);
  const frame = await waitForPreviewFrame(page, PATH);
  await waitForStarted(frame);
  return frame;
}

async function postRows(page: Page, rows: readonly { id: string; title: string }[]): Promise<void> {
  await post(page, { rows });
}

const BASE = [
  { id: 'a', title: 'Alpha' },
  { id: 'b', title: 'Beta' },
  { id: 'c', title: 'Gamma' },
];

test.describe('keyed morph — what survives a structural update', () => {
  test('node identity survives a keyed move and an edit', async ({ page }) => {
    const frame = await open(page);
    await frame.evaluate(() => {
      document.querySelectorAll<HTMLElement>('[data-testid="rows"] > li').forEach((li, index) => {
        (li as HTMLElement & { __mark?: number }).__mark = index;
      });
    });
    await postRows(page, [BASE[2]!, { id: 'a', title: 'Alpha, edited' }, BASE[1]!]);
    await expect(frame.locator('[data-testid="rows"] > li .t').first()).toHaveText('Gamma');
    const marks = await frame.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-testid="rows"] > li'), (li) => ({
        mark: (li as HTMLElement & { __mark?: number }).__mark,
        text: li.querySelector('.t')?.textContent,
      })),
    );
    expect(marks).toEqual([
      { mark: 2, text: 'Gamma' },
      { mark: 0, text: 'Alpha, edited' },
      { mark: 1, text: 'Beta' },
    ]);
  });

  test('focus, typed value and selection survive an edit to the focused item', async ({ page }) => {
    const frame = await open(page);
    const input = frame.locator('[data-payload-key="b"] input');
    await input.click();
    await input.fill('half typed');
    await frame.evaluate(() => {
      const el = document.activeElement as HTMLInputElement;
      el.setSelectionRange(5, 10);
    });
    await postRows(page, [BASE[0]!, { id: 'b', title: 'Beta, edited' }, BASE[2]!]);
    await expect(frame.locator('[data-payload-key="b"] .t')).toHaveText('Beta, edited');
    const state = await frame.evaluate(() => {
      const el = document.activeElement as HTMLInputElement | null;
      return {
        focusedIsInput: el?.tagName === 'INPUT',
        key: el?.closest('li')?.getAttribute('data-payload-key'),
        value: el?.value,
        selection: [el?.selectionStart, el?.selectionEnd],
        label: el?.getAttribute('aria-label'),
      };
    });
    expect(state).toEqual({
      focusedIsInput: true,
      key: 'b',
      value: 'half typed',
      selection: [5, 10],
      label: 'Beta, edited',
    });
  });

  test('a custom element keeps its internal state and identity across updates', async ({
    page,
  }) => {
    const frame = await open(page);
    const counter = frame.locator('[data-payload-key="a"] x-counter');
    const button = counter.locator('button');
    await button.click();
    await button.click();
    await expect(button).toHaveText('2');
    await frame.evaluate(() => {
      const el = document.querySelector('[data-payload-key="a"] x-counter');
      (el as HTMLElement & { __mark?: string }).__mark = 'same';
    });
    await postRows(page, [{ id: 'a', title: 'Alpha, edited' }, BASE[1]!, BASE[2]!]);
    await expect(frame.locator('[data-payload-key="a"] .t')).toHaveText('Alpha, edited');
    await expect(button).toHaveText('2');
    const kept = await frame.evaluate(() => {
      const el = document.querySelector('[data-payload-key="a"] x-counter') as unknown as {
        __mark?: string;
        count?: number;
      } | null;
      return { mark: el?.__mark, count: el?.count };
    });
    expect(kept).toEqual({ mark: 'same', count: 2 });
  });

  test('a visitor-opened details stays open when the template does not control it', async ({
    page,
  }) => {
    const frame = await open(page);
    const details = frame.locator('[data-payload-key="c"] details');
    await details.locator('summary').click();
    await expect(details).toHaveAttribute('open', '');
    await postRows(page, [BASE[0]!, BASE[1]!, { id: 'c', title: 'Gamma, edited' }]);
    await expect(frame.locator('[data-payload-key="c"] .t')).toHaveText('Gamma, edited');
    await expect(details).toHaveAttribute('open', '');
    await expect(details.locator('p')).toHaveText('Details of Gamma, edited');
  });
});
