FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip && \
    rm -rf /var/lib/apt/lists/* && \
    pip3 install --break-system-packages "yt-dlp[default]"

WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY . .

EXPOSE 3000
CMD ["node", "server.js"]   
