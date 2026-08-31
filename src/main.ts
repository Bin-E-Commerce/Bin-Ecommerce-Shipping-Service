//
// File này khởi động Shipping Service với validation, Swagger và port độc lập.
// File không chứa nghiệp vụ vận chuyển; mọi rule transition nằm trong ShippingService.
//

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';

// Khởi động HTTP boundary với whitelist để payload lạ không đi vào application service.
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const config = app.get(ConfigService);
  const isDevelopment = config.get<string>('NODE_ENV', 'development') !== 'production';
  const port = config.get<number>('PORT', 3012);

  app.use(helmet());
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.enableCors({ origin: false });

  if (isDevelopment) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Bin E-Commerce — Shipping Service')
        .setDescription('Demo shipment orchestration and tracking APIs')
        .setVersion('1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('docs', app, document);
  }

  app.enableShutdownHooks();
  await app.listen(port);
  console.log(`[shipping-service] Running on port ${port}`);
}

void bootstrap();
