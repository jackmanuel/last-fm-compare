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

// User Info Endpoint
app.get('/api/user-info', async (req, res) => {
    const { username } = req.query;

    if (!username) {
        return res.status(400).json({ error: 'Username is required' });
    }

    try {
        const data = await lastFmRequest('user.getInfo', { user: username });
        const user = data.user;

        // Transform the response for our frontend
        const userInfo = {
            username: user.name,
            realname: user.realname,
            playcount: user.playcount,
            registered: user.registered.unixtime, // sending raw timestamp, will format on frontend
            image: user.image[2]['#text'], /* Large image */
            url: user.url
        };

        res.json(userInfo);

    } catch (error) {
        console.error('User Info Error:', error.message);
        res.status(500).json({
            error: 'Failed to fetch user info',
            details: error.response ? error.response.data.message : error.message
        });
    }
});

// Recent Tracks Endpoint (Proxy for user.getRecentTracks)
app.get('/api/recent-tracks', async (req, res) => {
    const { username, limit = 200, page = 1 } = req.query;

    if (!username) {
        return res.status(400).json({ error: 'Username is required' });
    }

    try {
        const data = await lastFmRequest('user.getRecentTracks', {
            user: username,
            limit: limit,
            page: page
        });
        res.json(data);
    } catch (error) {
        console.error('Recent Tracks Error:', error.message);
        res.status(500).json({
            error: 'Failed to fetch recent tracks',
            details: error.response ? error.response.data.message : error.message
        });
    }
});

// Artist Top Tracks Endpoint (Proxy for artist.getTopTracks)
app.get('/api/artist-top-tracks', async (req, res) => {
    const { artist } = req.query;

    if (!artist) {
        return res.status(400).json({ error: 'Artist is required' });
    }

    try {
        const data = await lastFmRequest('artist.getTopTracks', {
            artist: artist,
            limit: 50
        });
        res.json(data);
    } catch (error) {
        console.error('Artist Top Tracks Error:', error.message);
        res.status(500).json({
            error: 'Failed to fetch artist top tracks',
            details: error.response ? error.response.data.message : error.message
        });
    }
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
