# 找眼镜助手 FindMyGlasses — 零依赖容器镜像
FROM node:24-alpine

WORKDIR /app

# 仅复制运行所需文件
COPY package.json server.js ./
COPY src ./src
COPY public ./public

ENV NODE_ENV=production
ENV PORT=8081
EXPOSE 8081

# 数据目录挂载点（SQLite 数据库）
VOLUME ["/app/data"]

CMD ["node", "server.js"]
