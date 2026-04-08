require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve the API key to the browser as a JS global.
// Falls back to the bundled key if no environment variable is set.
const LASTFM_API_KEY = process.env.LASTFM_API_KEY || '6e84cb28f774f530b391a9fafd327363';
app.get('/config.js', (req, res) => {
    res.type('application/javascript');
    res.send(`window.LASTFM_API_KEY = '${LASTFM_API_KEY}';`);
});

// Serve static files from public directory
app.use(express.static('public'));

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
