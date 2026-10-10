# Production image: one port serves the built web app, the API, and WebSockets.
# Deploy to AWS App Runner / ECS Fargate; set env vars from .env.example in the service config.
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
COPY scripts ./scripts
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production PORT=8080 WEB_PORT=8080
EXPOSE 8080
CMD ["npx", "tsx", "server/index.ts"]
