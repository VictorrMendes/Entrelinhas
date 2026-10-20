# The PWA (entrelinhas.vmserver.app.br): built with Node, served by nginx, which also passes /api to the api container
FROM node:24-alpine AS build

WORKDIR /web
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm test && npm run build

FROM nginx:1.30-alpine

# the base image's Alpine packages get their security fixes before a newer image is out
RUN apk upgrade --no-cache
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/security-headers.conf
COPY --from=build /web/dist /usr/share/nginx/html
