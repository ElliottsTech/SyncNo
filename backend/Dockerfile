FROM node:20-slim

WORKDIR /app

# Install build tools for better-sqlite3 native module, plus the runtime
# libraries Chrome for Testing (puppeteer's bundled browser) needs. We do NOT
# install the Debian `chromium` package — that build traps (SIGTRAP) in this
# container environment, whereas puppeteer's own Chrome for Testing works.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    wget \
    ca-certificates \
    unzip \
    fonts-liberation \
    fonts-arphic-uming \
    libasound2 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libcairo2 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
# Let puppeteer download its own Chrome for Testing (postinstall hook).
RUN npm install
# Verify the bundled browser landed and is runnable.
RUN node -e "import('puppeteer').then(p=>p.default.executablePath()).then(p=>console.log('chrome at:',p))"

COPY . .

RUN mkdir -p data

EXPOSE 3002

CMD ["node", "src/index.js"]
