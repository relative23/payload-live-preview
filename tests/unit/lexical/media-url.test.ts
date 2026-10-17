import { describe, expect, it } from 'vitest';
import { resolveMediaUrl } from '@lexical/value-shapes';

describe('resolveMediaUrl', () => {
  const SERVER = 'https://cms.example.com';

  it('puts a path on the Payload server, as the admin does with new URL(url, serverURL)', () => {
    expect(resolveMediaUrl('/api/media/file/a.png', SERVER)).toBe(
      'https://cms.example.com/api/media/file/a.png',
    );
    expect(resolveMediaUrl('/api/media/file/a.png?v=2#x', `${SERVER}/`)).toBe(
      'https://cms.example.com/api/media/file/a.png?v=2#x',
    );
  });

  it('takes the origin of the server and nothing of a path it may carry', () => {
    expect(resolveMediaUrl('/api/media/file/a.png', 'https://example.com/cms')).toBe(
      'https://example.com/api/media/file/a.png',
    );
  });

  it('writes the URL as delivered when no server is known', () => {
    expect(resolveMediaUrl('/api/media/file/a.png', undefined)).toBe('/api/media/file/a.png');
    expect(resolveMediaUrl('/api/media/file/a.png', '')).toBe('/api/media/file/a.png');
  });

  it.each([
    'https://cdn.example.com/a.png',
    '//cdn.example.com/a.png',
    '/\\cdn.example.com/a.png',
    '/\\\\cdn.example.com/a.png',
    'a.png',
    './a.png',
    '?v=2',
    '#a',
    'data:image/png;base64,AAAA',
  ])("leaves %j as it is: it is not a path on Payload's origin", (url) => {
    expect(resolveMediaUrl(url, SERVER)).toBe(url);
  });

  it.each(['not a url', 'javascript:alert(1)', 'data:text/plain,x', 'cms.example.com'])(
    'leaves the path alone when %j is no base to resolve it against',
    (server) => {
      expect(resolveMediaUrl('/api/media/file/a.png', server)).toBe('/api/media/file/a.png');
    },
  );
});
