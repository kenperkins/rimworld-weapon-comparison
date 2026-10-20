FROM node:22-slim

WORKDIR /app
COPY package.json server.js ./
COPY scripts/saves.js ./scripts/
COPY public/ ./public/
COPY data/gamedata.json ./data/

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
USER 1000:1000

CMD ["node", "server.js"]
