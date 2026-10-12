# syntax=docker/dockerfile:1

# node:22-slim (glibc) y no alpine: bcrypt es un modulo nativo y sus binarios
# precompilados no cubren musl, asi que en alpine habria que compilarlo.

# ---------- build: compila TypeScript con todas las dependencias ----------
FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
# nest build y no tsc: el CLI reescribe los imports absolutos 'src/...' a
# rutas relativas, y sin eso node dist/main no los resuelve.
RUN npm run build

# ---------- deps: solo dependencias de produccion ----------
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---------- runtime ----------
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./

USER node
EXPOSE 4000

# No hay GET /health todavia y GET / exige token: cualquier respuesta HTTP
# (un 401 incluido) cuenta como viva; solo falla si el puerto no contesta.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||4000)+'/').then(()=>process.exit(0)).catch(()=>process.exit(1))"

CMD ["node", "dist/main"]
