#!/usr/bin/env node
/**
 * Scrobble Cache Helper Script
 * 
 * Downloads all scrobbles for a Last.fm user and saves to a local JSON file.
 * This cached file is used during local development to skip slow API fetches.
 * 
 * Usage:
 *   node scripts/cache-scrobbles.js <username>
 * 
 * Example:
 *   node scripts/cache-scrobbles.js strawberryroot
 */

const fs = require('fs');
const path = require('path');

const LASTFM_API_KEY = '6e84cb28f774f530b391a9fafd327363';
const BASE_URL = 'https://ws.audioscrobbler.com/2.0/';
const SCROBBLE_PAGE_LIMIT = 1000;
const RATE_LIMIT_DELAY_MS = 500; // 2 req/sec to be safe

async function fetchPage(username, page) {
    const url = new URL(BASE_URL);
    url.searchParams.set('method', 'user.getRecentTracks');
    url.searchParams.set('api_key', LASTFM_API_KEY);
    url.searchParams.set('format', 'json');
    url.searchParams.set('user', username);
    url.searchParams.set('limit', SCROBBLE_PAGE_LIMIT);
    url.searchParams.set('page', page);

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
    }
    return response.json();
}

async function main() {
    const username = process.argv[2];

    if (!username) {
        console.error('Usage: node scripts/cache-scrobbles.js <username>');
        process.exit(1);
    }

    console.log(`🎵 Fetching scrobbles for: ${username}`);

    // Ensure cache directory exists
    const cacheDir = path.join(__dirname, '..', 'public', 'cache');
    if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
        console.log(`📁 Created cache directory: ${cacheDir}`);
    }

    const allTracks = [];

    try {
        // Fetch page 1 to get total pages
        console.log('📄 Fetching page 1...');
        const page1Data = await fetchPage(username, 1);

        if (!page1Data.recenttracks) {
            throw new Error('Invalid response from Last.fm - user not found?');
        }

        const totalPages = parseInt(page1Data.recenttracks['@attr'].totalPages);
        const totalTracks = parseInt(page1Data.recenttracks['@attr'].total);

        console.log(`📊 Found ${totalTracks.toLocaleString()} total scrobbles across ${totalPages} pages`);

        // Add page 1 tracks
        if (Array.isArray(page1Data.recenttracks.track)) {
            allTracks.push(...page1Data.recenttracks.track);
        }

        // Fetch remaining pages with progress
        for (let page = 2; page <= totalPages; page++) {
            await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS));

            const progress = Math.round((page / totalPages) * 100);
            process.stdout.write(`\r📄 Fetching page ${page}/${totalPages} (${progress}%)`);

            try {
                const data = await fetchPage(username, page);
                if (data.recenttracks && Array.isArray(data.recenttracks.track)) {
                    allTracks.push(...data.recenttracks.track);
                }
            } catch (err) {
                console.warn(`\n⚠️  Failed to fetch page ${page}: ${err.message}`);
            }
        }

        console.log('\n');

        // Deduplicate by timestamp (same logic as frontend)
        const seen = new Set();
        const dedupedTracks = allTracks.filter(track => {
            if (!track.date?.uts) return false; // Ignore "now playing"
            if (seen.has(track.date.uts)) return false;
            seen.add(track.date.uts);
            return true;
        });

        console.log(`✅ Fetched ${dedupedTracks.length.toLocaleString()} unique scrobbles`);

        // Save to cache file
        const cacheFile = path.join(cacheDir, `${username.toLowerCase()}.json`);
        fs.writeFileSync(cacheFile, JSON.stringify(dedupedTracks, null, 2));

        const fileSizeMB = (fs.statSync(cacheFile).size / (1024 * 1024)).toFixed(2);
        console.log(`💾 Saved to: ${cacheFile} (${fileSizeMB} MB)`);
        console.log('\n🚀 Cache ready! The app will auto-load this when running on localhost.');

    } catch (err) {
        console.error(`\n❌ Error: ${err.message}`);
        process.exit(1);
    }
}

main();
