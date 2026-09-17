# Shipping Service dùng root context vì cần tsconfig.base.json và packages/common.
# Dockerfile.dockerignore giới hạn context, không gửi source service khác hoặc secret.

# -----------------------------------------------------------------------------
# Giai đoạn build: cài dependency theo lockfile riêng và compile TypeScript.
# -----------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Copy cấu hình chung và manifest trước source để cache dependency hiệu quả.
COPY tsconfig.base.json ./
COPY packages/common ./packages/common
COPY services/shipping-service/package.json services/shipping-service/package-lock.json ./services/shipping-service/
COPY services/shipping-service/tsconfig.json \
  services/shipping-service/tsconfig.build.json \
  services/shipping-service/nest-cli.json \
  ./services/shipping-service/

# Shipping có lockfile riêng; npm ci giúp build tái lập đúng phiên bản dependency.
WORKDIR /app/services/shipping-service
RUN npm ci --include=dev --ignore-scripts

# Chỉ copy source Shipping sau khi dependency đã được cache.
COPY services/shipping-service/src ./src

# Build script dùng tsconfig.build.json và tắt incremental để image không giữ cache TS.
RUN npm run build

# Shipping import @common/* ở runtime nhưng tsconfig build chỉ compile source Shipping.
# Compile riêng shared package vào thư mục tạm để không phụ thuộc vào source TypeScript lúc chạy.
RUN npx tsc \
  --target ES2022 \
  --module commonjs \
  --moduleResolution node \
  --rootDir /app \
  --outDir /app/dist-common \
  --declaration false \
  --sourceMap false \
  --esModuleInterop \
  --skipLibCheck \
  $(find /app/packages/common -type f -name '*.ts' -print)
RUN mkdir -p node_modules/@common \
  && cp -R /app/dist-common/packages/common/. node_modules/@common/

# Runtime không cần Nest CLI, Jest hoặc TypeScript.
RUN npm prune --omit=dev

# -----------------------------------------------------------------------------
# Giai đoạn runtime: image non-root, chỉ giữ dependency production và dist.
# -----------------------------------------------------------------------------
FROM node:20-alpine AS production

RUN addgroup -g 1001 -S nodejs \
  && adduser -S nestjs -u 1001

WORKDIR /app

# Copy dependency production đã prune từ builder, không cài lại lần hai.
COPY --from=builder --chown=nestjs:nodejs /app/services/shipping-service/node_modules ./node_modules
# dist gồm Shipping Service và artifact packages/common được compile cùng rootDir.
COPY --from=builder --chown=nestjs:nodejs /app/services/shipping-service/dist ./dist

ENV NODE_ENV=production \
  PORT=3012 \
  NODE_OPTIONS=--max-old-space-size=128

EXPOSE 3012

# Health endpoint versioned xác nhận process HTTP còn sống.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
  CMD wget --quiet --tries=1 --spider "http://localhost:${PORT}/api/v1/health" || exit 1

USER nestjs

# Chạy Node trực tiếp để nhận SIGTERM đúng khi Compose/Kubernetes rollout.
CMD ["node", "dist/services/shipping-service/src/main.js"]
