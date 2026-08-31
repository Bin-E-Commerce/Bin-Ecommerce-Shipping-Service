FROM node:20-alpine AS build

WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/common ./packages/common
COPY services/shipping-service/package.json services/shipping-service/package-lock.json ./services/shipping-service/
COPY services/shipping-service/tsconfig.json services/shipping-service/tsconfig.build.json services/shipping-service/nest-cli.json ./services/shipping-service/
COPY services/shipping-service/src ./services/shipping-service/src
WORKDIR /app/services/shipping-service
RUN npm ci
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY services/shipping-service/package.json services/shipping-service/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/services/shipping-service/dist ./dist
EXPOSE 3012
CMD ["node", "dist/services/shipping-service/src/main.js"]
