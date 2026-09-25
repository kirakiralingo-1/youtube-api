FROM ghcr.io/imputnet/cobalt:latest

# PO Token Provider（YouTube用）を同梱
RUN apt-get update && apt-get install -y --no-install-recommends nodejs npm && \
    cd /opt && git clone --depth 1 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git pot && \
    cd pot/server && npm install && npx tsc && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server.js ./
COPY index.html ./
COPY package.json ./
RUN npm install --production

EXPOSE 3000
CMD ["sh", "-c", "cd /opt/pot/server && node build/main.js & sleep 3 && node server.js"]   
