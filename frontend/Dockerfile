# Build stage — Node 22 matches the repo engines (>=22) and Vite 8's
# requirement (^20.19 || >=22.12) (Task 12 polish).
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --silent
COPY . .
RUN npm run build

# Production stage
FROM nginx:alpine
WORKDIR /usr/share/nginx/html
COPY --from=builder /app/dist .
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]