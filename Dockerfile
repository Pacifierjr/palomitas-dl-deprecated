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

# Install ffmpeg
ENV FFMPEG_VERSION=3.0.2

RUN apk add --update build-base curl nasm tar bzip2 \
  zlib-dev openssl-dev yasm-dev lame-dev libogg-dev x264-dev libvpx-dev libvorbis-dev x265-dev freetype-dev libass-dev libwebp-dev rtmpdump-dev libtheora-dev opus-dev && \

  DIR=$(mktemp -d) && cd ${DIR} && \

  curl -s http://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.gz | tar zxvf - -C . && \
  cd ffmpeg-${FFMPEG_VERSION} && \
  ./configure \
  --enable-version3 --enable-gpl --enable-nonfree --enable-small --enable-libmp3lame --enable-libx264 --enable-libx265 --enable-libvpx --enable-libtheora --enable-libvorbis --enable-libopus --enable-libass --enable-libwebp --enable-librtmp --enable-postproc --enable-avresample --enable-libfreetype --enable-openssl --disable-debug && \
  make && \
  make install && \
  make distclean && \

  rm -rf ${DIR}

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
