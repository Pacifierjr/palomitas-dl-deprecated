// author:               fuken (https://fuken.xyz)
// version:              0.0.1
// dependencies:
//- flatiron's director: https://github.com/flatiron/director
//- handlebars.js        https://handlebarsjs.com
//- jQuery               https://jquery.com

$(document).ready(function(){
    var search      = $('#search')
    var input       = search.find('input');
    var search_btn  = search.find('button');
    var container   = $('#results');
    var loading     = container.html();
    var view_cache  = [];
    var interested  = false;
    var lang        = "spa";
    var epquery     = "";

    var endpoint = 'http://api.tvmaze.com';

    // Cotrollers
    var searchController = function(query){
        showLoading();
        socket.emit('stop');
        $.getJSON(endpoint+'/search/shows?q='+query, function(res){
            if(Array.isArray(res) && res[0]){
                res = res.map(function(r){
                    return parseShow(r.show);
                });
                render('showlist', {results: res});
            }else{
                error('No se encontro ningun show para esta busqueda');
            }
        });
    }
    var showController = function(id){
        showLoading();
        $.getJSON(endpoint+'/shows/'+id+'?embed=episodes', function(show){
            if(show.status === 404){
                error('No se encontro el show con id '+id);
            }else{
                var parsed = parseEpisodes(parseShow(show));
                render('show', parsed);
            }
        });
    }
    var episodeController = function(showid, episodeid){
        showLoading();
        var firstStep = function(){
            var episodeurl = endpoint+'/episodes/'+episodeid;
            var showurl = endpoint+'/shows/'+showid;
            return $.when($.getJSON(episodeurl), $.getJSON(showurl))
        };
        var secondStep = function(ep, show){
            var ep = ep[0],
                show = show[0];
            show.name = show.name.replace("'", "");
            ep.show = show;
            ep.query = getQueryString(ep);
            var torrenturl = 'http://s.fuken.xyz:8000/'+
            console.log("GET torrents from "+torrenturl);
            return $.when(ep, $.getJSON(torrenturl));
        }
        var thirdStep = function(ep, torrents){
            var torrents = torrents[0];
            ep.pages = torrents.totalPages;
            ep.filtered = torrents.filtered;
            ep.torrents = torrents.torrents;
            var hasError = ep.status === 404 || ep.show.status === 404;
            if(hasError){
                error('Error buscando el episodio en las APIs');
            }else{
                var parsed = parseEpisode(ep);
                render('episode', parsed);
            }
        }
        firstStep().then(secondStep).then(thirdStep);
    }

    var peerflix = 'http://s.fuken.xyz:9000';
    var socket   = io.connect(peerflix);
    var hash     = "";
    var videoController = function(_epquery, magnet){
        epquery = _epquery;
        showLoading();
        var postCB = function(result){
            hash = result.hash;
            if(result.status === "wait ws"){
                interested = true;
                console.log("Waiting for interested event");
            }else if(result.status === "ok"){
                onVideoReady(result.files[0], epquery);
            }
        }
        var errorCB = function(xhr, status, err){
            var errmsg = "Error sending magnet to /play : \n"+
                         JSON.stringify(err);
            error(errmsg);
        }
        var postUrl = peerflix+'/play';
        $.ajax({
            url: postUrl,
            type: "POST",
            data: JSON.stringify({link: magnet}),
            success: postCB,
            error:   errorCB,
            beforeSend: function(xhr){
                xhr.setRequestHeader("Content-Type","application/json");
                xhr.setRequestHeader("Accept","text/json");
            }
        });
    }
    var onVideoReady = function(videourl, _epquery){
        var ep = decodeEpQuery(_epquery);
        var subsurl   = 'http://s.fuken.xyz:4000/'+
                          'search?query='+ep.name+'&season='+ep.season+'&episode='+ep.number
                          '&lang='+lang;
        var langsurl  = '/subs/langs'
        console.log("GET subs from "+subsurl);

        var subsReq  = $.getJSON(subsurl);
        var langsReq = $.getJSON(langsurl);

        $.when(subsReq, langsReq)
        .then(function(subs, langs){
            console.dir(subs);
            subs  = parseSubs(subs[0].results);
            langs = langs[0];

            var model = {url: videourl, subs: subs, langs: langs};
            render('video', model, bindLangChange);
            socket.emit('play', hash);
        });
        //loadVideo(videourl);
    }
    /*
    var loadVideo = function(url){
        socket.emit('play', hash);
        $('#media a').attr('href', url);
        $('#video').attr("src", url);
    }*/

    // Binding
    var bindLangChange = function (){
        $("#lang").on('change', function(e){
            var newlang = this.value;
            if(newlang === "" || newlang === lang){
                return;
            }
            else{
                lang = newlang;
                var ep = decodeEpQuery(epquery);
                var subsurl =
                  'http://s.fuken.xyz:4000/'+
                  'search?query='+ep.name+
                  '&season='+ep.season+'&episode='+ep.number+
                  '&lang='+lang;
                console.log("Change subtitles. Sending req to "+subsurl);
                var subs_container = $("#subs");
                var subs_counter   = $("#howmanysubs");
                subs_container.fadeOut();
                $.getJSON(subsurl, function(subs){
                    console.log("Received subs from API. Replacing content");
                    var parsed = parseSubs(subs.results);
                    var subs_tpl =
                    '{{#subs}}'+
                    '<li class="list-group-item">'+
                      '<p>{{name}}</p>'+
                      '<p>'+
                        '<strong>Format: </strong>{{ext}} '+
                        '<strong>Language: </strong>{{lang}} '+
                      '</p>'+
                      '<pre>{{url}}</pre>'+
                    '</li>'+
                    '{{/subs}}';
                    var view = Handlebars.compile(subs_tpl, {strict: true});
                    var rendered = view({subs: parsed});
                    subs_counter.html(parsed.length);
                    subs_container.html(rendered);
                    subs_container.fadeIn();
                });
            }
        })
    }

    search_btn.on('click', function(){
        var query = encode(input.val());
        location.hash='#/search/'+query;
        input.val('');
    });
    input.on('keyup', function(e){
        if(e.which === 13){
            search_btn.click();
        }
    });
    $(document).ajaxError(function(){
        error('Error sending request to the API.');
    });
    socket.on('interested', function(result){
        if(!interested){
            return;
        }
        $.getJSON(peerflix+'/torrents/'+hash+'/files2', function(files){
            onVideoReady(files[0], epquery);
            interested = false;
        });
    });

    // Routing
    Router({
        '/search/:query': searchController,
        '/show/:id': showController,
        '/show/:showid/:episodeid': episodeController,
        '/video/:epquery/:magnet': videoController
    }).configure({
        notfound: function(){
            error('Invalid route.');
        }
    }).init();

    // Helpers
    Handlebars.registerHelper('i', function(val){return ++val;});
    Handlebars.registerHelper('encode', encode);
    Handlebars.registerHelper('json', function(val){
        return JSON.stringify(val);
    });

    function encode(param){
        return encodeURIComponent(param).replace(/'/g, "%27");
    }
    function getQueryString(ep){
        var number = ep.number > 9? ep.number: "0"+ep.number;
        var season = ep.season > 9? ep.season: "0"+ep.season;
        return ep.show.name + " s"+season+"e"+number;
    }
    function decodeEpQuery(_epquery){
        epquery = _epquery;
        epquery = decodeURIComponent(epquery);
        var querysplit = epquery.split(" ");
        // there must be at least 2 string chunks separated by a space
        if(querysplit.length < 2){
            error('Malformed epquery param');
            throw new SyntaxError('Malformed epquery param');
        }
        var lastIndex = querysplit.length - 1
        var numbers   = querysplit[lastIndex];
        var name      = epquery.replace(numbers, "").trim();

        numbers = numbers.replace("s", "");
        numbers = numbers.split("e");
        var season  = parseInt(numbers[0]);
        var episode = parseInt(numbers[1]);
        return {name: name, season: season, number: episode};
    }
    function render(viewName, model, callback){
        function parse(view, callback){
            var rendered = view(model);
            container.html(rendered);
            if(callback) callback();
        }
        //var cached = view_cache.indexOf(viewName) !== -1;
        var cached = false;
        if(!cached) {
            $.get('/tpl/'+viewName+'.hbs', function(tpl){
                var view = Handlebars.compile(tpl, {strict: true})
                view_cache[viewName] = view;
                parse(view, callback);
            });
        }else{
            parse(view_cache[viewName], callback);
        }
    }
    function error(msg){
        render('error', {error: msg});
        console.error(msg);
    }
    function showLoading(){
        container.html(loading);
        socket.emit('stop');
    }
    function parseShow(show){
        var date = show.premiered;
        show.year = date? date.substring(0, 4): false;
        var defaultimg = 'https://placeholdit.imgix.net/~text?txtsize=20&txt=no%20image&w=71&h=100';
        show.poster = show.image && show.image.medium ?
                        show.image.medium : defaultimg;
        if(show.runtime) show.runtime += ' min';
        show.network = show.network || show.webChannel;
        show.encodedName = encode(show.name);
        return show;
    }
    function parseEpisodes(show){
        var seasons = [];
        show._embedded.episodes.forEach(function(ep){
            if(!seasons[ep.season-1]){
                seasons[ep.season-1] = [];
            }
            seasons[ep.season-1].push(ep);
        });
        show.numSeasons  = seasons.length;
        show.numEpisodes = show._embedded.episodes.length;
        show.seasons     = seasons;
        return show;
    }
    function parseEpisode(ep){
        var defaultimg = 'https://placeholdit.imgix.net/~text?txtsize=20&txt=no%20image&w=71&h=100';
        ep.poster = ep.image && ep.image.medium ?
                    ep.image.medium : defaultimg;
        var name = ep.url.substr(ep.url.lastIndexOf('/')+1);
        name = name.replace(/-/g, ' ');
        var firstLetter = name.charAt(0);
        ep.fullname = name.replace(/^./, firstLetter.toUpperCase());
        ep.torrents = ep.torrents.filter(function(torrent){
            return  torrent.seeds > 0 &&
                    torrent.magnet &&
                    torrent.magnet.indexOf("no_trackers_found") === -1;
        })
        return ep;
    }
    function parseSubs(subs){
        return subs.map(function(sub){
            return {
                name: sub.release_name,
                ext:  sub.sub_format,
                lang: sub.language,
                url:  sub.sub_download
            };
        });
    }

    container.html('');
});