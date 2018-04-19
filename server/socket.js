'use strict';

var stats = require('./stats');
var https = require('https');
require('dotenv').config();

function sendNotificationToTelegram(torrent) {
  const filename = torrent.torrent && torrent.torrent.name;
  const msg = `New torrent added: \n${filename}`;
  const path = `/bot${encodeURIComponent(process.env.BOT_TOKEN)}/sendMessage?chat_id=${process.env.TG_CHANNEL}&text=${encodeURIComponent(msg)}`;
  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: 'api.telegram.org',
      port: 443,
      path: (path),
      method: 'GET'
    }, res => {
      res.on('data', data => {
        resolve(data);
      })
    })
    request.on('error', err => {
      reject(err);
    })
    request.end();
  })
}

module.exports = function (server) {
  var io = require('socket.io').listen(server),
    _ = require('lodash'),
    progress = require('./progressbar'),
    store = require('./store');
  var users = [];

  io.sockets.on('connection', function (socket) {
    users.push(socket.id);
    console.log("Connected WS client "+socket.id);
    socket.on('disconnect', function(data){
      var index = users.indexOf(socket.id);
      users.splice(index, 1);
      console.log("Disconnected WS client "+socket.id);
    }.bind(this));
    
    
    socket.on('pause', function (infoHash) {
      console.log('pausing ' + infoHash);
      var torrent = store.get(infoHash);
      if (torrent && torrent.swarm) {
        torrent.swarm.pause();
      }
    });
    socket.on('resume', function (infoHash) {
      console.log('resuming ' + infoHash);
      var torrent = store.get(infoHash);
      if (torrent && torrent.swarm) {
        torrent.swarm.resume();
      }
    });
    socket.on('select', function (infoHash, file) {
      console.log('selected ' + infoHash + '/' + file);
      var torrent = store.get(infoHash);
      if (torrent && torrent.files) {
        file = torrent.files[file];
        file.select();
      }
    });
    socket.on('deselect', function (infoHash, file) {
      console.log('deselected ' + infoHash + '/' + file);
      var torrent = store.get(infoHash);
      if (torrent && torrent.files) {
        file = torrent.files[file];
        file.deselect();
      }
    });
  });

  store.on('torrent', function (infoHash, torrent) {
    function listen() {
      var notifyProgress = _.throttle(function () {
        io.sockets.emit('download', infoHash, progress(torrent.bitfield.buffer));
      }, 1000, { trailing: false });

      var notifySelection = _.throttle(function () {
        var pieceLength = torrent.torrent.pieceLength;
        io.sockets.emit('selection', infoHash, torrent.files.map(function (f) {
          // jshint -W016
          var start = f.offset / pieceLength | 0;
          var end = (f.offset + f.length - 1) / pieceLength | 0;
          return torrent.selection.some(function (s) {
            return s.from <= start && s.to >= end;
          });
        }));
      }, 2000, { trailing: false });

      io.sockets.emit('verifying', infoHash, stats(torrent));

      torrent.once('ready', function () {
        io.sockets.emit('ready', infoHash, stats(torrent));
      });

      torrent.on('uninterested', function () {
        io.sockets.emit('uninterested', infoHash);
        notifySelection();
      });

      torrent.on('interested', function () {
        io.sockets.emit('interested', infoHash);
        var torrent = store.get(infoHash);
        sendNotificationToTelegram(torrent);
        notifySelection();
      });

      var interval = setInterval(function () {
        io.sockets.emit('stats', infoHash, stats(torrent));
        notifySelection();
      }, 1000);

      torrent.on('verify', notifyProgress);

      torrent.on('finished', function () {
        io.sockets.emit('finished', infoHash);
        notifySelection();
        notifyProgress();
      });

      torrent.once('destroyed', function () {
        clearInterval(interval);
        io.sockets.emit('destroyed', infoHash);
      });
    }

    if (torrent.torrent) {
      listen();
    } else {
      torrent.once('verifying', listen);
    }
  });
};
