import 'reflect-metadata';
import path from 'node:path';
import dotenv from 'dotenv';
dotenv.config({ path: process.env.DOTENV_PATH ?? path.resolve(__dirname, '../../../.env') });

import { Logger } from '@nestjs/common';
import { createApp } from './app.factory';
import { loadConfig } from './config/config';
import { JobsService } from './jobs/jobs.service';

async function bootstrap() {
  const config = loadConfig();
  const app = await createApp();
  if (config.RUN_WORKER_IN_API) app.get(JobsService).startPolling();
  await app.listen(config.API_PORT);
  Logger.log(`eQwik YardHRMS API listening on :${config.API_PORT} (${config.NODE_ENV})`, 'Bootstrap');
  if (!config.PAYROLL_COMPLIANCE_CERTIFIED) {
    Logger.warn('PAYROLL_COMPLIANCE_CERTIFIED=false — statutory payroll output is NOT certified for live use.', 'Compliance');
  }
}

bootstrap().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
