// PD2 Armory Twitch Extension Backend Service (Cloudflare Worker)
// Endpoints:
//   POST /push?channel_id=X  — Streamer's server pushes character JSON (per-channel token auth)
//   GET  /data?channel_id=X  — Extension panel fetches character data (public)
//   GET  /admin/token?channel_id=X — Admin generates a token for a streamer (master secret auth)

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

    if (path === '/admin/token' && request.method === 'GET') {
      return handleAdminToken(request, env, url);
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

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}
