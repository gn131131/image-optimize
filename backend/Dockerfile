FROM node:20-alpine AS build
WORKDIR /app
# Install build dependencies for sharp (node-gyp toolchain)
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
# Remove dev dependencies leaving production deps only
RUN npm prune --omit=dev

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package*.json ./
EXPOSE 4000
HEALTHCHECK CMD wget -q -O - http://localhost:4000/health || exit 1
CMD ["node","dist/index.js"]
