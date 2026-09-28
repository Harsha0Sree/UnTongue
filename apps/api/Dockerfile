FROM node:22-slim
WORKDIR /srv
COPY package.json package-lock.json* ./
COPY packages/provider-adapter/package.json ./packages/provider-adapter/
COPY apps/api/package.json ./apps/api/
RUN npm install --workspace @untongue/api --include=prod 2>/dev/null || npm install --workspace apps/api
COPY . .
RUN npm --workspace @untongue/provider-adapter run build || true
RUN npm --workspace @untongue/api run build || true
EXPOSE 8080
CMD ["node", "apps/api/dist/server.js"]
