FROM node:20-slim

WORKDIR /app

# No native modules here — pure TS/JS HTTP client over the backend REST API.
COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 3003

CMD ["node", "dist/index.js"]
