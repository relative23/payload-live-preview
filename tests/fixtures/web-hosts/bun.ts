import handle from './handler';

declare const Bun: {
  serve(options: {
    port: number;
    hostname: string;
    fetch(request: Request): Promise<Response>;
  }): unknown;
};

const port = Number(process.env['PORT'] ?? '4392');
Bun.serve({ port, hostname: '127.0.0.1', fetch: (request) => handle(request) });
