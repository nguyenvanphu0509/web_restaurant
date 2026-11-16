// Catalog contract tests run as a signed administrator. Production has no bypass.
import express from 'express';
import { createApi as createActualApi } from '../api/src/app.js';
import { createJwt } from '../api/src/auth/jwt.js';
export async function createAdminSession() {
  const jwt = createJwt({ secret: 'catalog-test-key-only-32-bytes-minimum' });
  return { accessToken: await jwt.sign({ id: 1, role: 'admin' }), user: { id: 1, username: 'E2E', email: 'e2e@example.test', role: 'admin' } };
}
export function createApi(options) {
  const jwt = createJwt({ secret: 'catalog-test-key-only-32-bytes-minimum' });
  const token = jwt.sign({ id: 1, role: 'admin' });
  const app = express();
  app.use(async (req, res, next) => { req.headers.authorization ||= `Bearer ${await token}`; next(); });
  const router = express.Router();
  const user = { id: 1, name: 'E2E', email: 'e2e@example.test', role: 'admin' };
  const requireAuth = (req, res, next) => jwt.requireAuth(req, res, () => { req.user = user; next(); });
  router.get('/me', requireAuth, (req, res) => res.json({ ok: true, data: user }));
  app.use(createActualApi({ ...options, auth: { router, requireAuth, withUserLock: (req, work) => work(user) } }));
  return app;
}
