# Use the official Node.js runtime as the base image
FROM node:20-alpine


# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json to the working directory
COPY package*.json ./
RUN npm ci --only=production

# Copy the rest of the application code to the working directory
COPY . .

# Expose the port that the application will run on
EXPOSE 3000

# Start the application
CMD ["npm", "run", "start:prod"]