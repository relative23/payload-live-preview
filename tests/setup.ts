import { afterEach, beforeEach } from 'vitest';

beforeEach(() => {
  document.body.innerHTML = '';
  document.head.querySelectorAll('style[data-payload-live-preview]').forEach((n) => {
    n.remove();
  });
});

afterEach(() => {
  document.body.innerHTML = '';
});
