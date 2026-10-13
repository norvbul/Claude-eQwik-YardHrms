import 'reflect-metadata';
import { INestApplication, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { loadConfig } from './config/config';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { ResponseInterceptor } from './common/response.interceptor';
import { requestContextMiddleware } from './common/request-context';
import { PrismaService } from './prisma/prisma.service';

export const API_PREFIX = 'api/v1';

export function buildOpenApi(app: INestApplication) {
  const doc = new DocumentBuilder()
    .setTitle('eQwik YardHRMS™ API')
    .setDescription(
      'REST API for eQwik YardHRMS (tenant HRMS) and the Qwik Licence & Subscription Manager (/platform/*). ' +
        'Authentication uses HttpOnly session cookies (yh_sid for tenants, qp_sid for Qwik staff). ' +
        'Every non-GET request must send the session CSRF token in the X-CSRF-Token header (obtain it from GET /auth/me or /platform/auth/me). ' +
        'Successful responses are wrapped as { data, meta? }; errors as { error: { code, message, details, requestId } }.',
    )
    .setVersion('1.0')
    .addCookieAuth('yh_sid')
    .addCookieAuth('qp_sid')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'X-CSRF-Token' }, 'csrf')
    .build();
  return SwaggerModule.createDocument(app, doc);
}

export async function createApp(opts: { logger?: boolean } = {}): Promise<NestExpressApplication> {
  const config = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: opts.logger === false ? false : ['error', 'warn', 'log'],
    bodyParser: false,
  });
  if (config.TRUST_PROXY) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(requestContextMiddleware);
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:'], styleSrc: ["'self'", "'unsafe-inline'"], scriptSrc: ["'self'", "'unsafe-inline'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { extended: false, limit: '100kb' });
  app.enableCors({ origin: config.corsOrigins, credentials: true, allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Request-Id'], exposedHeaders: ['X-Request-Id', 'Content-Disposition'] });
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalFilters(new HttpExceptionFilter(app.get(PrismaService)));
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.enableShutdownHooks();

  if (!config.isProduction || process.env.ENABLE_API_DOCS === 'true') {
    const document = buildOpenApi(app);
    SwaggerModule.setup('api/docs', app, document, { jsonDocumentUrl: 'api/docs-json' });
    Logger.log('OpenAPI docs at /api/docs', 'Bootstrap');
  }
  return app;
}
