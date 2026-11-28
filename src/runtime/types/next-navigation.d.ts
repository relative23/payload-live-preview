/**
 * The three App Router hooks `src/adapters/nextjs/client.ts` calls, typed as
 * far as it uses them. `next` is an optional peer and not installed here: a
 * devDependency would add Next's whole graph to the root lockfile and its audit
 * for three signatures. The Next examples type-check the real ones, and their
 * browser suites run the component against Next 15.5 and 16.
 */
declare module 'next/navigation' {
  export function useRouter(): { readonly refresh: () => void };
  export function usePathname(): string | null;
  export function useSearchParams(): { toString(): string } | null;
}
