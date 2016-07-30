'use strict';

var path = require('path'),
  fs = require('fs'),
  pump = require('pump');

var activeTranscoders = {};

module.exports = function (req, res, torrent, file, hlsMode) {
  var param = req.query.ffmpeg,
    ffmpeg = require('fluent-ffmpeg');


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
        console.log(cmd);
      })
      .on('error', function (err) {
        console.error(err);
      });
    pump(command, res);
  }

  function hls(){
    res.type("application/x-mpegURL");
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
    var lastSlashIndex = file.path.lastIndexOf("/");
    var torrentPath = "/tmp/torrent-stream/"+req.params.infoHash+"/";
    var fileFullPath = torrentPath+file.path.substring(0, lastSlashIndex)+"/";
    var inputPath = fileFullPath+file.name;
    if(activeTranscoders[inputPath] || fs.existsSync(torrentPath+'stream.m3u8')){
      console.log("ATTACH TO ENCODING OF FILE "+inputPath);
      return res.sendfile(torrentPath+'stream.m3u8');
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
        '-segment_list '+torrentPath+'stream.m3u8',
        '-segment_format mpegts'
      ])
      .on('start', function (cmd) {
        activeTranscoders[inputPath] = command;
        console.log("STARTING ENCODING FOR FILE "+inputPath);        
        console.log(cmd);
        res.sendfile(torrentPath+'stream.m3u8');
      })
      .on('error', function (err) {
        if(activeTranscoders[inputPath]) delete activeTranscoders[inputPath];
        console.error(err);
        res.status(500).send("FFMPEG Error");
      })
      .on('end', function(){
        console.log("FINISHED ENCODING FOR FILE "+inputPath);
        if(activeTranscoders[inputPath]) delete activeTranscoders[inputPath];
      })
      .save(torrentPath+'stream%05d.ts');
    
    /*var stream = fs.createReadStream(torrentPath+"stream.m3u8");
    stream.on('error', function (err) {
        console.error(err);
      });
    pump(stream, res);
    */
  }

  switch (param) {
    case 'probe':
      return probe();
    case 'remux':
      return remux();
    default:
      hlsMode? hls() : res.send(501, 'Not supported.');
  }
};
