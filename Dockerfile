FROM public-cn-beijing.cr.volces.com/public/base:node-16-alpine AS builder
WORKDIR /opt/application/
COPY . .
USER root
RUN npm install --registry=https://registry.npmmirror.com
RUN npm run build

FROM public-cn-beijing.cr.volces.com/public/base:node-16-alpine
WORKDIR /opt/application/
COPY --from=builder /opt/application/dist ./dist
COPY --from=builder /opt/application/client ./client
COPY --from=builder /opt/application/run.sh ./
COPY package.json ./
USER root
RUN npm install --production --registry=https://registry.npmmirror.com
RUN chmod -R 777 /opt/application/run.sh
EXPOSE 8000
CMD /opt/application/run.sh
