FROM node:20-slim

WORKDIR /app

# Install build tools for better-sqlite3 native module
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install

COPY . .

# Bake current commit SHA so /api/system/version works without git in image.
ARG BUILD_SHA=""
RUN if [ -n "$BUILD_SHA" ]; then echo "$BUILD_SHA" > .deploy-sha; fi

RUN mkdir -p data

EXPOSE 3002

CMD ["node", "src/index.js"]
