FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY tests ./tests
COPY public ./public
RUN npm test && npm run build

FROM nginx:1.30.4-alpine3.24
COPY infra/nginx/nginx.conf /etc/nginx/nginx.conf
COPY --from=builder /app/dist /usr/share/nginx/html
USER nginx
EXPOSE 80
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
