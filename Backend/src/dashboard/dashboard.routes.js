import { Router } from 'express';
import { authenticateRequest } from '../auth/auth.middleware.js';
import { requireTenantContext } from '../auth/tenant.middleware.js';
import { AppError } from '../middleware/errors.js';
import { dashboardQuerySchema, parseDashboardInput } from './dashboard.schemas.js';
import { getCompanyAnalytics, getCompanyDashboard } from './dashboard.service.js';

export const dashboardRouter = Router();
dashboardRouter.use(authenticateRequest, requireTenantContext);
dashboardRouter.use((_request, response, next) => {
  response.set({
    'Cache-Control': 'private, no-store, no-cache, max-age=0, must-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
  });
  next();
});
dashboardRouter.get('/', async (req, res) => {
  const parsed = parseDashboardInput(dashboardQuerySchema, req.query);
  if (!parsed.success) throw new AppError(400, 'Request validation failed', 'VALIDATION_ERROR', parsed.issues);
  const auth = { ...req.auth, tenantId: req.tenant.tenantId, workspaceId: req.tenant.workspaceId };
  res.json({ success: true, data: await getCompanyDashboard(auth, parsed.data.days) });
});
dashboardRouter.get('/analytics', async (req, res) => {
  const parsed = parseDashboardInput(dashboardQuerySchema, req.query);
  if (!parsed.success) throw new AppError(400, 'Request validation failed', 'VALIDATION_ERROR', parsed.issues);
  const auth = { ...req.auth, tenantId: req.tenant.tenantId, workspaceId: req.tenant.workspaceId };
  res.json({ success: true, data: await getCompanyAnalytics(auth, parsed.data.days) });
});
