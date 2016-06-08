# Alpine is a lightweight Linux
FROM mhart/alpine-node:5

# Update latest available packages
RUN apk update && \
    apk add git && \
    rm -rf /var/cache/apk/* /tmp/* && \
    adduser -D app && \
    mkdir /tmp/torrent-stream && \
    chown app:app /tmp/torrent-stream && \
    npm install -g grunt-cli bower

WORKDIR /home/app
COPY . .
RUN chown app:app /home/app -R

# run as user app from here on
USER app
RUN npm install && \
    bower install && \
    grunt build

VOLUME [ "/tmp/torrent-stream" ]

# run as root in order to expose port 80
USER root
EXPOSE 80 9000

CMD [ "npm", "start" ]
