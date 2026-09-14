FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG NEXT_PUBLIC_READER_BACKEND=local
ENV NEXT_PUBLIC_READER_BACKEND=$NEXT_PUBLIC_READER_BACKEND
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV READER_DATA_DIR=/data
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/scripts ./scripts
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "-p", "3000"]
