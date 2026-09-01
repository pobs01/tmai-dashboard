FROM node:20-alpine

WORKDIR /app

# No npm deps needed — functions use vanilla Node.js
COPY netlify/functions/ ./functions/
COPY prompts.html report.html server.js ./
COPY assets/ ./assets/
COPY hero-glassbox.jpg tmai-chip.jpg ./

EXPOSE 8080
CMD ["node", "server.js"]