import express from 'express';
import { Pool } from 'pg';
import { PreferencesRepository } from '../infrastructure/repositories/preferences.repository';
import { PoliciesRepository } from '../infrastructure/repositories/policies.repository';
import { PreferencesService } from '../application/preferences.service';
import { EvaluationService } from '../application/evaluation.service';
import { createUsersRouter } from './routes/users';
import { createEvaluateRouter } from './routes/evaluate';
import { createPoliciesRouter } from './routes/policies';
import { errorHandler } from './middleware/error-handler';

export function createApp(pool: Pool): express.Application {
  const app = express();
  app.use(express.json());

  const preferencesRepo = new PreferencesRepository(pool);
  const policiesRepo = new PoliciesRepository(pool);

  const preferencesService = new PreferencesService(preferencesRepo);
  const evaluationService = new EvaluationService(preferencesRepo, policiesRepo);

  app.use('/users', createUsersRouter(preferencesService));
  app.use('/evaluate', createEvaluateRouter(evaluationService));
  app.use('/policies', createPoliciesRouter(policiesRepo));

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  app.use(errorHandler);

  return app;
}
