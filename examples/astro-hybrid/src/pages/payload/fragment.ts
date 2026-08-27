import { createFragmentEndpoint } from 'payload-live-preview/astro';
import Hero from '../../components/Hero.astro';
import { heroProps } from '../../document';
import { strategy } from '../../preview';

export const prerender = false;

/** Slow the render down when the title asks for it, so the E2E can race two revisions. */
async function delayFor(fields: Readonly<Record<string, unknown>>): Promise<void> {
  const match = /slow:(\d+)/u.exec(String(fields['body'] ?? ''));
  if (match) await new Promise((resolve) => setTimeout(resolve, Number(match[1])));
}

export const POST = createFragmentEndpoint({
  registry: {
    hero: {
      component: Hero,
      props: async ({ fields, locale, authorization }) => {
        await delayFor(fields);
        return {
          ...heroProps(fields, {
            editor: authorization.subject !== undefined,
            ...(locale !== undefined ? { locale } : {}),
          }),
        };
      },
    },
  },
  authorize: strategy,
});
