# Use bun as the base image
FROM oven/bun:latest

# Set the working directory inside the container
WORKDIR /app

# Copy package files and install dependencies
COPY package.json bun.lock app.js ./
RUN bun install

# Start the application
CMD ["bun", "run", "app.js"]