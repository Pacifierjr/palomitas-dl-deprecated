$(document).ready(function(){
    function l(obj){console.log(obj);}
    $.get('/torrents', function(torrents){
        if(torrents.length > 0){
            l(torrents.length+' previous torrents found. Sending delete request.');
            torrents.forEach(function(torrent){
                var hash = torrent.infoHash;
                $.ajax({
                    url:  '/torrents/'+hash,
                    type: "DELETE",
                    success: function(){
                        l('Deleted torrent with hash '+hash);
                    },error: function(xhr, status, error){
                        l('Error sending delete request for hash '+hash);
                        l(status+': '+error);
                    }
                });
            });
        }else{
            l('No previous torrents.');
        }
    })
    var loading = $('#loading');
    var errors  = $('#error');
    var pt      = {};
    pt.socket   = io.connect('http://s.fuken.xyz:9000');
    pt.hash     = null;
    pt.magnet   = "";
    pt.socket.on('interested', function(){
        if(pt.hash){
            $.get('/torrents/'+pt.hash+'/files2', function(files){
                l('Received interested event. Files: ');
                l(files[0]+'?ffmpeg=true');
                loadVideo(files[0]+'?ffmpeg=true');
                loading.fadeOut();
            })
        }else{
            l('Unable to find torrent. Received "interested" event but no hash was found.')
        }
    });

    function loadVideo(url){
        var ext = url.substring(url.lastIndexOf(".")+1);
        if(ext !== 'avi'){
            $('video').attr('src', url);
        }else{
            alert('Sorry, avi format is not supported in the browser right now. Please search another link');
        }
    }

    window.playtorrent = function playtorrent(){
        loading.fadeIn();
        var new_magnet = $('input').val();

        pt.magnet = new_magnet;
        l('sending magnet '+pt.magnet+' via post');
        var data = {link: pt.magnet};
        var post_cb = function(response){
            infoHash = response.infoHash;
            l("Magnet sent via post. Received info hash "+infoHash);
            pt.hash = infoHash;
        };
        $.ajax({
            url: '/torrents',
            dataType: 'json',
            type: 'POST',
            data: JSON.stringify(data),
            success: post_cb,
            beforeSend: function (xhr){
                xhr.setRequestHeader("Content-Type","application/json");
                xhr.setRequestHeader("Accept","text/json");
            },
            error: function(xhr, status, error){
                l('Error sending post request for link '+pt.magnet);
                l(status+': '+error);
                loading.hide();
                errors.show();
                setTimeout(function(){
                    errors.fadeOut();
                }, 3000);
            }
        });
    }
});