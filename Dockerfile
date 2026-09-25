FROM node:22-slim

# Python + yt-dlp + PO Token Provider 用プラグイン
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip curl && \
    pip3 install --break-system-packages yt-dlp bgutil-ytdlp-pot-provider && \
    rm -rf /var/lib/apt/lists/*

# PO Token Provider（HTTPサーバー、ポート4416）
RUN git clone --single-branch --branch 2.0.0 \
    https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/pot && \
    cd /opt/pot/server && npm ci && npx tsc

WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY . .

ENV YTDLP_POT_PROVIDER_URL=http://127.0.0.1:4416

EXPOSE 3000
CMD ["sh", "-c", "node /opt/pot/server/build/main.js & sleep 5 && node server.js"]   
