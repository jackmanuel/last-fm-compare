require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = 3000;
const API_KEY = process.env.LASTFM_API_KEY;
const BASE_URL = 'http://ws.audioscrobbler.com/2.0/';

app.use(express.static('public'));
app.use(express.json());

// Helper to make Last.fm API requests
async function lastFmRequest(method, params) {
    const response = await axios.get(BASE_URL, {
        params: {
            method: method,
            api_key: API_KEY,
            format: 'json',
            ...params
        }
    });
    return response.data;
}

app.get('/api/compare/artist', async (req, res) => {
    const { username, artist } = req.query;

    if (!username || !artist) {
        return res.status(400).json({ error: 'Username and artist are required' });
    }

    if (!API_KEY) {
        return res.status(500).json({ error: 'Server missing Last.fm API Key' });
    }

    try {
        // 1. Fetch User's tracks for the artist
        // user.getRecentTracks as requested (replacing getTopTracks)
        // limit=100 for testing purposes
        const userRecentTracksData = await lastFmRequest('user.getRecentTracks', {
            user: username,
            limit: 100
        });

        // Filter for the specific artist
        // Note: recenttracks structure is different
        const allUserTracks = userRecentTracksData.recenttracks?.track || [];
        const userTracks = allUserTracks.filter(track =>
            track.artist['#text'].toLowerCase() === artist.toLowerCase() // artist is an object in recenttracks
        );

        console.log(`Found ${userTracks.length} tracks for artist ${artist} in user's last 100 scrobbles.`);

        // 2. Fetch Community's top tracks for the artist
        // artist.getTopTracks
        const communityTracksData = await lastFmRequest('artist.getTopTracks', {
            artist: artist,
            limit: 50 // Get top 50 community tracks
        });


        const communityTracks = communityTracksData.toptracks?.track || [];

        if (userTracks.length === 0) {
            return res.json({ message: "User hasn't listened to this artist recently or artist not found." });
        }

        // 3. Process and Compare
        // Create a map of song name -> community rank
        const communityRankMap = new Map();
        communityTracks.forEach((track, index) => {
            communityRankMap.set(track.name.toLowerCase(), index + 1);
        });

        const comparison = userTracks.map((userTrack, userIndex) => {
            const userRank = userIndex + 1; // Rank in "Recency" (1 = most recent)
            const communityRank = communityRankMap.get(userTrack.name.toLowerCase()) || 51; // 51 if not in top 50

            // Differential calculation logic preserved but meaning changes to "Recency vs Popularity"

            return {
                name: userTrack.name,
                userRank: userRank,
                communityRank: communityRank > 50 ? '>50' : communityRank,
                playcount: 1, // Recent tracks don't have playcount, implies 1 listen
                differential: communityRank - userRank,
                url: userTrack.url,
                image: userTrack.image ? userTrack.image[1]['#text'] : null // medium size
            };
        });

        // Sort by differential descending (most "unusual favorites" at top)
        comparison.sort((a, b) => b.differential - a.differential);

        res.json({
            artist: artist, // Use the requested artist name (or could normalize from first track)
            user: username,
            tracks: comparison
        });

    } catch (error) {
        console.error('API Error Details:', {
            message: error.message,
            response: error.response ? error.response.data : 'No response data',
            url: error.config ? error.config.url : 'Unknown URL',
            params: error.config ? error.config.params : 'Unknown params'
        });

        res.status(500).json({
            error: 'Failed to fetch data from Last.fm',
            details: error.response ? error.response.data.message : error.message
        });
    }
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
