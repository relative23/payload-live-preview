/** Deno serves HTTP/1.1 and, with a certificate, HTTP/2 on the same port. */
import handle from './handler';

declare const Deno: {
  env: { get(name: string): string | undefined };
  readTextFileSync(path: string): string;
  serve(
    options: { port: number; hostname: string; onListen: () => void; cert?: string; key?: string },
    handler: (request: Request) => Promise<Response>,
  ): unknown;
};

const port = Number(Deno.env.get('PORT') ?? '4391');
const cert = Deno.env.get('PLP_HOST_CERT');
const key = Deno.env.get('PLP_HOST_KEY');
const options = { port, hostname: '127.0.0.1', onListen: () => undefined };
if (cert !== undefined && key !== undefined) {
  Deno.serve(
    { ...options, cert: Deno.readTextFileSync(cert), key: Deno.readTextFileSync(key) },
    (request) => handle(request),
  );
} else {
  Deno.serve(options, (request) => handle(request));
}
