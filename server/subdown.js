// gzip download and extract.
// created by fuken <https://fuken.xyz>
// will pass the a Buffer object to the callback,
// representing the uncompressed data
var http = require('http');
var zlib = require('zlib');

module.exports = function(url, callback){
  var buf = [];
  http.get(url, function(res){
    res.on('data', function(data){
      buf.push(data);
    });
    res.on('end', function(){
      try{
        var gz       = Buffer.concat(buf);
        var unzipped = zlib.unzipSync(gz);
        callback(null, unzipped);
      }catch(err){
        console.error(err);
        callback(err);
      }
    });
    res.on('error', function(err){
      console.error(err);
      callback(err);
    });
  });
};
