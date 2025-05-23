FROM node:23-slim

ARG HTTP_PORT=80
EXPOSE ${HTTP_PORT}

WORKDIR /service
ADD . /service

RUN yarn install
RUN yarn build

CMD yarn start