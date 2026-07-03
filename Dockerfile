FROM node:20-slim
RUN useradd -m -u 1000 user
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY --chown=user . .
USER user
EXPOSE 7860
ENV PORT=7860
CMD ["node", "server.js"]
