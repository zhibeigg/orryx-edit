# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS web-build
WORKDIR /workspace
COPY VERSION ./VERSION
COPY web/package.json web/package-lock.json ./web/
RUN --mount=type=cache,target=/root/.npm cd web && npm ci
COPY web ./web
COPY schemas ./schemas
COPY scripts ./scripts
COPY server ./server
RUN cd web && npm run lint && npm run typecheck && npm run test:ci && npm run build && npm run check:bundle && npm run check:secrets

FROM eclipse-temurin:21-jdk-jammy AS server-build
WORKDIR /workspace
COPY VERSION ./VERSION
COPY schemas ./schemas
COPY server ./server
COPY --from=web-build /workspace/server/src/main/resources/static ./server/src/main/resources/static
RUN --mount=type=cache,target=/root/.gradle cd server && ./gradlew --no-daemon test shadowJar

FROM eclipse-temurin:21-jre-jammy AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 orryx \
    && useradd --system --uid 10001 --gid orryx --home-dir /app --shell /usr/sbin/nologin orryx
WORKDIR /app
COPY --from=server-build --chown=orryx:orryx /workspace/server/build/libs/orryx-editor-server-*.jar /app/orryx-editor.jar
RUN mkdir -p /app/data && chown -R orryx:orryx /app
USER 10001:10001
ENV PORT=9090 DATA_DIR=/app/data DEPLOYMENT_MODE=container UPDATE_ENABLED=false
EXPOSE 9090
VOLUME ["/app/data"]
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=4 CMD curl --fail --silent http://127.0.0.1:9090/health/ready || exit 1
ENTRYPOINT ["java", "-jar", "/app/orryx-editor.jar"]
