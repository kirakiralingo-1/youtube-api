FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip git ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# yt-dlp（EJSスクリプト込み）+ POTプラグイン
RUN pip3 install --break-system-packages "yt-dlp[default]" bgutil-ytdlp-pot-provider

# POT Providerサーバー（リリースZIPから直接展開）
RUN mkdir -p /opt/pot && cd /opt/pot && \
    npm init -y && npm install express && \
    git clone --depth 1 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git src && \
    cd src/server && npm install && npx tsc

WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY . .

ENV YTDLP_POT_PROVIDER_URL=http://127.0.0.1:4416

EXPOSE 3000
CMD ["sh", "-c", "cd /opt/pot/src/server && node build/main.js & sleep 5 && node server.js"]   
