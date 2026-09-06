/**
 * The fixture's stylesheet, shared by both root layouts so the two delivery
 * modes differ in exactly one thing.
 */
export const styles = `
  :root {
    color-scheme: light dark;
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  }
  body {
    margin: 0;
    padding: 2rem;
    max-width: 720px;
    margin-inline: auto;
  }
  [data-payload-field] {
    transition: background-color 0.3s ease;
  }
  img {
    max-width: 100%;
    border-radius: 8px;
  }
  ul.tags {
    list-style: none;
    padding: 0;
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  ul.tags li {
    background: rgba(0, 102, 204, 0.1);
    padding: 0.25rem 0.75rem;
    border-radius: 999px;
    font-size: 0.85rem;
  }
  time {
    color: rgba(0, 0, 0, 0.6);
    font-size: 0.9rem;
  }
  .grid {
    display: grid;
    gap: 1rem;
  }
`;
