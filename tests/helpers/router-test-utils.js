"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TestResponse = void 0;
exports.invokeRoute = invokeRoute;
class TestResponse {
    statusCode = 200;
    headers = {};
    body = undefined;
    ended = false;
    status(code) {
        this.statusCode = code;
        return this;
    }
    json(payload) {
        this.headers['content-type'] = 'application/json';
        this.body = payload;
        this.ended = true;
        return this;
    }
    setHeader(name, value) {
        this.headers[name.toLowerCase()] = value;
    }
    send(payload) {
        this.body = payload;
        this.ended = true;
        return this;
    }
}
exports.TestResponse = TestResponse;
async function invokeRoute(router, path, { method = 'get', query = {}, body = {}, headers = {}, params = {}, user, } = {}) {
    const lowerMethod = method.toLowerCase();
    const layer = router.stack.find((l) => {
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
    const handlers = layer.route.stack.map((s) => s.handle);
    const normalizedHeaders = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
    const req = {
        method: method.toUpperCase(),
        headers: normalizedHeaders,
        body,
        query,
        params,
        user,
        get(name) {
            return normalizedHeaders[name.toLowerCase()];
        },
    };
    const res = new TestResponse();
    for (const handler of handlers) {
        let nextCalled = false;
        await handler(req, res, (err) => {
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
//# sourceMappingURL=router-test-utils.js.map