FROM node:18-bullseye AS builder

WORKDIR /devel
RUN apt-get update ; apt-get upgrade -y ; apt-get install -y build-essential
COPY . .

ARG VITE_SENTRY_DSN
ARG VITE_SENTRY_TUNNEL
ARG VITE_SENTRY_ENVIRONMENT
ARG VITE_SENTRY_TRACES_SAMPLE_RATE
ARG VITE_SENTRY_DSN
ARG VITE_SENTRY_TUNNEL
ARG VITE_SENTRY_ENVIRONMENT
ARG VITE_SENTRY_TRACES_SAMPLE_RATE
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN \
	VITE_SENTRY_TUNNEL=$VITE_SENTRY_TUNNEL \
	VITE_SENTRY_ENVIRONMENT=$VITE_SENTRY_ENVIRONMENT \
	VITE_SENTRY_TRACES_SAMPLE_RATE=$VITE_SENTRY_TRACES_SAMPLE_RATE

RUN npm i ; npm run build

# Optional
RUN if [ -n "$GLITCHTIP_API_TOKEN" ]; then \
		npx glitchtip-cli sourcemaps inject ./dist/webpage && \
		npx glitchtip-cli sourcemaps upload ./dist/webpage \
		    --url "${GLITCHTIP_URL}" \
			--org "${GLITCHTIP_ORG:-fermo}" \
			--project "${GLITCHTIP_PROJECT:-fermo-client}" ; \
	fi

FROM node:20-alpine

EXPOSE 8080
WORKDIR /exec
RUN apk add --update nodejs npm
COPY --from=builder /devel/ .
RUN adduser -D jankclient

USER jankclient

CMD ["npm", "start"]
