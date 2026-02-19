// PD2 Armory Twitch Extension - Broadcaster Config Page

var EBS_URL = 'https://ebs.bmberirl.com';

var elChannelId = document.getElementById('channel-id');
var elEnvExample = document.getElementById('env-example');
var elEnvHint = document.getElementById('env-hint');
var elTokenStatus = document.getElementById('token-status');
var elStatus = document.getElementById('status');

if (window.Twitch && window.Twitch.ext) {
  window.Twitch.ext.onAuthorized(function(auth) {
    var cid = auth.channelId;
    elChannelId.textContent = cid;

    // Auto-register: send Twitch JWT to get per-channel push token
    elTokenStatus.className = 'checking';
    elTokenStatus.textContent = 'Generating your credentials...';

    fetch(EBS_URL + '/register', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + auth.token,
        'Content-Type': 'application/json'
      }
    })
      .then(function(res) {
        if (!res.ok) {
          return res.json().then(function(err) {
            throw new Error(err.error || 'HTTP ' + res.status);
          });
        }
        return res.json();
      })
      .then(function(data) {
        elTokenStatus.className = 'ok';
        elTokenStatus.textContent = 'Credentials generated successfully!';
        elEnvExample.textContent = data.env_config;
        elEnvExample.style.display = '';
        elEnvHint.style.display = '';
      })
      .catch(function(err) {
        elTokenStatus.className = 'error';
        elTokenStatus.textContent = 'Could not generate credentials: ' + err.message;
      });

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
        elStatus.textContent = 'Could not reach the backend service.';
      });
  });
}
