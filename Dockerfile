FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server.js ./
ENV PORT=3000
ENV FREIGHT_DB=/data/freight.db
EXPOSE 3000
# --experimental-sqlite: node:sqlite is built-in on Node 22 but flag-gated until Node 24.
CMD ["node", "--experimental-sqlite", "server.js"]
