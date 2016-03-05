'use strict';

var stats = require('./stats');
// keep track of how many users are watching a particular torrent

module.exports = function (server) {
  var io = require('socket.io').listen(server),
    _ = require('lodash'),
    progress = require('./progressbar'),
    store = require('./store'),
    clients  = {};

  var cleanTorrents = function(id){
    console.log("Client "+id+" disconnected. ");
    var client = clients[id];
    if(!client){
      console.error("No client found for id "+id);
      return;
    }
    clients[id].forEach(function(hash){
      var watchers = peopleWatching(hash) - 1;
      console.log(watchers+" people are now watching "+hash);
      if(watchers < 1){
        console.log("No more watchers for "+hash+". Deleting file");
        store.remove(hash);
      }
    })
    delete clients[id];
  }
  var play = function(hash, id){
    console.log("Received play event");
    clients[id] = clients[id] || [];
    if(clients[id].indexOf(hash) === -1) clients[id].push(hash);
    console.log(peopleWatching(hash) + " people are now watching "+hash);
  }
  var peopleWatching = function(hash){
    return Object.keys(clients).filter(function(key){
      var client = clients[key];
      return client && client.indexOf(hash) !== -1;
    }).length;
  }

  io.set('log level', 2);

  io.sockets.on('connection', function (socket) {
    console.log("Client "+socket.id+" connected to socket.io.");
    socket.on('disconnect', function(){
      setTimeout(function(){ cleanTorrents(socket.id); }, 5000);
    });
    socket.on('stop', function(){ cleanTorrents(socket.id); });
    socket.on('play', function (hash){play(hash, socket.id);});
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
        notifySelection();
      });

      var interval = setInterval(function () {
        io.sockets.emit('stats', infoHash, stats(torrent));
        notifySelection();
      }, 1000);

      torrent.on('verify', notifyProgress);

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
