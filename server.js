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
        // user.getArtistTracks is deprecated.
        // limit=1000 to cast a wide net for "unusual favorites"
        const userTopTracksData = await lastFmRequest('user.getTopTracks', {
            user: username,
            limit: 1000,
            period: 'overall'
        });

        // Filter for the specific artist
        const allUserTracks = userTopTracksData.toptracks?.track || [];
        const userTracks = allUserTracks.filter(track =>
            track.artist.name.toLowerCase() === artist.toLowerCase()
        );

        console.log(`Found ${userTracks.length} tracks for artist ${artist} in user's top 1000.`);

        // 2. Fetch Community's top tracks for the artist
        // artist.getTopTracks
        const communityTracksData = await lastFmRequest('artist.getTopTracks', {
            artist: artist,
            limit: 50 // Get top 50 community tracks
        });


        const communityTracks = communityTracksData.toptracks?.track || [];

        if (userTracks.length === 0) {
            return res.json({ message: "User hasn't listened to this artist enough or artist not found." });
        }

        // 3. Process and Compare
        // Create a map of song name -> community rank
        const communityRankMap = new Map();
        communityTracks.forEach((track, index) => {
            communityRankMap.set(track.name.toLowerCase(), index + 1);
        });

        const comparison = userTracks.map((userTrack, userIndex) => {
            const userRank = userIndex + 1;
            const communityRank = communityRankMap.get(userTrack.name.toLowerCase()) || 51; // 51 if not in top 50

            // Differential:
            // Positive = User likes it MORE than community (User rank 1 < Community rank 50) -> Comm - User = 49
            // Negative = User likes it LESS than community (User rank 50 > Community rank 1) -> Comm - User = -49
            // However, intuitive score: "Unusual Favorite" score.
            // High score = Unusual favorite.
            // Let's use: Community Rank - User Rank.
            // if song is Comm #50 and User #1, score = 49 (Highly unusual favorite)
            // if song is Comm #1 and User #1, score = 0 (Consensus favorite)
            // if song is Comm #1 and User #50, score = -49 (Unusual dislike/apathy)

            return {
                name: userTrack.name,
                userRank: userRank,
                communityRank: communityRank > 50 ? '>50' : communityRank,
                playcount: parseInt(userTrack.playcount, 10),
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
