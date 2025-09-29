import { Router, RequestHandler } from 'express';

export class TestResponse {
  statusCode = 200;
  headers: Record<string, string> = {};
  body: any = undefined;
  ended = false;

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  json(payload: any) {
    this.headers['content-type'] = 'application/json';
    this.body = payload;
    this.ended = true;
    return this;
  }

  setHeader(name: string, value: string) {
    this.headers[name.toLowerCase()] = value;
  }

  send(payload: any) {
    this.body = payload;
    this.ended = true;
    return this;
  }
}

export interface InvokeRouteOptions {
  method?: 'get' | 'post' | 'put' | 'delete';
  query?: Record<string, any>;
  body?: any;
  headers?: Record<string, string>;
  params?: Record<string, string>;
  user?: any;
}

export async function invokeRoute(
  router: Router,
  path: string,
  {
    method = 'get',
    query = {},
    body = {},
    headers = {},
    params = {},
    user,
  }: InvokeRouteOptions = {}
): Promise<{ req: any; res: TestResponse }> {
  const lowerMethod = method.toLowerCase();

  const layer = router.stack.find((l: any) => {
    if (!l.route) {
      return false;
    }
    if (l.route.path !== path) {
      return false;
    }
    return Boolean(l.route.methods?.[lowerMethod]);
  });

  if (!layer) {
    throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
  }

  const handlers: RequestHandler[] = layer.route.stack.map((s: any) => s.handle);

  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );

  const req: any = {
    method: method.toUpperCase(),
    headers: normalizedHeaders,
    body,
    query,
    params,
    user,
    get(name: string) {
      return normalizedHeaders[name.toLowerCase()];
    },
  };

  const res = new TestResponse();

  for (const handler of handlers) {
    let nextCalled = false;
    await handler(req, res as any, (err?: unknown) => {
      if (err) {
        throw err;
      }
      nextCalled = true;
    });

    if (res.ended) {
      break;
    }

    if (!nextCalled) {
      break;
    }
  }

  return { req, res };
}
