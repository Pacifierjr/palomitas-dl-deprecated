// gzip download and extract.
// created by fuken <https://fuken.xyz>
// will pass the a Buffer object to the callback,
// representing the uncompressed data

module.exports = function(url, callback){
  var buf = [];
  http.get(sub_url, function(res){
    res.on('data', function(data){
      buf.push(data);
    });
    res.on('end', function(){
      var gz       = Buffer.concat(buf);
      var unzipped = zlib.unzipSync(gz);
      callback(null, unzipped);
    });
    res.on('error', function(err){
      callback(err);
    });
  });
};
