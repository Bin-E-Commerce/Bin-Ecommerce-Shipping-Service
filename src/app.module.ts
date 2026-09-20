//
// File này lắp dependency graph của Shipping Service.
// Database chỉ sở hữu shipment và event; dữ liệu order/shop được lấy qua contract nội bộ.
//

import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { TypeOrmModule } from "@nestjs/typeorm";
import { HealthModule } from "./modules/health/health.module";
import { ShippingModule } from "./modules/shipping/shipping.module";

// Khai báo toàn bộ module hạ tầng và bounded context để service khởi động nhất quán local/Docker.
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env.local", ".env"],
    }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: "postgres" as const,
        host: config.get<string>("POSTGRES_HOST", "localhost"),
        port: config.get<number>("POSTGRES_PORT", 5432),
        username: config.get<string>("POSTGRES_USER", "bin_ecommerce"),
        password: config.get<string>("POSTGRES_PASSWORD"),
        database: config.get<string>("POSTGRES_DB", "bin_shipping"),
        entities: [__dirname + "/**/*.entity{.ts,.js}"],
        migrations: [__dirname + "/database/migrations/*{.ts,.js}"],
        migrationsRun: true,
        synchronize: false,
        ssl:
          config.get<string>("POSTGRES_SSL", "false") === "true"
            ? { rejectUnauthorized: false }
            : false,
        // Giữ tối thiểu một kết nối ấm và giới hạn pool để giảm độ trễ khi dùng PostgreSQL cloud.
        extra: {
          min: Number(config.get<string>("POSTGRES_POOL_MIN", "1")),
          max: Number(config.get<string>("POSTGRES_POOL_MAX", "5")),
          idleTimeoutMillis: Number(
            config.get<string>("POSTGRES_IDLE_TIMEOUT_MS", "30000"),
          ),
          connectionTimeoutMillis: Number(
            config.get<string>("POSTGRES_CONNECTION_TIMEOUT_MS", "10000"),
          ),
        },
        logging: config.get<string>("TYPEORM_LOGGING", "false") === "true",
      }),
    }),
    HealthModule,
    ShippingModule,
  ],
})
export class AppModule {}
