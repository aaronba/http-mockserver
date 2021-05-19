FROM node:12.18.1

# Install npm dependencies
COPY package.json package.json
COPY package-lock.json package-lock.json
RUN npm install

COPY ./bin ./bin
COPY ./__tests__ ./__tests__
COPY ./examples ./examples
COPY ./src ./src

# Start node
CMD ["npm", "run", "start"]
