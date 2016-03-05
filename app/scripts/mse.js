$(function setupMSE(){
    var BasicPlayer = function(){
        var self = this;
        this.init = function(srcFile){
            if(!window.MediaSource ||
               !MediaSource.isTypeSupported('video/webm; codecs="vp8,vorbis"')){
                self.setState("Your browser does not support this player :c");
                return;
            }
            self.clean();
            self.srcFile = srcFile;
            self.setState("Creating media source");
            // create video element
            self.videoEl = $('<video controls></video>')[0];
            // create media source and attach listener
            self.mediaSource = new MediaSource();
            self.mediaSource.addEventListener('sourceopen', function(){
                self.setState("Creating source buffer");
                // create the source buffer when the media source is opened
                self.createSourceBuffer();
            }, false);
            // attach media source to video in DOM
            self.videoEl.src = window.URL.createObjectURL(self.mediaSource);
            $('#player-video').html($(self.videoEl));
        }
        this.setState = function(state){
            //clearTimeout(self.stateTimeout);
            var logger = $('#player-log');
            logger.html(state);
            /*
            logger.fadeIn();
            self.stateTimeout = setTimeout(function(){
                logger.fadeOut();
            }, 5000);
            */
        }
        this.clean = function(){
            if(self.videoEl){
                $(self.videoEl).remove();
                delete self.mediaSource;
                delete self.sourceBuffer;
            }
        }
        this.createSourceBuffer = function(){
            self.sourceBuffer = self.mediaSource.addSourceBuffer('video/webm; codecs="vp9,opus"');
            self.sourceBuffer.addEventListener('updateend', function () {
                self.setState("Ready");
            }, false);
            var xhr = new XMLHttpRequest();
            xhr.open('GET', self.srcFile, true);
            xhr.responseType = 'arraybuffer';
            xhr.onload = function (e) {
                if (xhr.status !== 200) {
                    self.setState("Failed to download video data");
                    self.clean();
                } else {
                    var arr = new Uint8Array(xhr.response);
                    if (!self.sourceBuffer.updating) {
                        self.setState("Appending video data to buffer");
                        self.sourceBuffer.appendBuffer(arr);
                    } else {
                        self.setState("Source Buffer failed to update");
                    }
                }
            };
            xhr.onerror = function () {
              self.setState("Failed to download video data");
              self.clean();
            };
            xhr.send();
            self.setState("Downloading video data");
        }
    };

    var player = new BasicPlayer();
    window.updatePlayer = function(){
        var srcFile = $("#player-source").val();
        player.init(srcFile);
    }
});