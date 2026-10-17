'use client';
import { useLivePreviewDocument } from 'payload-live-preview/react';

interface Homepage {
  title?: string;
  subtitle?: string;
  author?: { email?: string } | number | null;
  image?: { filename?: string } | number | null;
}

export function HookPreview(props: {
  serverURL: string;
  allowedOrigins: string[];
  initialData: Homepage;
}) {
  const { data, status, error, revision } = useLivePreviewDocument<Homepage>({
    serverURL: props.serverURL,
    allowedOrigins: props.allowedOrigins,
    initialData: props.initialData,
    depth: 1,
  });
  return (
    <article data-testid="hook" data-payload-island>
      <h1 data-testid="title">{data.title}</h1>
      <p data-testid="subtitle">{data.subtitle}</p>
      <p data-testid="author">
        {typeof data.author === 'object' && data.author !== null ? data.author.email : ''}
      </p>
      <p data-testid="image">
        {typeof data.image === 'object' && data.image !== null ? data.image.filename : ''}
      </p>
      <p>
        status <span data-testid="status">{status}</span>, revision{' '}
        <span data-testid="revision">{revision}</span>
      </p>
      {error === undefined || error === null ? null : <p data-testid="error">{error.message}</p>}
    </article>
  );
}
