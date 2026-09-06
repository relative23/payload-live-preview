/**
 * The same bindings as `/`, delivered through the bootstrap. Small on purpose:
 * what this page is for is the delivery, not the binding vocabulary.
 */
const initial = {
  title: 'Hello from the demo',
  subtitle: 'Type in the admin panel to see live updates.',
  count: 12,
};

export default function AssetPage() {
  return (
    <article className="grid">
      <h1 data-payload-field="title">{initial.title}</h1>
      <p data-payload-field="subtitle">{initial.subtitle}</p>
      <p>
        Count:{' '}
        <span data-payload-field="count" data-payload-type="number">
          {initial.count}
        </span>
      </p>
    </article>
  );
}
