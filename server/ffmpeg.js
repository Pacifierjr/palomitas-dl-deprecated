'use strict';

var path = require('path'),
  fs = require('fs'),
  pump = require('pump'),
  rangeParser = require('range-parser')

module.exports = function (req, res, torrent, file, range) {
  var param  = req.query.ffmpeg,
      ffmpeg = require('fluent-ffmpeg');

  function probe(cb) {
    var filePath = path.join(torrent.path, file.path);
    fs.exists(filePath, function (exists) {
      if (!exists) {
        return res.send(404, 'File doesn`t exist.');
      }
      return ffmpeg.ffprobe(filePath, function (err, metadata) {
        if (err) {
          console.error(err);
          return res.send(500, err.toString());
        }
        cb ? cb(metadata) : res.send(metadata);
      });
    });
  }

  function headers(file){
    var range = req.headers.range;
    range = range && rangeParser(file.length, range)[0];
    res.setHeader('Accept-Ranges', 'bytes');
    //res.type(file.name);
    req.connection.setTimeout(3600000);

    if (!range) {
      res.setHeader('Content-Length', file.length);
      if (req.method === 'HEAD') {
        return res.end();
      }
      return pump(file.createReadStream(), res);
    }

    res.statusCode = 206;
    res.setHeader('Content-Length', range.end - range.start + 1);
    res.setHeader('Content-Range', 'bytes ' + range.start + '-' + range.end + '/' + file.length);

    if (req.method === 'HEAD') {
      return res.end();
    }
    pump(file.createReadStream(range), res);
  }

  function remux() {
    res.type('video/webm');
    var ext = file.path.substring(file.path.lastIndexOf(".")+1);
    var newpath = path.join(torrent.path, file.path.replace(ext, "webm"));
    var command = ffmpeg(file.createReadStream())
      .seekInput(req.query.seek || 0)
      .inputOptions([
        '-re'
      ])
      .videoCodec('libvpx').audioCodec('libvorbis').format('webm')
      .audioBitrate(128)
      .videoBitrate(1024, true)
      .outputOptions([
        '-preset ultrafast',
        '-c:s copy',
        '-threads 1',
        '-deadline realtime',
        '-error-resilient 1'
      ])
      .on('start', function (cmd) {
        console.log(cmd);
      })
      .on('error', function (err) {
        console.error(err);
      })
    probe(function(data){
      var dur     = data.format.duration;
      var crs     = function(range){ return command; }
      var bitrate = (1024+128)*1000; // video + audio * k
      var len     = dur * bitrate;
      headers({length: len, createReadStream: crs});
    })
    //pump(command, res);
  }

  switch (param) {
    case 'probe':
      return probe();
    case 'remux':
      return remux();
    default:
      res.send(501, 'Not supported.');
  }
};
