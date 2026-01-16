// Last.fm API Client - Direct browser calls
const LASTFM_API_KEY = '6e84cb28f774f530b391a9fafd327363';
const BASE_URL = 'https://ws.audioscrobbler.com/2.0/';

async function lastFmRequest(method, params) {
    const url = new URL(BASE_URL);
    url.searchParams.set('method', method);
    url.searchParams.set('api_key', LASTFM_API_KEY);
    url.searchParams.set('format', 'json');

    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
            url.searchParams.set(key, value);
        }
    }

    const response = await fetch(url);
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `API request failed: ${response.status}`);
    }
    return response.json();
}

export async function getUserInfo(username) {
    const data = await lastFmRequest('user.getInfo', { user: username });
    const user = data.user;

    return {
        username: user.name,
        realname: user.realname,
        playcount: user.playcount,
        registered: user.registered.unixtime,
        image: user.image[2]['#text'] || '/default_pfp.png',
        url: user.url
    };
}

export async function getRecentTracks(username, limit = 200, page = 1) {
    return lastFmRequest('user.getRecentTracks', {
        user: username,
        limit: limit,
        page: page
    });
}

export async function getArtistTopTracks(artist) {
    return lastFmRequest('artist.getTopTracks', {
        artist: artist,
        limit: 100
    });
}

export async function getArtistInfo(artist, username = null) {
    const params = { artist };
    if (username) {
        params.username = username;
    }
    return lastFmRequest('artist.getInfo', params);
}
