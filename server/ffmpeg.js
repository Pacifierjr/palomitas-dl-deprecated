'use strict';

var path = require('path');
var fs   = require('fs');
var pump = require('pump');
var ffmpeg = require('fluent-ffmpeg');

var activeTranscoders = {};

module.exports = function (req, res, torrent, file, hls) {
  var param = req.query.ffmpeg;

  function probe() {
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
        res.send(metadata);
      });
    });
  }

  function remux() {
    res.type('video/webm');
    var command = ffmpeg(file.createReadStream())
      .videoCodec('libvpx').audioCodec('libvorbis').format('webm')
      .audioBitrate(128)
      .videoBitrate(1024)
      .outputOptions([
        //'-threads 2',
        '-deadline realtime',
        '-error-resilient 1'
      ])
      .on('start', function (cmd) {
        console.log("[ffmpeg.js] ", cmd);
      })
      .on('error', function (err) {
        console.error("[ffmpeg.js] ", err);
      });
    res.sendSeekable(command);
  }

  function hlsConvert(){
    /*
    var args = [
			'-i', file.path, '-sn',
			'-async', '1', '-acodec', 'libmp3lame', '-b:a',  '128k', '-ar', '44100', '-ac', '2',
			'-b:v', '1000k', '-vcodec', 'libx264', '-profile:v', 'baseline', '-preset:v' ,'superfast',
			'-x264opts', 'level=3.0',
			'-threads', '0', '-flags', '-global_header', '-map', '0',
			'-f', 'segment',
			'-segment_list', playlistFileName, '-segment_format', 'mpegts', tsOutputFormat
		];
    */

    var listPath    = path.join(torrent.path, 'stream.m3u8');
    var segmentPath = path.join(torrent.path, 'stream%05d.ts');
    var inputPath   = path.join(torrent.path, file.path);

    if(activeTranscoders[inputPath] || fs.existsSync(listPath)){
      console.log("HLS: Requested encoding is being procesed for file: \n"+inputPath);
      res.status(200).json({
        list: "/torrents/"+torrent.infoHash+"/stream.m3u8",
        segments: "/torrents/"+torrent.infoHash+"/stream00001.ts"
      });
      return;
    }
    var command = ffmpeg(inputPath)
      .inputOptions('-async 1')
      .audioCodec('aac')
      .audioBitrate('128k')
      .audioFrequency('44100')
      .audioChannels(2)
      .videoBitrate('1000k')
      .videoCodec('libx264')
      .outputOptions([
        '-profile:v baseline',
        '-preset:v superfast',
        '-crf 25',
        '-x264opts level=3.0',
        '-threads 0',
        '-flags -global_header',
      ])
      .format('segment')
      .outputOptions([
        '-segment_list '+listPath,
        '-segment_format mpegts'
      ])
      .on('start', function (cmd) {
        activeTranscoders[inputPath] = command;
        console.log("HLS: Starting encoding for file: \n"+inputPath);
        console.log("HLS: ffmpeg command: \n");
        console.log("[ffmpeg.js] ", cmd);

        res.status(202).json({
          list: "/torrents/"+torrent.infoHash+"/stream.m3u8",
          segments: "/torrents/"+torrent.infoHash+"/stream00001.ts",
          command: cmd
        });
      })
      .on('error', function (err) {
        delete activeTranscoders[inputPath];
        console.error("[ffmpeg.js] ", err);
        res.status(418).send("FFMPEG Error");
      })
      .on('end', function(){
        console.log("HLS: Finished encoding for file: \n"+inputPath);
        delete activeTranscoders[inputPath];
      })
      .save(segmentPath);
  }

  function subsExtract() {
    res.type('text/vtt')
    var command = ffmpeg(file.createReadStream())
      .noVideo()
      .noAudio()
      .format('webvtt')
      .outputOptions([
        //'-threads 2',
        '-deadline realtime',
        '-error-resilient 1'
      ])
      .on('start', function (cmd) {
        console.log("[ffmpeg.js] ", cmd);
      })
      .on('error', function (err) {
        console.error("[ffmpeg.js] ", err);
      });
      pump(command, res);
  }


  switch (param) {
    case 'probe':
      return probe();
    case 'remux':
      return remux();
    case 'subs':
      return subsExtract();
    default:
      hls? hlsConvert() : res.send(501, 'Not supported.');
  }
};
