'use strict';

var fs          = require('fs');
var path        = require("path");
var express     = require('express');
var api         = express();
var _           = require('lodash');
var rangeParser = require('range-parser');
var pump        = require('pump');
var multipart   = require('connect-multiparty');
var store       = require('./store');
var progress    = require('./progressbar');
var stats       = require('./stats');
var cors        = require('cors');

api.use(express.json());
api.use(express.logger('dev'));
api.use(cors());

function serialize(torrent) {
  if (!torrent.torrent) {
    return { infoHash: torrent.infoHash };
  }
  var pieceLength = torrent.torrent.pieceLength;

  return {
    infoHash: torrent.infoHash,
    name: torrent.torrent.name,
    interested: torrent.amInterested,
    ready: torrent.ready,
    addDate: torrent.addDate,
    files: torrent.files.map(function (f) {
      // jshint -W016
      var start = f.offset / pieceLength | 0;
      var end = (f.offset + f.length - 1) / pieceLength | 0;

      return {
        name: f.name,
        path: f.path,
        link: '/torrents/' + torrent.infoHash + '/files/' + encodeURIComponent(f.path),
        length: f.length,
        offset: f.offset,
        selected: torrent.selection.some(function (s) {
          return s.from <= start && s.to >= end;
        })
      };
    }),
    progress: progress(torrent.bitfield.buffer)
  };
}

function findTorrent(req, res, next) {
  var torrent = req.torrent = store.get(req.params.infoHash);
  if (!torrent) {
    return res.send(404);
  }
  next();
}

api.get('/torrents', function (req, res) {
  res.send(store.list().map(serialize));
});

api.post('/torrents', function (req, res) {
  store.add(req.body.link, function (err, infoHash) {
    if (err) {
      console.error(err);
      res.send(500, err);
    } else {
      res.send({ infoHash: infoHash });
      var time = 1000 * 60 * 60 * 24;
      setTimeout(function deleteAfterOneDay() {
        store.delete(infoHash, function(err) {
          if (err) {
            console.error("Error al borrar el torrent con hash "+infoHash, err)
          }
        })
      }, time)
    }
  });
});

api.post('/upload', multipart(), function (req, res) {
  var file = req.files && req.files.file;
  if (!file) {
    return res.send(500, 'file is missing');
  }
  store.add(file.path, function (err, infoHash) {
    if (err) {
      console.error(err);
      res.send(500, err);
    } else {
      res.send({ infoHash: infoHash });
    }
    fs.unlink(file.path);
  });
});

api.get('/torrents/:infoHash', findTorrent, function (req, res) {
  res.send(serialize(req.torrent));
});

api.post('/torrents/:infoHash/start/:index?', findTorrent, function (req, res) {
  var index = parseInt(req.params.index);
  if (index >= 0 && index < req.torrent.files.length) {
    req.torrent.files[index].select();
  } else {
    req.torrent.files.forEach(function (f) {
      f.select();
    });
  }
  res.send(200);
});

api.post('/torrents/:infoHash/stop/:index?', findTorrent, function (req, res) {
  var index = parseInt(req.params.index);
  if (index >= 0 && index < req.torrent.files.length) {
    req.torrent.files[index].deselect();
  } else {
    req.torrent.files.forEach(function (f) {
      f.deselect();
    });
  }
  res.send(200);
});

api.post('/torrents/:infoHash/pause', findTorrent, function (req, res) {
  req.torrent.swarm.pause();
  res.send(200);
});

api.post('/torrents/:infoHash/resume', findTorrent, function (req, res) {
  req.torrent.swarm.resume();
  res.send(200);
});

api.delete('/torrents/:infoHash', findTorrent, function (req, res) {
  store.remove(req.torrent.infoHash);
  res.send(200);
});

api.get('/torrents/:infoHash/stats', findTorrent, function (req, res) {
  res.send(stats(req.torrent));
});

api.get('/torrents/:infoHash/files', findTorrent, function (req, res) {
  var torrent = req.torrent;
  res.setHeader('Content-Type', 'application/x-mpegurl; charset=utf-8');
  res.send('#EXTM3U\n' + torrent.files.map(function (f) {
      return '#EXTINF:-1,' + f.path + '\n' +
        req.protocol + '://' + req.get('host') + '/torrents/' + torrent.infoHash + '/files/' + encodeURIComponent(f.path);
    }).join('\n'));
});

api.get('/torrents/:infoHash/files.json', findTorrent, function (req, res) {
  var torrent = req.torrent;
  return res.json(torrent.files);
});

// TODO: Esto debe ser un POST
api.all('/torrents/:infoHash/files/:path([^"]+)/hlsConvert', findTorrent, function(req, res){
  var convertToHLS = true;
  var torrent = req.torrent;
  var file    = _.find(torrent.files, { path: req.params.path });
  return require('./ffmpeg')(req, res, torrent, file, convertToHLS);
});
api.get('/torrents/:infoHash/stream.m3u8', findTorrent, function(req, res){
  var torrent  = req.torrent;
  var file     = _.find(torrent.files, { path: req.params.path });
  var filePath = path.join(torrent.path, 'stream.m3u8');
  res.type("application/x-mpegURL");
  return res.sendfile(filePath);
});

api.all('/torrents/:infoHash/:segment', function(req, res){
  if(req.params.segment.indexOf(".ts") === -1){
    console.log("hls segment url called for a file that is not a hls segment");
    return;
  }
  var path = require("path");
  var filePath = "/tmp/torrent-stream/"+req.params.infoHash+"/"+req.params.segment;
  res.type("video/mp2t");
  return res.sendfile(filePath);
})

api.all('/torrents/:infoHash/files/:path([^"]+)', findTorrent, function (req, res) {
  var torrent = req.torrent;
  var file = _.find(torrent.files, { path: req.params.path });

  if(req.params.path.indexOf(".ts") !== -1){
    var filePath = "/tmp/torrent-stream/"+req.params.infoHash+"/"+req.params.path;
    res.type("video/mp2t");
    return res.sendfile(filePath);
  }

  if (!file) {
    return res.send(404);
  }

  if (typeof req.query.ffmpeg !== 'undefined') {
    return require('./ffmpeg')(req, res, torrent, file);
  }

  var range = req.headers.range;
  range = range && rangeParser(file.length, range)[0];
  res.setHeader('Accept-Ranges', 'bytes');
  res.type(file.name);
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

  var stream = file.createReadStream(range);
  pump(stream, res);
});

module.exports = api;
