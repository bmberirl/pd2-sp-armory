// PD2 Armory Twitch Extension - Broadcaster Config Page

// Replace with your deployed Cloudflare Worker URL
var EBS_URL = 'https://ebs.bmberirl.com';

var elChannelId = document.getElementById('channel-id');
var elEnvExample = document.getElementById('env-example');
var elStatus = document.getElementById('status');

if (window.Twitch && window.Twitch.ext) {
  window.Twitch.ext.onAuthorized(function(auth) {
    var cid = auth.channelId;

    elChannelId.textContent = cid;
    elEnvExample.textContent =
      'TWITCH_CHANNEL_ID=' + cid + '\n' +
      'TWITCH_PUSH_SECRET=your_shared_secret_here\n' +
      'TWITCH_EBS_URL=' + EBS_URL;

    // Check if data exists for this channel
    elStatus.className = 'checking';
    elStatus.textContent = 'Checking for character data...';

    fetch(EBS_URL + '/data?channel_id=' + encodeURIComponent(cid))
      .then(function(res) {
        if (res.ok) {
          return res.json().then(function(data) {
            if (Array.isArray(data) && data.length > 0) {
              elStatus.className = 'ok';
              elStatus.textContent = 'Connected! Found ' + data.length + ' character(s): ' +
                data.map(function(c) { return c.name; }).join(', ');
            } else {
              elStatus.className = 'error';
              elStatus.textContent = 'No character data found. Make sure your server is running and push is configured.';
            }
          });
        } else {
          elStatus.className = 'error';
          elStatus.textContent = 'No character data found for this channel. Set up your server and play PD2!';
        }
      })
      .catch(function(err) {
        elStatus.className = 'error';
        elStatus.textContent = 'Could not reach the backend service. Check the EBS_URL in config.js.';
      });
  });
}
