'use strict';

var rangeParser = require('range-parser'),
  pump = require('pump'),
  _ = require('lodash'),
  express = require('express'),
  bodyParser = require('body-parser'),
  multer = require('multer'),
  multipart = require('connect-multiparty'),
  fs = require('fs'),
  store = require('./store'),
  progress = require('./progressbar'),
  stats = require('./stats'),
  api = express(),
  logger = require('morgan'),
  ffmpeg = require('fluent-ffmpeg'),
  subdown = require('./subdown'),
  path = require('path');

api.use(bodyParser.urlencoded({extended: true}));
api.use(bodyParser.json());
api.use(logger('dev'));
api.use(function (req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'OPTIONS, POST, GET, PUT, DELETE');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

api.set('json spaces', 2);

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

api.post('/testpost', function(req, res){
  console.log('received post: ');
  console.log(req.body);
  res.send('You just sent '+JSON.stringify(req.body));
});

api.post('/torrents', function (req, res) {
  console.log('received post: ');
  console.log(req.body);
  store.add(req.body.link, function (err, infoHash) {
    if (err) {
      console.error(err);
      res.send(500, err);
    } else {
      res.send({ infoHash: infoHash });
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

api.get('/torrents/:infoHash/files2', findTorrent, function (req, res) {
  var torrent = req.torrent;
  ffmpeg.getAvailableFormats(function(err, formats){
    torrent.files = torrent.files.filter(function(f){
      var ext = f.path.substring(f.path.lastIndexOf('.')+1);
      return formats[ext] && formats[ext].canDemux;
    });
    res.json(torrent.files.map(function (f) {
      return req.protocol + '://' + req.get('host')+
      '/torrents/' + torrent.infoHash+
      '/files/'    + encodeURIComponent(f.path);
    }));
  });
});

api.post('/play', function(req, res, next){
  var magnet = decodeURIComponent(req.body.link);
  console.log("/play received magnet: \n "+magnet);

  if(!magnet){
    console.error("Magnet link not found in post to /play");
    return res.status(500).send();
  }

  var parsed = require('magnet-uri')(magnet);
  if(!(parsed && parsed.infoHash)){
    console.log("Cannot parse magnet link "+magnet);
    return res.status(500).send();
  }

  var torrent = store.get(parsed.infoHash);
  if ( !(torrent && torrent.files && torrent.files[0]) ) {
    // torrent not stored previously.
    // add torrent and tell client to wait for interested event
    store.add(magnet, function (err, infoHash) {
      if (err) {
        console.error("Error in store.add");
        console.error(err);
        res.send(500, err);
      } else {
        res.json({hash: infoHash,
                  status: "wait ws",
                  message: "wait for interested event on websocket"});
      }
    });
  }else{
    // torrent found
    // send file links
    ffmpeg.getAvailableFormats(function(err, formats){
      torrent.files = torrent.files.filter(function(f){
        var ext = f.path.substring(f.path.lastIndexOf('.')+1);
        return formats[ext] && formats[ext].canDemux;
      });
      var files = torrent.files.map(function (f) {
        return req.protocol + '://' + req.get('host')+
        '/torrents/' + torrent.infoHash+
        '/files/'    + encodeURIComponent(f.path);
      });
      res.json({hash: parsed.infoHash, status: "ok", files: files});
    });
  }
});

api.get('/subs/langs', function(req, res){
  res.sendFile(path.join(__dirname, 'langs.json'));
})

api.get('/subs/:url', function(req, res){
  var url = req.params.url;
  if(url.indexOf('http') === -1){
    console.error("/subs/:url received malformed url param: \n\t"+url);
    res.status(400).send("400 Bad Request: Malformed URL param");
  }
  subdown(url, function(err, subs){
    if(err){
      res.send(500, err.toString());
    }else{
      var lines = subs.toString().split('\r\n\r\n');
      subs = lines.map(function(line){
        var text = line.split('\r\n');
        var id   = text.shift();
        var time = text.shift();
        var time = time.split(' --> ');
        var res = {id: id, time: {start: time[0], end: time[1]}, text: text.join('\r\n')};
        if(!(res.id && res.time.start && res.time.end && res.text )){
          throw new SyntaxError("subid: "+id+" Malformed subtitles archive from opensubtitles.")
        }
        return res;
      });

      res.json(subs);
    }
  });
});

api.all('/torrents/:infoHash/files/:path([^"]+)', findTorrent, function (req, res) {
  var torrent = req.torrent, file = _.find(torrent.files, { path: req.params.path });

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
  pump(file.createReadStream(range), res);
});

module.exports = api;
