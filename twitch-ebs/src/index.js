// PD2 Armory Twitch Extension Backend Service (Cloudflare Worker)
// Endpoints:
//   POST /push?channel_id=X    — Streamer's server pushes character JSON (per-channel token auth)
//   GET  /data?channel_id=X    — Extension panel fetches character data (public)
//   POST /register             — Broadcaster auto-registers via Twitch JWT → gets per-channel token
//   GET  /admin/token?channel_id=X — Admin generates a token for a streamer (master secret auth)
//   POST /oauth/token           — Exchange Twitch OAuth code for channel_id + push token

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// KV entries expire after 7 days of no writes
const KV_EXPIRATION_TTL = 7 * 24 * 60 * 60;

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/push' && request.method === 'POST') {
      return handlePush(request, env, url);
    }

    if (path === '/data' && request.method === 'GET') {
      return handleData(env, url);
    }

    if (path === '/register' && request.method === 'POST') {
      return handleRegister(request, env);
    }

    if (path === '/admin/token' && request.method === 'GET') {
      return handleAdminToken(request, env, url);
    }

    if (path === '/oauth/token' && request.method === 'POST') {
      return handleOAuthToken(request, env);
    }

    return jsonResponse({ error: 'Not found' }, 404);
  },
};

// Generate HMAC-SHA256 token for a channel ID using the master secret
async function generateToken(masterSecret, channelId) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(masterSecret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(channelId));
  return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Verify a Twitch Extension JWT (HS256 signed with base64-decoded EXT_SECRET)
async function verifyTwitchJWT(jwtString, extSecret) {
  const parts = jwtString.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');

  // Decode base64url
  function b64urlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    return Uint8Array.from(atob(str), c => c.charCodeAt(0));
  }

  const headerPayload = parts[0] + '.' + parts[1];
  const signature = b64urlDecode(parts[2]);
  const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));

  // EXT_SECRET from Twitch is base64-encoded
  const secretBytes = Uint8Array.from(atob(extSecret), c => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    'raw', secretBytes,
    { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
  );

  const valid = await crypto.subtle.verify(
    'HMAC', key, signature, new TextEncoder().encode(headerPayload)
  );

  if (!valid) throw new Error('Invalid JWT signature');

  // Check expiration
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('JWT expired');
  }

  return payload;
}

// Broadcaster self-registration: verify Twitch JWT, return per-channel push token
async function handleRegister(request, env) {
  if (!env.EXT_SECRET) {
    return jsonResponse({ error: 'EXT_SECRET not configured' }, 500);
  }

  const auth = request.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Missing Twitch JWT' }, 401);
  }

  let payload;
  try {
    payload = await verifyTwitchJWT(auth.slice(7), env.EXT_SECRET);
  } catch (err) {
    return jsonResponse({ error: 'Invalid JWT: ' + err.message }, 401);
  }

  // Only broadcasters can register
  if (payload.role !== 'broadcaster') {
    return jsonResponse({ error: 'Only the broadcaster can register' }, 403);
  }

  const channelId = payload.channel_id;
  if (!channelId) {
    return jsonResponse({ error: 'No channel_id in JWT' }, 400);
  }

  const token = await generateToken(env.PUSH_SECRET, channelId);

  return jsonResponse({
    channel_id: channelId,
    token: token,
    env_config: `TWITCH_CHANNEL_ID=${channelId}\nTWITCH_PUSH_SECRET=${token}\nTWITCH_EBS_URL=https://ebs.bmberirl.com`,
  });
}

async function handlePush(request, env, url) {
  const channelId = url.searchParams.get('channel_id');
  if (!channelId) {
    return jsonResponse({ error: 'Missing channel_id' }, 400);
  }

  // Verify per-channel token: Bearer <HMAC(master_secret, channel_id)>
  const auth = request.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const token = auth.slice(7);
  const expectedToken = await generateToken(env.PUSH_SECRET, channelId);
  if (token !== expectedToken) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  // Store in KV with TTL
  await env.ARMORY.put(`channel:${channelId}`, JSON.stringify(body), {
    expirationTtl: KV_EXPIRATION_TTL,
  });

  return jsonResponse({ ok: true });
}

async function handleData(env, url) {
  const channelId = url.searchParams.get('channel_id');
  if (!channelId) {
    return jsonResponse({ error: 'Missing channel_id' }, 400);
  }

  const data = await env.ARMORY.get(`channel:${channelId}`);
  if (!data) {
    return jsonResponse({ error: 'No data for this channel' }, 404);
  }

  return new Response(data, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=30',
      ...CORS_HEADERS,
    },
  });
}

// Admin endpoint: generate a per-channel token (requires master secret)
async function handleAdminToken(request, env, url) {
  const auth = request.headers.get('Authorization');
  if (!auth || auth !== `Bearer ${env.PUSH_SECRET}`) {
    return jsonResponse({ error: 'Unauthorized — requires master secret' }, 401);
  }

  const channelId = url.searchParams.get('channel_id');
  if (!channelId) {
    return jsonResponse({ error: 'Missing channel_id' }, 400);
  }

  const token = await generateToken(env.PUSH_SECRET, channelId);

  return jsonResponse({
    channel_id: channelId,
    token: token,
    env_config: `TWITCH_CHANNEL_ID=${channelId}\nTWITCH_PUSH_SECRET=${token}\nTWITCH_EBS_URL=https://ebs.bmberirl.com`,
  });
}

// OAuth code exchange: local server sends auth code, we exchange it with Twitch
async function handleOAuthToken(request, env) {
  if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET) {
    return jsonResponse({ error: 'TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET not configured' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  const { code, redirect_uri } = body;
  if (!code || !redirect_uri) {
    return jsonResponse({ error: 'Missing code or redirect_uri' }, 400);
  }

  // Exchange authorization code for access token
  const tokenRes = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.TWITCH_CLIENT_ID,
      client_secret: env.TWITCH_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri,
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    return jsonResponse({ error: 'Twitch token exchange failed', details: err }, 400);
  }

  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token;

  // Validate token to get user ID
  const validateRes = await fetch('https://id.twitch.tv/oauth2/validate', {
    headers: { 'Authorization': `OAuth ${accessToken}` },
  });

  if (!validateRes.ok) {
    return jsonResponse({ error: 'Token validation failed' }, 400);
  }

  const validateData = await validateRes.json();
  const userId = validateData.user_id;

  if (!userId) {
    return jsonResponse({ error: 'Could not determine user_id' }, 400);
  }

  // Generate per-channel push token
  const pushToken = await generateToken(env.PUSH_SECRET, userId);

  // Revoke the Twitch access token — we only needed it to get the user ID
  await fetch('https://id.twitch.tv/oauth2/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.TWITCH_CLIENT_ID,
      token: accessToken,
    }),
  }).catch(() => {}); // best-effort revoke

  return jsonResponse({
    channel_id: userId,
    token: pushToken,
    ebs_url: 'https://ebs.bmberirl.com',
  });
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}
