$(document).ready(function(){
    function l(obj){console.log(obj);}

    var $video  = $('#video');
    var $vidurl = $('#vidurl');
    var video   = $video[0];
    var loading = $('#loading');
    var errors  = $('#error');
    var pt      = {};
    pt.ready    = false;
    pt.socket   = io.connect('http://s.fuken.xyz:9000');
    pt.hash     = null;
    pt.magnet   = "";

    pt.socket.on('interested', function (){
        if(pt.hash && !pt.ready){
            $.get('/torrents/'+pt.hash+'/files2', function(files){
                var url = files[0];
                l('Received interested event. Files: \n'+url);
                loadVideo(url);
                loading.fadeOut();
                pt.ready = true;
                pt.socket.emit('play', pt.hash);
            })
        }else if(!pt.hash){
            l('Unable to find torrent. Received "interested" event but no hash was found.')
        }
    });
    pt.socket.on('stats', function(hash, stats){
        console.log("Received stats event. Stats: ");
        console.log(stats);
        if(!pt.ready && !pt.hash) return;
        $("#stats").fadeIn();
        $("#down").text(stats.speed.down);
        $("#up").text(stats.speed.up);
    });

    function loadVideo(url){
        $video.attr('src', url);
        $video.attr('preload', 'auto');
        var a = $('<a target="_blank" href='+url+'>');
        a.text("Abrir en una nueva ventana");
        $vidurl.append(a);
        $video.fadeIn();
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
            setTimeout(function(){
                if(!pt.ready){
                    loading.html("<h3>La carga del video esta tardando mas de lo normal. "+
                                 "Quizas no haya suficientes seeds.</h3>");
                }
            }, 20000);
            l("checking files");
            $.get('/torrents/'+pt.hash+'/files2', function(files){
                if(files && files[0]){
                    var url = files[0];
                    l('Files found: \n'+url);
                    loadVideo(url);
                    loading.fadeOut();
                    pt.ready = true;
                    pt.socket.emit('play', pt.hash);
                }else{
                    console.log('No files yet for '+pt.hash+'. Waiting for interested event');
                }
            }).fail(function(){console.log("Error listing files for "+pt.hash)})
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