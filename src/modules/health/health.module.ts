// File này đăng ký health endpoint độc lập để Docker và Gateway kiểm tra Shipping Service.

import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

@Module({ controllers: [HealthController] })
export class HealthModule {}
