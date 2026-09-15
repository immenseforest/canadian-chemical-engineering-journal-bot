FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY src ./src
RUN mkdir -p /app/data /app/pdfs && chown -R node:node /app/data /app/pdfs
USER node
CMD ["node", "src/service.mjs"]
