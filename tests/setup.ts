import { afterEach, beforeEach } from 'vitest';
import { resetNotices } from '@detection/notice';

beforeEach(() => {
  // A 3.0 notice is once per page, and every test file is one page: without
  // this the first test to build a hook would take the notice from the rest.
  resetNotices();
  document.body.innerHTML = '';
  document.head.querySelectorAll('style[data-payload-live-preview]').forEach((n) => {
    n.remove();
  });
});

afterEach(() => {
  document.body.innerHTML = '';
});
