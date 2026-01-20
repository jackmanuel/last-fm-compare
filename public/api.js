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

export const TOP_TRACKS_LIMIT = 200;

export async function getArtistTopTracks(artist, limit = TOP_TRACKS_LIMIT) {
    return lastFmRequest('artist.getTopTracks', {
        artist: artist,
        limit: limit
    });
}

export async function getArtistInfo(artist, username = null) {
    const params = { artist };
    if (username) {
        params.username = username;
    }
    return lastFmRequest('artist.getInfo', params);
}

export async function getUserTopArtists(username, limit = 10) {
    const data = await lastFmRequest('user.getTopArtists', {
        user: username,
        limit: limit,
        period: 'overall'
    });

    const artists = data.topartists?.artist || [];

    // Last.fm returns a generic placeholder image for top artists,
    // so we need to fetch artist info to get real profile pictures
    const artistsWithImages = await Promise.all(
        artists.map(async (artist) => {
            let image = '/default_pfp.png';
            try {
                const infoData = await lastFmRequest('artist.getInfo', { artist: artist.name });
                const artistInfo = infoData.artist;
                if (artistInfo?.image) {
                    const imgObj = artistInfo.image.find(img => img.size === 'large')
                        || artistInfo.image.find(img => img.size === 'medium')
                        || artistInfo.image[0];
                    // Check if it's not the generic placeholder
                    if (imgObj?.['#text'] && !imgObj['#text'].includes('2a96cbd8b46e442fc41c2b86b821562f')) {
                        image = imgObj['#text'];
                    }
                }
            } catch (e) {
                console.warn(`Failed to fetch artist info for ${artist.name}:`, e.message);
            }

            return {
                name: artist.name,
                playcount: parseInt(artist.playcount) || 0,
                url: artist.url,
                image: image
            };
        })
    );

    return artistsWithImages;
}
