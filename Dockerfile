FROM public-cn-beijing.cr.volces.com/public/base:node-16-alpine AS builder
WORKDIR /opt/application/
COPY . .
USER root
RUN npm install --registry=https://registry.npmmirror.com
RUN npm run build

FROM registry.cn-hangzhou.aliyuncs.com/library/node:18-alpine
WORKDIR /opt/application/
COPY --from=builder /opt/application/dist ./dist
COPY --from=builder /opt/application/client ./client
COPY --from=builder /opt/application/run.sh ./
COPY package.json ./
USER root
RUN npm install --production --registry=https://registry.npmmirror.com
RUN chmod +x /opt/application/run.sh
EXPOSE 8000
CMD ["/opt/application/run.sh"]
