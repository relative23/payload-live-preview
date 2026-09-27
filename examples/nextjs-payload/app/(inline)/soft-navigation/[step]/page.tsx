/**
 * Dynamic Server Component used to prove that an App Router commit replaces
 * the bound node before the same unsaved editor document is replayed onto it.
 */

import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

const STEPS = new Set(['one', 'two', 'slow', 'final']);

export const dynamic = 'force-dynamic';

export default async function SoftNavigationPage({
  params,
}: {
  params: Promise<{ step: string }>;
}): Promise<ReactNode> {
  const { step } = await params;
  if (!STEPS.has(step)) notFound();
  if (step === 'slow') await new Promise((resolve) => setTimeout(resolve, 800));

  return (
    <article className="grid">
      <p data-testid="navigation-generation">{`${step}:${randomUUID()}`}</p>
      <h1 data-payload-field="title">{`Server title for ${step}`}</h1>
      <nav aria-label="Soft navigation fixture">
        <Link data-testid="navigate-two" href="/soft-navigation/two">
          Navigate to two
        </Link>{' '}
        <Link data-testid="navigate-slow" href="/soft-navigation/slow" prefetch={false}>
          Start slow navigation
        </Link>{' '}
        <Link data-testid="navigate-final" href="/soft-navigation/final">
          Navigate to final
        </Link>{' '}
        <Link data-testid="navigate-off" href="/">
          Unmount bridge
        </Link>
      </nav>
    </article>
  );
}
