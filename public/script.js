import { getUserInfo, getRecentTracks, getArtistTopTracks, getArtistInfo, TOP_TRACKS_LIMIT } from './api.js';

// Rate limiting constants (Last.fm API limits: 5 requests/second)
const RATE_LIMIT_DELAY_MS = 200;        // 5 req/sec for artist.getInfo calls
const SCROBBLE_FETCH_DELAY_MS = 500;    // Conservative 2 req/sec for history pages
const RETRY_BASE_DELAY_MS = 1000;       // Base delay for exponential backoff
const MAX_RETRIES = 2;                  // Max retry attempts per failed page
const SCROBBLE_PAGE_LIMIT = 1000;       // Max tracks per page

const userForm = document.getElementById('userForm');
const compareForm = document.getElementById('compareForm');
const loading = document.getElementById('loading');
const results = document.getElementById('results');
const errorDiv = document.getElementById('error');
const tracksList = document.getElementById('tracksList');
const resultHeader = document.getElementById('resultHeader');
const userInfoDiv = document.getElementById('userInfo');
const userInfo2Div = document.getElementById('userInfo2');
const userInfoContainer = document.getElementById('userInfoContainer');
const stepLoadHistoryDiv = document.getElementById('step-load-history');
const loadHistoryBtn = document.getElementById('loadHistoryBtn');
const step2Div = document.getElementById('step2-compare');
const userStepDiv = document.getElementById('step1-user');
const stepTopArtistsDiv = document.getElementById('step-top-artists');
const topArtistsGrid = document.getElementById('topArtistsGrid');

// Mode toggle elements
const modeCommunityBtn = document.getElementById('modeCommunityBtn');
const modeUserBtn = document.getElementById('modeUserBtn');
const user2InputGroup = document.getElementById('user2InputGroup');
const user1Label = document.getElementById('user1Label');
const checkUserBtn = document.getElementById('checkUserBtn');

// Filter UI Logic
const filterCheckbox = document.getElementById('filterEnabled');
const filterThresholdInput = document.getElementById('filterThreshold');
const artistInfoDiv = document.getElementById('artistInfo');

if (filterCheckbox && filterThresholdInput) {
    // Toggle input state
    filterCheckbox.addEventListener('change', () => {
        filterThresholdInput.disabled = !filterCheckbox.checked;
        filterThresholdInput.parentElement.style.opacity = filterCheckbox.checked ? '1' : '0.5';
        applyFilterAndDisplay();
    });

    // Live update on number change
    filterThresholdInput.addEventListener('input', () => {
        applyFilterAndDisplay();
    });
}

// State
let comparisonMode = 'community'; // 'community' or 'user'
let validatedUsername = null;
let validatedUsername2 = null;
let cachedUserTracks = [];
let cachedUser2Tracks = [];
let globalComparisonData = null; // Store full comparison results
let cachedArtistInfo = new Map(); // Cache artist info including images
let cachedArtistTopTracks = new Map(); // Cache artist.getTopTracks results

// Top artists user switching (for user-to-user mode)
let currentTopArtistsUser = 1; // Which user's top 10 is displayed
let cachedUser1TopArtists = null; // Loaded top artists for user 1
let cachedUser2TopArtists = null; // Pre-loaded top artists for user 2
let user2TopArtistsLoading = false; // Is user 2's top artists loading in background?

// Mode Toggle Handlers
function setComparisonMode(mode) {
    comparisonMode = mode;

    // Update button states
    modeCommunityBtn.classList.toggle('active', mode === 'community');
    modeUserBtn.classList.toggle('active', mode === 'user');

    // Show/hide user 2 input
    if (mode === 'user') {
        user2InputGroup.classList.remove('hidden');
        user1Label.textContent = 'User 1';
        checkUserBtn.textContent = 'Check Users';
        document.getElementById('username2').setAttribute('required', '');
    } else {
        user2InputGroup.classList.add('hidden');
        user1Label.textContent = 'Last.fm Username';
        checkUserBtn.textContent = 'Check User';
        document.getElementById('username2').removeAttribute('required');
    }

    // Reset state when mode changes
    resetUI();
    validatedUsername = null;
    validatedUsername2 = null;
    cachedUserTracks = [];
    cachedUser2Tracks = [];
    globalComparisonData = null;
    currentTopArtistsUser = 1;
    cachedUser1TopArtists = null;
    cachedUser2TopArtists = null;
    user2TopArtistsLoading = false;
}

modeCommunityBtn.addEventListener('click', () => setComparisonMode('community'));
modeUserBtn.addEventListener('click', () => setComparisonMode('user'));

// Swap top artists button (user-to-user mode)
const swapTopArtistsBtn = document.getElementById('swapTopArtistsBtn');
if (swapTopArtistsBtn) {
    swapTopArtistsBtn.addEventListener('click', () => switchTopArtistsUser());
}


// Step 1: Check User(s)
userForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const usernameInput = document.getElementById('username');
    const username = usernameInput.value.trim();
    const username2Input = document.getElementById('username2');
    const username2 = username2Input.value.trim();

    if (!username) return;
    if (comparisonMode === 'user' && !username2) return;

    // Reset UI
    resetUI();
    globalComparisonData = null; // Clear old data

    // Show simple loading for user info
    const loadingDiv = document.getElementById('loading');
    const statusText = document.querySelector('.progress-status');
    const progressBarContainer = document.querySelector('.progress-bar-bg');
    const progressStats = document.querySelector('.progress-stats');

    loadingDiv.classList.remove('hidden');
    statusText.textContent = comparisonMode === 'user' ? "Fetching user info..." : "Fetching user info...";

    // Hide progress bar elements during user lookup
    progressBarContainer.style.display = 'none';
    progressStats.style.display = 'none';

    try {
        if (comparisonMode === 'community') {
            // Community mode: single user
            const data = await getUserInfo(username);
            loadingDiv.classList.add('hidden');
            displayUserInfo(data, userInfoDiv, null, 1);
            validatedUsername = data.username;
            userInfoContainer.classList.remove('hidden');
            userInfo2Div.classList.add('hidden');
        } else {
            // User mode: validate both users in parallel
            statusText.textContent = "Fetching both users' info...";
            const [data1, data2] = await Promise.all([
                getUserInfo(username),
                getUserInfo(username2)
            ]);
            loadingDiv.classList.add('hidden');
            displayUserInfo(data1, userInfoDiv, null, 1);
            displayUserInfo(data2, userInfo2Div, null, 2);
            validatedUsername = data1.username;
            validatedUsername2 = data2.username;
            userInfoContainer.classList.remove('hidden');
            userInfo2Div.classList.remove('hidden');
        }

        // Show Load History Step
        stepLoadHistoryDiv.classList.remove('hidden');
        // Update button text for user mode
        if (comparisonMode === 'user') {
            loadHistoryBtn.textContent = 'Load Scrobble Histories';
            document.querySelector('#step-load-history .hint-text').textContent =
                'This will fetch all scrobbles for both users. This may take a few minutes.';
        } else {
            loadHistoryBtn.textContent = 'Load Scrobble History';
            document.querySelector('#step-load-history .hint-text').textContent =
                'This will fetch all of your scrobbles. This may take a few minutes.';
        }
        userStepDiv.classList.add('hidden');

    } catch (err) {
        loadingDiv.classList.add('hidden');
        showError(err.message);
    }
});

// Step 2: Load History
loadHistoryBtn.addEventListener('click', async () => {
    if (!validatedUsername) return;
    if (comparisonMode === 'user' && !validatedUsername2) return;

    // Clear any previous error immediately
    errorDiv.classList.add('hidden');

    stepLoadHistoryDiv.classList.add('hidden');

    if (comparisonMode === 'user') {
        // Check which users need fetching (preserve cached data)
        const needsUser1 = cachedUserTracks.length === 0;
        const needsUser2 = cachedUser2Tracks.length === 0;

        if (needsUser1 && needsUser2) {
            // Both need fetching - parallel fetch
            await fetchAllScrobblesParallel();
        } else if (needsUser1 || needsUser2) {
            // Only one user needs fetching
            await fetchSingleUserForParallelMode(needsUser1 ? 1 : 2);
        } else {
            // Both already cached, just show the UI
            step2Div.classList.remove('hidden');
            // Use cached top artists if available
            currentTopArtistsUser = 1;
            if (cachedUser1TopArtists) {
                displayTopArtists(cachedUser1TopArtists, validatedUsername);
                stepTopArtistsDiv.classList.remove('hidden');
            } else {
                await loadTopArtistsForUser(1);
            }
            if (!cachedUser2TopArtists && !user2TopArtistsLoading) {
                loadUser2TopArtistsInBackground();
            }
        }
    } else {
        // Community mode: single user fetch
        cachedUserTracks = [];
        await fetchAllScrobbles(validatedUsername, (tracks) => {
            cachedUserTracks = tracks;
        }, 'User 1');
    }
});

async function fetchAllScrobbles(username = validatedUsername, setTracks = (tracks) => { cachedUserTracks = tracks; }, userLabel = '') {
    // Clear any previous error
    errorDiv.classList.add('hidden');

    // Show Progress UI
    const loadingDiv = document.getElementById('loading');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    const pagesText = document.getElementById('pagesText');
    const statusText = document.querySelector('.progress-status');

    loadingDiv.classList.remove('hidden');

    let collectedTracks = [];

    // DEV MODE: Check for cached scrobbles when running on localhost
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        try {
            statusText.textContent = userLabel ? `Checking for cached scrobbles (${userLabel})...` : 'Checking for cached scrobbles...';
            const cacheResponse = await fetch(`/cache/${username.toLowerCase()}.json`);
            if (cacheResponse.ok) {
                collectedTracks = await cacheResponse.json();
                console.log(`🚀 Loaded ${collectedTracks.length.toLocaleString()} scrobbles from cache for ${username}`);
                setTracks(collectedTracks);

                // Skip to showing results (same as end of normal fetch)
                loadingDiv.classList.add('hidden');
                step2Div.classList.remove('hidden');

                // Still fetch top artists with images (only for user 1)
                if (!userLabel || userLabel === 'User 1') {
                    await loadTopArtistsFromCache();
                }
                return collectedTracks;
            }
        } catch (e) {
            // No cache found, proceed with normal API fetch
            console.log('No cache found, fetching from API...');
        }
    }

    // Restore progress bar visibility
    const progressBarContainer = document.querySelector('.progress-bar-bg');
    const progressStatsContainer = document.querySelector('.progress-stats');
    if (progressBarContainer) progressBarContainer.style.display = 'block';
    if (progressStatsContainer) progressStatsContainer.style.display = 'flex';

    progressBar.style.width = '0%';
    progressText.textContent = '0%';
    pagesText.textContent = 'Initializing...';
    statusText.textContent = userLabel ? `Fetching ${userLabel}'s listening history...` : 'Fetching full listening history...';

    let failedPages = []; // Track pages that failed even after retries

    try {
        // 1. Fetch Page 1 to get total pages
        const page1Data = await getRecentTracks(username, SCROBBLE_PAGE_LIMIT, 1);

        const recentTracksIdx = page1Data.recenttracks;
        if (!recentTracksIdx) throw new Error('Invalid response from Last.fm');

        const totalPages = parseInt(recentTracksIdx['@attr'].totalPages);

        // Add page 1 tracks
        if (Array.isArray(recentTracksIdx.track)) {
            collectedTracks.push(...recentTracksIdx.track);
        }

        // Update Progress
        updateProgress(1, totalPages, progressBar, progressText, pagesText);

        // Track when each request starts for smart rate limiting
        let lastRequestTime = Date.now();

        // Loop for remaining pages
        for (let page = 2; page <= totalPages; page++) {
            // Smart rate limiting: only wait if we're going faster than the limit
            const elapsed = Date.now() - lastRequestTime;
            if (elapsed < SCROBBLE_FETCH_DELAY_MS) {
                await new Promise(resolve => setTimeout(resolve, SCROBBLE_FETCH_DELAY_MS - elapsed));
            }
            lastRequestTime = Date.now();

            let success = false;
            for (let attempt = 0; attempt <= MAX_RETRIES && !success; attempt++) {
                try {
                    if (attempt > 0) {
                        // Exponential backoff for retries: 1s, 2s
                        const retryDelay = RETRY_BASE_DELAY_MS * attempt;
                        console.log(`Retry ${attempt} for page ${page} after ${retryDelay}ms...`);
                        await new Promise(resolve => setTimeout(resolve, retryDelay));
                        // Reset timing after retry delay so we don't double-wait
                        lastRequestTime = Date.now();
                    }

                    const data = await getRecentTracks(username, SCROBBLE_PAGE_LIMIT, page);

                    if (data.recenttracks && Array.isArray(data.recenttracks.track)) {
                        collectedTracks.push(...data.recenttracks.track);
                    }
                    success = true;
                } catch (pageError) {
                    console.warn(`Failed to fetch page ${page}, attempt ${attempt + 1}/${MAX_RETRIES + 1}:`, pageError.message);
                }
            }

            if (!success) {
                failedPages.push(page);
                console.error(`Page ${page} failed after ${MAX_RETRIES + 1} attempts, skipping.`);
            }

            updateProgress(page, totalPages, progressBar, progressText, pagesText);
        }

        // Deduplicate scrobbles by timestamp to prevent double-counting
        // (can happen if browser retries pages or resumes from sleep)
        // Also filters out "now playing" tracks which have no timestamp
        const seen = new Set();
        collectedTracks = collectedTracks.filter(track => {
            if (!track.date?.uts) return false; // Ignore "now playing" tracks
            if (seen.has(track.date.uts)) return false;
            seen.add(track.date.uts);
            return true;
        });

        // Store in appropriate cache
        setTracks(collectedTracks);

        // Done Loading
        loadingDiv.classList.add('hidden');
        step2Div.classList.remove('hidden'); // Show Compare Step

        // Show warning if some pages failed
        if (failedPages.length > 0) {
            const failedPercent = Math.round((failedPages.length / totalPages) * 100);
            const warn = userLabel ? `${userLabel}: ` : '';
            showWarning(`${warn}Warning: ${failedPages.length} of ${totalPages} pages failed to load (~${failedPercent}% of scrobbles may be missing). Results may be incomplete.`);
        }

        // Compute top 10 artists from scrobble corpus and fetch their info (only for user 1)
        if (!userLabel || userLabel === 'User 1') {
            try {
                const topArtists = getTopArtistsFromScrobbles(collectedTracks, 10);
                if (topArtists.length > 0) {
                    // Immediately show skeleton placeholders and hide loading message
                    displayTopArtistSkeletons(topArtists.length);

                    // Fetch artist info with rate limiting (5 requests per second = 200ms delay)
                    const artistsWithInfo = [];
                    for (let i = 0; i < topArtists.length; i++) {
                        const artist = topArtists[i];
                        try {
                            const artistInfo = await fetchArtistInfo(artist.name);
                            if (artistInfo) {
                                // Cache the artist info for later use during comparison
                                cachedArtistInfo.set(artist.name.toLowerCase(), artistInfo);

                                // Get image from artist info
                                let image = '/default_pfp.png';
                                if (artistInfo.image) {
                                    const imgObj = artistInfo.image.find(img => img.size === 'large')
                                        || artistInfo.image.find(img => img.size === 'medium')
                                        || artistInfo.image[0];
                                    if (imgObj?.['#text'] && imgObj['#text'].trim() !== '') {
                                        image = imgObj['#text'];
                                    }
                                }
                                artistsWithInfo.push({
                                    name: artistInfo.name, // Use canonical name
                                    playcount: artist.playcount,
                                    url: artistInfo.url,
                                    image: image
                                });
                            } else {
                                artistsWithInfo.push({
                                    name: artist.name,
                                    playcount: artist.playcount,
                                    url: `https://www.last.fm/music/${encodeURIComponent(artist.name)}`,
                                    image: '/default_pfp.png'
                                });
                            }
                        } catch (e) {
                            console.warn(`Failed to fetch info for ${artist.name}:`, e);
                            artistsWithInfo.push({
                                name: artist.name,
                                playcount: artist.playcount,
                                url: `https://www.last.fm/music/${encodeURIComponent(artist.name)}`,
                                image: '/default_pfp.png'
                            });
                        }

                        // Rate limit delay between artist info requests
                        if (i < topArtists.length - 1) {
                            await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
                        }
                    }

                    displayTopArtists(artistsWithInfo);
                }
            } catch (topArtistsErr) {
                console.warn('Failed to process top artists:', topArtistsErr);
                // Non-critical error, just don't show the grid
            }
        }

        return collectedTracks;

    } catch (err) {
        loadingDiv.classList.add('hidden');
        stepLoadHistoryDiv.classList.remove('hidden'); // Show button again on fail
        showError("Failed to load history. Please try again.");
        return [];
    }
}

// Parallel fetch for user-to-user mode
async function fetchAllScrobblesParallel() {
    // Clear any previous error
    errorDiv.classList.add('hidden');

    const loadingDiv = document.getElementById('loading');
    const statusText = document.querySelector('.progress-status');
    const singleUserProgress = document.getElementById('singleUserProgress');
    const dualUserProgress = document.getElementById('dualUserProgress');

    // Get dual progress bar elements
    const progressBar1 = document.getElementById('progressBar1');
    const progressBar2 = document.getElementById('progressBar2');
    const pagesText1 = document.getElementById('pagesText1');
    const pagesText2 = document.getElementById('pagesText2');
    const user1ProgressLabel = document.getElementById('user1ProgressLabel');
    const user2ProgressLabel = document.getElementById('user2ProgressLabel');

    loadingDiv.classList.remove('hidden');
    statusText.textContent = 'Fetching scrobbles for both users...';

    // Show dual progress bars, hide single
    singleUserProgress.classList.add('hidden');
    dualUserProgress.classList.remove('hidden');

    // Set usernames as labels
    user1ProgressLabel.textContent = validatedUsername;
    user2ProgressLabel.textContent = validatedUsername2;

    // Reset progress bars
    progressBar1.style.width = '0%';
    progressBar2.style.width = '0%';
    pagesText1.textContent = '...';
    pagesText2.textContent = '...';

    try {
        // Fetch both users in parallel with progress callbacks
        const results = await Promise.all([
            fetchUserScrobblesWithProgress(validatedUsername, (current, total) => {
                const pct = Math.round((current / total) * 100);
                progressBar1.style.width = `${pct}%`;
                pagesText1.textContent = `${current}/${total}`;
            }),
            fetchUserScrobblesWithProgress(validatedUsername2, (current, total) => {
                const pct = Math.round((current / total) * 100);
                progressBar2.style.width = `${pct}%`;
                pagesText2.textContent = `${current}/${total}`;
            })
        ]);

        cachedUserTracks = results[0];
        cachedUser2Tracks = results[1];

        // Reset progress visibility
        singleUserProgress.classList.remove('hidden');
        dualUserProgress.classList.add('hidden');

        loadingDiv.classList.add('hidden');
        step2Div.classList.remove('hidden');

        console.log(`✅ User 1 (${validatedUsername}): ${cachedUserTracks.length.toLocaleString()} scrobbles`);
        console.log(`✅ User 2 (${validatedUsername2}): ${cachedUser2Tracks.length.toLocaleString()} scrobbles`);

        // Reset top artists state for user mode
        currentTopArtistsUser = 1;
        cachedUser1TopArtists = null;
        cachedUser2TopArtists = null;
        user2TopArtistsLoading = false;

        // Load User 1's top artists first (with their username in header)
        await loadTopArtistsForUser(1);

        // After User 1's screen is ready, start loading User 2's top artists in background
        loadUser2TopArtistsInBackground();

    } catch (err) {
        singleUserProgress.classList.remove('hidden');
        dualUserProgress.classList.add('hidden');
        loadingDiv.classList.add('hidden');
        stepLoadHistoryDiv.classList.remove('hidden');
        showError("Failed to load histories. Please try again.");
    }
}

// Fetch only one user's scrobbles when the other user's data is already cached
async function fetchSingleUserForParallelMode(userNumber) {
    const loadingDiv = document.getElementById('loading');
    const statusText = document.querySelector('.progress-status');
    const singleUserProgress = document.getElementById('singleUserProgress');
    const dualUserProgress = document.getElementById('dualUserProgress');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    const pagesText = document.getElementById('pagesText');

    const username = userNumber === 1 ? validatedUsername : validatedUsername2;
    const otherUsername = userNumber === 1 ? validatedUsername2 : validatedUsername;

    loadingDiv.classList.remove('hidden');
    statusText.textContent = `Fetching ${username}'s scrobbles...`;

    // Show single user progress bar
    singleUserProgress.classList.remove('hidden');
    dualUserProgress.classList.add('hidden');
    const progressBarContainer = document.querySelector('.progress-bar-bg');
    const progressStatsContainer = document.querySelector('.progress-stats');
    if (progressBarContainer) progressBarContainer.style.display = 'block';
    if (progressStatsContainer) progressStatsContainer.style.display = 'flex';

    progressBar.style.width = '0%';
    progressText.textContent = '0%';
    pagesText.textContent = 'Initializing...';

    try {
        const tracks = await fetchUserScrobblesWithProgress(username, (current, total) => {
            const pct = Math.round((current / total) * 100);
            progressBar.style.width = `${pct}%`;
            progressText.textContent = `${pct}%`;
            pagesText.textContent = `Page ${current} of ${total}`;
        });

        // Store the fetched tracks
        if (userNumber === 1) {
            cachedUserTracks = tracks;
        } else {
            cachedUser2Tracks = tracks;
        }

        loadingDiv.classList.add('hidden');
        step2Div.classList.remove('hidden');

        console.log(`✅ ${username}: ${tracks.length.toLocaleString()} scrobbles (${otherUsername} was cached)`);

        // Only reset top artists for the user that was changed
        if (userNumber === 1) {
            cachedUser1TopArtists = null;
        } else {
            cachedUser2TopArtists = null;
            user2TopArtistsLoading = false;
        }

        // Load top artists - use cached data for unchanged user
        currentTopArtistsUser = 1;

        if (userNumber === 1) {
            // User 1 was changed, need to reload their top artists
            // User 2's top artists should still be cached
            await loadTopArtistsForUser(1);
            // User 2's top artists are already cached, no need to reload
            if (!cachedUser2TopArtists && !user2TopArtistsLoading) {
                loadUser2TopArtistsInBackground();
            }
        } else {
            // User 2 was changed
            // User 1's top artists should still be cached, use them
            if (cachedUser1TopArtists) {
                displayTopArtists(cachedUser1TopArtists, validatedUsername);
                stepTopArtistsDiv.classList.remove('hidden');
            } else {
                await loadTopArtistsForUser(1);
            }
            // Reload User 2's top artists in background
            loadUser2TopArtistsInBackground();
        }

    } catch (err) {
        loadingDiv.classList.add('hidden');
        stepLoadHistoryDiv.classList.remove('hidden');
        showError(`Failed to load ${username}'s history. Please try again.`);
    }
}

// Scrobble fetcher with progress callback for parallel mode
async function fetchUserScrobblesWithProgress(username, onProgress) {
    let collectedTracks = [];

    // DEV MODE: Check for cached scrobbles
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        try {
            const cachePath = `/cache/${username.toLowerCase()}.json`;
            console.log(`[${username}] Checking cache at ${cachePath}...`);
            const cacheResponse = await fetch(cachePath);
            if (cacheResponse.ok) {
                collectedTracks = await cacheResponse.json();
                console.log(`🚀 [${username}] Loaded ${collectedTracks.length.toLocaleString()} scrobbles from cache`);
                onProgress(1, 1); // Show complete
                return collectedTracks;
            } else {
                console.log(`[${username}] Cache response not OK: ${cacheResponse.status}`);
            }
        } catch (e) {
            console.log(`[${username}] Cache fetch error:`, e.message);
        }
    }

    // Fetch page 1 to get total pages
    const page1Data = await getRecentTracks(username, SCROBBLE_PAGE_LIMIT, 1);
    const recentTracksIdx = page1Data.recenttracks;
    if (!recentTracksIdx) throw new Error(`Invalid response for ${username}`);

    const totalPages = parseInt(recentTracksIdx['@attr'].totalPages);

    if (Array.isArray(recentTracksIdx.track)) {
        collectedTracks.push(...recentTracksIdx.track);
    }

    onProgress(1, totalPages);
    console.log(`[${username}] Starting fetch: ${totalPages} pages`);

    let lastRequestTime = Date.now();

    for (let page = 2; page <= totalPages; page++) {
        const elapsed = Date.now() - lastRequestTime;
        if (elapsed < SCROBBLE_FETCH_DELAY_MS) {
            await new Promise(resolve => setTimeout(resolve, SCROBBLE_FETCH_DELAY_MS - elapsed));
        }
        lastRequestTime = Date.now();

        let success = false;
        for (let attempt = 0; attempt <= MAX_RETRIES && !success; attempt++) {
            try {
                if (attempt > 0) {
                    const retryDelay = RETRY_BASE_DELAY_MS * attempt;
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                    lastRequestTime = Date.now();
                }

                const data = await getRecentTracks(username, SCROBBLE_PAGE_LIMIT, page);
                if (data.recenttracks && Array.isArray(data.recenttracks.track)) {
                    collectedTracks.push(...data.recenttracks.track);
                }
                success = true;
            } catch (pageError) {
                console.warn(`[${username}] Failed page ${page}, attempt ${attempt + 1}/${MAX_RETRIES + 1}`);
            }
        }

        // Update progress
        onProgress(page, totalPages);
    }

    // Deduplicate
    const seen = new Set();
    collectedTracks = collectedTracks.filter(track => {
        if (!track.date?.uts) return false;
        if (seen.has(track.date.uts)) return false;
        seen.add(track.date.uts);
        return true;
    });

    console.log(`✅ [${username}] Complete: ${collectedTracks.length.toLocaleString()} scrobbles`);
    return collectedTracks;
}

// Compute top N artists from scrobble data
function getTopArtistsFromScrobbles(tracks, limit = 10) {
    const artistCounts = new Map();

    tracks.forEach(track => {
        const artistName = track.artist?.['#text'] || track.artist?.name;
        if (!artistName) return;

        const current = artistCounts.get(artistName) || 0;
        artistCounts.set(artistName, current + 1);
    });

    // Convert to array and sort by count descending
    const sorted = Array.from(artistCounts.entries())
        .map(([name, playcount]) => ({ name, playcount }))
        .sort((a, b) => b.playcount - a.playcount)
        .slice(0, limit);

    return sorted;
}

// Helper function to load top artists when using cached scrobbles
async function loadTopArtistsFromCache() {
    try {
        const topArtists = getTopArtistsFromScrobbles(cachedUserTracks, 10);
        if (topArtists.length > 0) {
            // Immediately show skeleton placeholders
            displayTopArtistSkeletons(topArtists.length);

            const artistsWithInfo = [];
            for (let i = 0; i < topArtists.length; i++) {
                const artist = topArtists[i];
                try {
                    const artistInfo = await fetchArtistInfo(artist.name);
                    if (artistInfo) {
                        cachedArtistInfo.set(artist.name.toLowerCase(), artistInfo);
                        let image = '/default_pfp.png';
                        if (artistInfo.image) {
                            const imgObj = artistInfo.image.find(img => img.size === 'large')
                                || artistInfo.image.find(img => img.size === 'medium')
                                || artistInfo.image[0];
                            if (imgObj?.['#text'] && imgObj['#text'].trim() !== '') {
                                image = imgObj['#text'];
                            }
                        }
                        artistsWithInfo.push({
                            name: artistInfo.name,
                            playcount: artist.playcount,
                            url: artistInfo.url,
                            image: image
                        });
                    } else {
                        artistsWithInfo.push({
                            name: artist.name,
                            playcount: artist.playcount,
                            url: `https://www.last.fm/music/${encodeURIComponent(artist.name)}`,
                            image: '/default_pfp.png'
                        });
                    }
                } catch (e) {
                    console.warn(`Failed to fetch info for ${artist.name}:`, e);
                    artistsWithInfo.push({
                        name: artist.name,
                        playcount: artist.playcount,
                        url: `https://www.last.fm/music/${encodeURIComponent(artist.name)}`,
                        image: '/default_pfp.png'
                    });
                }

                if (i < topArtists.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
                }
            }

            displayTopArtists(artistsWithInfo);
        }
    } catch (err) {
        console.warn('Failed to load top artists from cache:', err);
    }
}

// Load top artists for a specific user (used in user-to-user mode)
async function loadTopArtistsForUser(userNum) {
    const tracks = userNum === 1 ? cachedUserTracks : cachedUser2Tracks;
    const username = userNum === 1 ? validatedUsername : validatedUsername2;

    if (!tracks || tracks.length === 0) {
        console.warn(`No tracks for user ${userNum}`);
        return [];
    }

    const topArtists = getTopArtistsFromScrobbles(tracks, 10);
    if (topArtists.length === 0) return [];

    // Track which user was being viewed when we started loading
    // so we can avoid switching the view if user manually changed it
    const viewedUserAtStart = currentTopArtistsUser;
    const isInitialLoad = viewedUserAtStart === userNum || (userNum === 1 && !cachedUser1TopArtists);

    // Show skeleton placeholders with username in header (only if this user is currently being viewed)
    if (isInitialLoad || currentTopArtistsUser === userNum) {
        displayTopArtistSkeletons(topArtists.length, username);
    }

    const artistsWithInfo = [];
    for (let i = 0; i < topArtists.length; i++) {
        const artist = topArtists[i];
        try {
            const artistInfo = await fetchArtistInfo(artist.name);
            if (artistInfo) {
                cachedArtistInfo.set(artist.name.toLowerCase(), artistInfo);
                let image = '/default_pfp.png';
                if (artistInfo.image) {
                    const imgObj = artistInfo.image.find(img => img.size === 'large')
                        || artistInfo.image.find(img => img.size === 'medium')
                        || artistInfo.image[0];
                    if (imgObj?.['#text'] && imgObj['#text'].trim() !== '') {
                        image = imgObj['#text'];
                    }
                }
                artistsWithInfo.push({
                    name: artistInfo.name,
                    playcount: artist.playcount,
                    url: artistInfo.url,
                    image: image
                });
            } else {
                artistsWithInfo.push({
                    name: artist.name,
                    playcount: artist.playcount,
                    url: `https://www.last.fm/music/${encodeURIComponent(artist.name)}`,
                    image: '/default_pfp.png'
                });
            }
        } catch (e) {
            console.warn(`Failed to fetch info for ${artist.name}:`, e);
            artistsWithInfo.push({
                name: artist.name,
                playcount: artist.playcount,
                url: `https://www.last.fm/music/${encodeURIComponent(artist.name)}`,
                image: '/default_pfp.png'
            });
        }

        if (i < topArtists.length - 1) {
            await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
        }
    }

    // Cache the results
    if (userNum === 1) {
        cachedUser1TopArtists = artistsWithInfo;
    } else {
        cachedUser2TopArtists = artistsWithInfo;
    }

    // Only update the display if the user hasn't switched to viewing another user's top 10
    // This respects the user's manual selection via the swap button
    if (currentTopArtistsUser === userNum || (isInitialLoad && currentTopArtistsUser === viewedUserAtStart)) {
        currentTopArtistsUser = userNum;
        displayTopArtists(artistsWithInfo, username);
    } else {
        console.log(`⏭️ User ${userNum} top artists loaded but not displayed (user switched to viewing user ${currentTopArtistsUser})`);
    }
    return artistsWithInfo;
}

// Load User 2's top artists in background (won't run in parallel with User 1's API calls)
function loadUser2TopArtistsInBackground() {
    if (!cachedUser2Tracks || cachedUser2Tracks.length === 0) return;
    if (cachedUser2TopArtists) return; // Already cached
    if (user2TopArtistsLoading) return; // Already loading

    user2TopArtistsLoading = true;
    console.log('🔄 Loading User 2 top artists in background...');

    // Use an async IIFE so we don't block
    (async () => {
        try {
            const topArtists = getTopArtistsFromScrobbles(cachedUser2Tracks, 10);
            if (topArtists.length === 0) {
                user2TopArtistsLoading = false;
                return;
            }

            const artistsWithInfo = [];
            for (let i = 0; i < topArtists.length; i++) {
                const artist = topArtists[i];
                try {
                    const artistInfo = await fetchArtistInfo(artist.name);
                    if (artistInfo) {
                        cachedArtistInfo.set(artist.name.toLowerCase(), artistInfo);
                        let image = '/default_pfp.png';
                        if (artistInfo.image) {
                            const imgObj = artistInfo.image.find(img => img.size === 'large')
                                || artistInfo.image.find(img => img.size === 'medium')
                                || artistInfo.image[0];
                            if (imgObj?.['#text'] && imgObj['#text'].trim() !== '') {
                                image = imgObj['#text'];
                            }
                        }
                        artistsWithInfo.push({
                            name: artistInfo.name,
                            playcount: artist.playcount,
                            url: artistInfo.url,
                            image: image
                        });
                    } else {
                        artistsWithInfo.push({
                            name: artist.name,
                            playcount: artist.playcount,
                            url: `https://www.last.fm/music/${encodeURIComponent(artist.name)}`,
                            image: '/default_pfp.png'
                        });
                    }
                } catch (e) {
                    artistsWithInfo.push({
                        name: artist.name,
                        playcount: artist.playcount,
                        url: `https://www.last.fm/music/${encodeURIComponent(artist.name)}`,
                        image: '/default_pfp.png'
                    });
                }

                if (i < topArtists.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
                }
            }

            cachedUser2TopArtists = artistsWithInfo;
            user2TopArtistsLoading = false;
            console.log('✅ User 2 top artists cached');

            // Update swap button text if it exists
            updateSwapButtonState();

        } catch (err) {
            console.warn('Failed to load User 2 top artists:', err);
            user2TopArtistsLoading = false;
        }
    })();
}

// Switch to viewing the other user's top 10
async function switchTopArtistsUser() {
    const targetUser = currentTopArtistsUser === 1 ? 2 : 1;
    const targetUsername = targetUser === 1 ? validatedUsername : validatedUsername2;

    if (targetUser === 2) {
        if (cachedUser2TopArtists) {
            // Use cached data - instant switch
            currentTopArtistsUser = 2;
            displayTopArtists(cachedUser2TopArtists, targetUsername);
        } else if (user2TopArtistsLoading) {
            // Show loading skeleton while waiting
            displayTopArtistSkeletons(10, targetUsername);
            currentTopArtistsUser = 2;
            // Poll until loading completes
            const checkInterval = setInterval(() => {
                if (!user2TopArtistsLoading && cachedUser2TopArtists) {
                    clearInterval(checkInterval);
                    displayTopArtists(cachedUser2TopArtists, targetUsername);
                }
            }, 200);
        } else {
            // Not cached and not loading - load now
            await loadTopArtistsForUser(2);
        }
    } else {
        // Switching back to User 1
        if (cachedUser1TopArtists) {
            currentTopArtistsUser = 1;
            displayTopArtists(cachedUser1TopArtists, targetUsername);
        } else {
            await loadTopArtistsForUser(1);
        }
    }
}

// Update the swap button text
function updateSwapButtonState() {
    const swapBtn = document.getElementById('swapTopArtistsBtn');
    if (!swapBtn) return;

    const otherUser = currentTopArtistsUser === 1 ? validatedUsername2 : validatedUsername;
    swapBtn.textContent = `See ${otherUser}'s top 10`;
}

// Step 3: Compare
compareForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!validatedUsername) {
        showError("Please verify a user first.");
        return;
    }

    if (cachedUserTracks.length === 0) {
        showError("No history loaded. Please load scrobble history.");
        return;
    }

    // For user mode, also check user 2
    if (comparisonMode === 'user' && cachedUser2Tracks.length === 0) {
        showError("User 2's history not loaded. Please load scrobble histories.");
        return;
    }

    const artist = document.getElementById('artist').value.trim();

    // Reset Results UI
    results.classList.add('hidden');
    errorDiv.classList.add('hidden');
    tracksList.innerHTML = '';

    // Show simple loading state
    const loadingDiv = document.getElementById('loading');
    const statusText = document.querySelector('.progress-status');
    const progressBarContainer = document.querySelector('.progress-bar-bg');
    const progressStats = document.querySelector('.progress-stats');

    loadingDiv.classList.remove('hidden');
    statusText.textContent = `Comparing with ${artist}...`;
    progressBarContainer.style.display = 'none';
    progressStats.style.display = 'none';

    try {
        let dataArtistName = "";

        // 1. Filter user 1 tracks for the artist
        const userArtistTracks = cachedUserTracks.filter(track => {
            const trackArtist = track.artist['#text'] || track.artist.name;
            return trackArtist && trackArtist.toLowerCase() === artist.toLowerCase();
        });

        if (userArtistTracks.length === 0) {
            // Check if artist exists on Last.fm before showing error
            try {
                const artistInfo = await fetchArtistInfo(artist);
                loadingDiv.classList.add('hidden');
                if (!artistInfo) {
                    showError('Artist not found.');
                } else {
                    const errorUsername = validatedUsername || 'User';
                    if (comparisonMode === 'user') {
                        // Check if User 2 has also not listened
                        const user2ArtistTracks = cachedUser2Tracks.filter(track => {
                            const trackArtist = track.artist['#text'] || track.artist.name;
                            return trackArtist && trackArtist.toLowerCase() === artist.toLowerCase();
                        });
                        if (user2ArtistTracks.length === 0) {
                            showError('Neither user has listened to this artist. Try a different artist that both users have listened to.');
                        } else {
                            showError(`${errorUsername} hasn't listened to this artist. Try a different artist that both users have listened to.`);
                        }
                    } else {
                        showError(`${errorUsername} hasn't listened to this artist.`);
                    }
                }
            } catch (e) {
                loadingDiv.classList.add('hidden');
                showError('Artist not found.');
            }
            return;
        }

        // Variables for comparison ranking
        let comparisonRankMap = new Map();
        let rankLabel = 'communityRank'; // Will be 'user2Rank' in user mode
        let user2ArtistScrobbleCount = null; // For artist card display

        if (comparisonMode === 'user') {
            // USER MODE: Build ranking from User 2's scrobbles
            const user2ArtistTracks = cachedUser2Tracks.filter(track => {
                const trackArtist = track.artist['#text'] || track.artist.name;
                return trackArtist && trackArtist.toLowerCase() === artist.toLowerCase();
            });

            if (user2ArtistTracks.length === 0) {
                loadingDiv.classList.add('hidden');
                showError(`${validatedUsername2} hasn't listened to this artist. Try a different artist that both users have listened to.`);
                return;
            }

            user2ArtistScrobbleCount = user2ArtistTracks.length;

            // Aggregate User 2's scrobbles by song name
            const user2TrackMap = new Map();
            user2ArtistTracks.forEach(track => {
                const lowerName = track.name.toLowerCase();
                if (user2TrackMap.has(lowerName)) {
                    user2TrackMap.get(lowerName).playcount++;
                } else {
                    user2TrackMap.set(lowerName, {
                        name: track.name,
                        playcount: 1
                    });
                }
            });

            // Sort by playcount and build ranking
            const user2Sorted = Array.from(user2TrackMap.values())
                .sort((a, b) => b.playcount - a.playcount);

            user2Sorted.forEach((track, index) => {
                comparisonRankMap.set(track.name.toLowerCase(), index + 1);
            });

            rankLabel = 'user2Rank';
            dataArtistName = artist; // No API call for artist info in user mode

            // Still try to get artist info for display (but don't block on failure)
            try {
                const artistKey = artist.toLowerCase();
                let artistInfoData = cachedArtistInfo.get(artistKey);
                if (!artistInfoData) {
                    artistInfoData = await fetchArtistInfo(artist);
                    if (artistInfoData) {
                        cachedArtistInfo.set(artistKey, artistInfoData);
                    }
                }
                if (artistInfoData) {
                    displayArtistInfo(artistInfoData, user2ArtistScrobbleCount);
                    dataArtistName = artistInfoData.name;
                } else {
                    artistInfoDiv.classList.add('hidden');
                }
            } catch (e) {
                console.warn('Failed to fetch artist info for user mode:', e);
                artistInfoDiv.classList.add('hidden');
            }
        } else {
            // COMMUNITY MODE: Use getArtistTopTracks API (original logic)
            const artistKey = artist.toLowerCase();
            let artistInfoData = cachedArtistInfo.get(artistKey);
            let communityData = cachedArtistTopTracks.get(artistKey);

            if (artistInfoData && communityData) {
                console.log(`Using cached data for ${artist}`);
            } else if (artistInfoData && !communityData) {
                communityData = await getArtistTopTracks(artist);
                cachedArtistTopTracks.set(artistKey, communityData);
            } else if (!artistInfoData && communityData) {
                artistInfoData = await fetchArtistInfo(artist);
                if (artistInfoData) {
                    cachedArtistInfo.set(artistKey, artistInfoData);
                }
            } else {
                [communityData, artistInfoData] = await Promise.all([
                    getArtistTopTracks(artist),
                    fetchArtistInfo(artist)
                ]);
                cachedArtistTopTracks.set(artistKey, communityData);
                if (artistInfoData) {
                    cachedArtistInfo.set(artistKey, artistInfoData);
                }
            }

            const communityTracks = communityData.toptracks?.track || [];
            communityTracks.forEach((track, index) => {
                comparisonRankMap.set(track.name.toLowerCase(), index + 1);
            });

            if (artistInfoData) {
                displayArtistInfo(artistInfoData);
                dataArtistName = artistInfoData.name;
            } else {
                dataArtistName = artist;
                artistInfoDiv.classList.add('hidden');
            }
        }

        // 3. Aggregate User 1 Scrobbles by Song Name
        const trackMap = new Map();

        userArtistTracks.forEach(track => {
            const lowerName = track.name.toLowerCase();
            if (trackMap.has(lowerName)) {
                const existing = trackMap.get(lowerName);
                existing.playcount++;
            } else {
                trackMap.set(lowerName, {
                    name: track.name,
                    playcount: 1,
                    url: track.url,
                    image: track.image ? track.image[1]['#text'] : null
                });
            }
        });

        // Convert to array and sort by playcount (User 1 Rank)
        const aggregatedTracks = Array.from(trackMap.values());
        aggregatedTracks.sort((a, b) => b.playcount - a.playcount);

        // Determine max rank for "not found" tracks
        let maxRank = TOP_TRACKS_LIMIT + 1;
        if (comparisonMode === 'user') {
            // In user mode, the "not heard" rank must be worse than the lowest rank of EITHER user.
            maxRank = Math.max(aggregatedTracks.length, comparisonRankMap.size) + 1;
        }

        // Calculate Differentials
        const comparison = aggregatedTracks.map((userTrack, userIndex) => {
            const userRank = userIndex + 1;
            const compareRank = comparisonRankMap.get(userTrack.name.toLowerCase());
            const numericCompareRank = compareRank || maxRank;

            return {
                name: userTrack.name,
                userRank: userRank,
                compareRank: compareRank || `>${maxRank - 1}`,
                playcount: userTrack.playcount,
                differential: numericCompareRank - userRank,
                url: userTrack.url,
                image: userTrack.image
            };
        });

        // Sort by differential descending
        comparison.sort((a, b) => b.differential - a.differential);

        // Store in global state with mode info
        globalComparisonData = {
            artist: dataArtistName,
            tracks: comparison,
            mode: comparisonMode,
            user2Name: validatedUsername2 || null
        };

        loadingDiv.classList.add('hidden');
        applyFilterAndDisplay();

    } catch (err) {
        loadingDiv.classList.add('hidden');
        showError(err.message);
    }
});

async function fetchArtistInfo(artist) {
    try {
        const data = await getArtistInfo(artist, validatedUsername);
        return data.artist;
    } catch (e) {
        console.warn("Failed to fetch artist info", e);
        return null; // Fail silently, just don't show info
    }
}

function displayArtistInfo(artistData, user2ScrobbleCount = null) {
    if (!artistData) {
        artistInfoDiv.classList.add('hidden');
        return;
    }

    const name = artistData.name;
    const url = artistData.url;
    // Image: preferably mega, then extralarge
    const image = artistData.image ? (artistData.image.find(img => img.size === 'mega') || artistData.image.find(img => img.size === 'extralarge') || artistData.image[0])['#text'] : '/default_pfp.png';
    const listeners = formatBigNumber(artistData.stats.listeners);
    const playcount = formatBigNumber(artistData.stats.playcount);
    const userPlaycount = artistData.stats.userplaycount ? parseInt(artistData.stats.userplaycount).toLocaleString() : '0';

    // Dynamic label for user scrobbles
    const userLabel = validatedUsername ? `${validatedUsername}'s Scrobbles` : 'Your Scrobbles';

    // Build user 2 scrobble stats HTML if in user mode
    let user2StatsHtml = '';
    if (user2ScrobbleCount !== null && validatedUsername2) {
        user2StatsHtml = `
            <div class="stat-item user-stat-highlight user2-stat">
                <span class="stat-value">${user2ScrobbleCount.toLocaleString()}</span>
                <span class="stat-label">${validatedUsername2}'s Scrobbles</span>
            </div>
        `;
    }

    artistInfoDiv.innerHTML = `
        <img src="${image}" alt="${name}" class="artist-header-image" onerror="this.onerror=null;this.src='/default_pfp.png';">
        <div class="artist-details">
            <h2 class="artist-name">
                <a href="${url}" target="_blank" style="text-decoration: none; color: inherit;">${name}</a>
            </h2>
            <div class="artist-stats">
                <div class="stat-item">
                    <span class="stat-value">${listeners}</span>
                    <span class="stat-label">Listeners</span>
                </div>
                <div class="stat-item">
                    <span class="stat-value">${playcount}</span>
                    <span class="stat-label">Total Scrobbles</span>
                </div>
                 <div class="stat-item user-stat-highlight">
                    <span class="stat-value">${userPlaycount}</span>
                    <span class="stat-label">${userLabel}</span>
                </div>
                ${user2StatsHtml}
            </div>
        </div>
    `;
    artistInfoDiv.classList.remove('hidden');
}

function formatBigNumber(numStr) {
    const num = parseInt(numStr);
    if (isNaN(num)) return '0';

    if (num < 1000) {
        return num.toString();
    } else if (num < 1000000) {
        // < 1 million: Round to nearest thousand, use 'k'
        // e.g. 453200 -> 453k
        return Math.round(num / 1000) + 'k';
    } else if (num < 1000000000) {
        // 1M - 1B
        if (num >= 100000000) {
            // 100M - 999M: Round to nearest million
            return Math.round(num / 1000000) + ' million';
        }
        // 1M - 99M: Round to nearest tenth of a million
        return (num / 1000000).toFixed(1) + ' million';
    } else {
        // > 1B: Round to nearest tenth of a billion
        return (num / 1000000000).toFixed(1) + ' billion';
    }
}

function applyFilterAndDisplay() {
    if (!globalComparisonData) return;

    const filterEnabled = document.getElementById('filterEnabled').checked;
    const filterThreshold = parseInt(document.getElementById('filterThreshold').value) || 5;
    const hiddenCountSpan = document.getElementById('hiddenCount');

    const filteredTracks = globalComparisonData.tracks.filter(t => !filterEnabled || t.playcount >= filterThreshold);
    const hiddenCount = globalComparisonData.tracks.length - filteredTracks.length;

    // Update hidden count display
    if (hiddenCountSpan) {
        if (filterEnabled && hiddenCount > 0) {
            hiddenCountSpan.textContent = `(${hiddenCount} hidden)`;
            hiddenCountSpan.style.display = 'inline';
        } else {
            hiddenCountSpan.style.display = 'none';
        }
    }

    displayResults({
        artist: globalComparisonData.artist,
        tracks: filteredTracks
    });
}

function updateProgress(currentPage, totalPages, bar, text, pagesText) {
    const percentage = Math.round((currentPage / totalPages) * 100);
    bar.style.width = `${percentage}%`;
    text.textContent = `${percentage}%`;
    pagesText.textContent = `Page ${currentPage} of ${totalPages}`;
}

function displayUserInfo(user, container = userInfoDiv, label = null, userNumber = 1) {
    if (!user) return;
    const registeredDate = new Date(user.registered * 1000);
    const registeredYear = registeredDate.getFullYear();

    // Both users get a change button (only in user-to-user mode or for user 1 in community mode)
    const displayLabel = label ? `<div class="user-label">${label}</div>` : '';
    const changeBtn = `<button class="resetUserBtn secondary-btn" title="Change User">Change</button>`;

    container.innerHTML = `
        ${displayLabel}
        <div class="user-info-content">
            <img src="${user.image}" alt="${user.username}" class="user-pfp" onerror="this.onerror=null;this.src='/default_pfp.png';">
            <div class="user-details">
                <h3>${user.username}</h3>
                ${user.realname ? `<div class="user-realname">${user.realname}</div>` : ''}
                <div class="user-stat">Registered ${registeredYear}</div>
            </div>
            <div class="user-scrobbles">
                <div class="scrobble-count">${parseInt(user.playcount).toLocaleString()}</div>
                <div class="scrobble-label">SCROBBLES</div>
            </div>
            ${changeBtn}
        </div>
    `;
    container.classList.remove('hidden');

    // Add reset listener - in user mode, only resets the specific user
    container.querySelector('.resetUserBtn').addEventListener('click', () => {
        if (comparisonMode === 'user') {
            // User-to-user mode: only reset the specific user
            resetSingleUser(userNumber, container);
        } else {
            // Community mode: reset everything (original behavior)
            resetAllUsers();
        }
    });
}

// Reset only a single user while keeping the other user's data
function resetSingleUser(userNumber, container) {
    // Clear the specific user's data
    if (userNumber === 1) {
        validatedUsername = null;
        cachedUserTracks = [];
        cachedUser1TopArtists = null;
    } else {
        validatedUsername2 = null;
        cachedUser2Tracks = [];
        cachedUser2TopArtists = null;
        user2TopArtistsLoading = false;
    }

    // Hide downstream UI (need to re-fetch scrobbles after user change)
    stepLoadHistoryDiv.classList.add('hidden');
    step2Div.classList.add('hidden');
    stepTopArtistsDiv.classList.add('hidden');
    topArtistsGrid.innerHTML = '';
    results.classList.add('hidden');
    artistInfoDiv.classList.add('hidden');
    globalComparisonData = null;
    currentTopArtistsUser = 1;

    // Show inline form for changing this user
    showUserChangeForm(userNumber, container);
}

// Reset all users and return to step 1 (used in community mode)
function resetAllUsers() {
    validatedUsername = null;
    validatedUsername2 = null;
    cachedUserTracks = [];
    cachedUser2Tracks = [];
    userInfoContainer.classList.add('hidden');
    userInfoDiv.innerHTML = '';
    userInfo2Div.innerHTML = '';
    userInfo2Div.classList.add('hidden');
    stepLoadHistoryDiv.classList.add('hidden');
    step2Div.classList.add('hidden');
    stepTopArtistsDiv.classList.add('hidden');
    topArtistsGrid.innerHTML = '';
    userStepDiv.classList.remove('hidden');
    results.classList.add('hidden');
    artistInfoDiv.classList.add('hidden');
    cachedArtistInfo.clear();
    cachedArtistTopTracks.clear();
    currentTopArtistsUser = 1;
    cachedUser1TopArtists = null;
    cachedUser2TopArtists = null;
    user2TopArtistsLoading = false;
    globalComparisonData = null;
}

// Show inline form for changing a single user
function showUserChangeForm(userNumber, container) {
    const labelText = `User ${userNumber}`;

    container.innerHTML = `
        <div class="user-change-form">
            <form class="inline-user-form">
                <div class="input-group">
                    <label>${labelText}</label>
                    <div class="input-row">
                        <input type="text" class="change-username-input" placeholder="Enter username" required>
                        <button type="submit" class="primary-btn">Check</button>
                    </div>
                </div>
            </form>
            <div class="change-user-loading hidden">
                <span class="loading-text">Fetching user info...</span>
            </div>
            <div class="change-user-error hidden"></div>
        </div>
    `;

    const form = container.querySelector('.inline-user-form');
    const input = container.querySelector('.change-username-input');
    const loadingEl = container.querySelector('.change-user-loading');
    const errorEl = container.querySelector('.change-user-error');

    // Focus the input
    input.focus();

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = input.value.trim();
        if (!username) return;

        // Show loading
        form.classList.add('hidden');
        loadingEl.classList.remove('hidden');
        errorEl.classList.add('hidden');

        try {
            const userData = await getUserInfo(username);

            // Update state
            if (userNumber === 1) {
                validatedUsername = userData.username;
            } else {
                validatedUsername2 = userData.username;
            }

            // Display the user info card
            displayUserInfo(userData, container, null, userNumber);

            // Show load history step if both users are validated
            if (validatedUsername && validatedUsername2) {
                stepLoadHistoryDiv.classList.remove('hidden');
                loadHistoryBtn.textContent = 'Load Scrobble Histories';
                document.querySelector('#step-load-history .hint-text').textContent =
                    'This will fetch all scrobbles for both users. This may take a few minutes.';
            }
        } catch (err) {
            // Show error
            loadingEl.classList.add('hidden');
            form.classList.remove('hidden');
            errorEl.textContent = err.message;
            errorEl.classList.remove('hidden');
        }
    });
}

// Display skeleton placeholders for top artists while loading
function displayTopArtistSkeletons(count = 10, username = null) {
    // Update header with username
    const header = document.querySelector('.top-artists-header');
    if (header) {
        const displayName = username || validatedUsername || 'Your';
        header.textContent = `Loading ${displayName}'s top 10...`;
    }

    // Manage swap button visibility
    const swapBtn = document.getElementById('swapTopArtistsBtn');
    if (swapBtn) {
        if (comparisonMode === 'user' && validatedUsername2) {
            const otherUser = currentTopArtistsUser === 1 ? validatedUsername2 : validatedUsername;
            swapBtn.textContent = `See ${otherUser}'s top 10`;
            swapBtn.classList.remove('hidden');
        } else {
            swapBtn.classList.add('hidden');
        }
    }

    topArtistsGrid.innerHTML = Array(count).fill(0).map(() => `
        <div class="top-artist-card skeleton-card">
            <div class="skeleton-image skeleton"></div>
            <div class="skeleton-info">
                <div class="skeleton-text name skeleton"></div>
                <div class="skeleton-text count skeleton"></div>
            </div>
        </div>
    `).join('');
    stepTopArtistsDiv.classList.remove('hidden');
}

function displayTopArtists(artists, username = null) {
    // Update header with username
    const header = document.querySelector('.top-artists-header');
    if (header) {
        const displayName = username || validatedUsername || 'Your';
        header.textContent = `${displayName}'s top 10 artists — Pick one to compare`;
    }

    // Manage swap button visibility
    const swapBtn = document.getElementById('swapTopArtistsBtn');
    if (swapBtn) {
        if (comparisonMode === 'user' && validatedUsername2) {
            const otherUser = currentTopArtistsUser === 1 ? validatedUsername2 : validatedUsername;
            swapBtn.textContent = `See ${otherUser}'s top 10`;
            swapBtn.classList.remove('hidden');
        } else {
            swapBtn.classList.add('hidden');
        }
    }

    if (!artists || artists.length === 0) {
        stepTopArtistsDiv.classList.add('hidden');
        return;
    }

    topArtistsGrid.innerHTML = artists.map(artist => `
        <div class="top-artist-card" data-artist="${artist.name.replace(/"/g, '&quot;')}">
            <img src="${artist.image}" alt="${artist.name}" class="top-artist-image" onerror="this.onerror=null;this.src='/default_pfp.png';">
            <div class="top-artist-info">
                <div class="top-artist-name" title="${artist.name}">${artist.name}</div>
                <div class="top-artist-scrobbles">${artist.playcount.toLocaleString()} scrobbles</div>
            </div>
        </div>
    `).join('');

    // Add click handlers
    topArtistsGrid.querySelectorAll('.top-artist-card').forEach(card => {
        card.addEventListener('click', () => {
            const artistName = card.dataset.artist;
            document.getElementById('artist').value = artistName;
            // Auto-trigger compare
            compareForm.dispatchEvent(new Event('submit'));
        });
    });

    stepTopArtistsDiv.classList.remove('hidden');
}

function resetUI() {
    errorDiv.classList.add('hidden');
    userInfoContainer.classList.add('hidden');
    userInfoDiv.innerHTML = '';
    userInfo2Div.innerHTML = '';
    userInfo2Div.classList.add('hidden');
    stepLoadHistoryDiv.classList.add('hidden');
    step2Div.classList.add('hidden');
    stepTopArtistsDiv.classList.add('hidden');
    results.classList.add('hidden');
    artistInfoDiv.classList.add('hidden');
    cachedArtistInfo.clear();
    cachedArtistTopTracks.clear();
    // Hide warning
    const warningDiv = document.getElementById('warning');
    if (warningDiv) warningDiv.classList.add('hidden');
}

function showError(msg) {
    errorDiv.textContent = msg;
    errorDiv.classList.remove('hidden');
}

function showWarning(msg) {
    const warningDiv = document.getElementById('warning');
    if (warningDiv) {
        warningDiv.textContent = msg;
        warningDiv.classList.remove('hidden');
    }
}

// Toggle View Logic
let isColumnView = true;
const viewToggleBtn = document.getElementById('viewToggleBtn');

viewToggleBtn.addEventListener('click', () => {
    isColumnView = !isColumnView;
    viewToggleBtn.textContent = isColumnView ? 'Show complete list' : 'Show 3 columns';
    applyFilterAndDisplay();
});

function displayResults(data) {
    resultHeader.textContent = `Unusual favourites for ${data.artist}`;
    results.classList.remove('hidden');

    tracksList.innerHTML = '';

    if (isColumnView) {
        tracksList.className = 'columns-grid';
        renderColumnView(data.tracks);
    } else {
        tracksList.className = 'tracks-grid';
        renderListView(data.tracks);
    }
}

function renderListView(tracks) {
    tracks.forEach(track => {
        tracksList.appendChild(createTrackCard(track, false));
    });
}

function renderColumnView(tracks) {
    // 1. Positive Differential (Only >= 10)
    const positiveTracks = tracks
        .filter(t => t.differential >= 10)
        .slice(0, 10);

    // 2. Neutral (Closest to 0, but only if absolute differential < 10)
    const neutralTracks = tracks
        .filter(t => Math.abs(t.differential) < 10)
        .sort((a, b) => Math.abs(a.differential) - Math.abs(b.differential))
        .slice(0, 10);

    // 3. Negative Differential (Only <= -10)
    const negativeTracks = tracks
        .filter(t => t.differential <= -10)
        .sort((a, b) => a.differential - b.differential) // Most negative first
        .slice(0, 10);

    // Dynamic labels based on comparison mode
    const isUserMode = globalComparisonData?.mode === 'user';
    const user1Label = validatedUsername || 'User 1';
    const otherLabel = isUserMode ? (globalComparisonData?.user2Name || 'User 2') : 'the community';

    // In user mode, use usernames; in community mode, use "You"
    const positiveSubtext = isUserMode
        ? `${user1Label} likes more than ${otherLabel}`
        : `You like more than ${otherLabel}`;
    const negativeSubtext = isUserMode
        ? `${otherLabel} likes more than ${user1Label}`
        : `The community likes more than you`;

    createColumn("Top Positive (+)", "column-positive", positiveTracks, positiveSubtext);
    createColumn("Neutral (~0)", "column-neutral", neutralTracks, "&nbsp;");
    createColumn("Top Negative (-)", "column-negative", negativeTracks, negativeSubtext);
}

function createColumn(title, className, tracks, subtext = null) {
    const colDiv = document.createElement('div');
    colDiv.className = `column ${className}`;

    const header = document.createElement('div');
    header.className = 'column-header';
    header.textContent = title;
    colDiv.appendChild(header);

    if (subtext) {
        const sub = document.createElement('div');
        sub.className = 'column-subtext';
        sub.innerHTML = subtext;
        colDiv.appendChild(sub);
    }

    tracks.forEach(track => {
        colDiv.appendChild(createTrackCard(track, true));
    });

    tracksList.appendChild(colDiv);
}

function createTrackCard(track, compact = false) {
    const card = document.createElement('div');
    card.className = 'track-card';

    // Calculate score class
    let scoreClass = 'score-neutral';
    if (track.differential === 0) scoreClass = 'score-exact';
    else if (track.differential > 10) scoreClass = 'score-high';
    else if (track.differential < -10) scoreClass = 'score-low';

    const imgUrl = track.image || '/default_pfp.png';

    // Dynamic labels based on comparison mode
    const isUserMode = globalComparisonData?.mode === 'user';
    const user1Label = isUserMode ? (validatedUsername || 'User 1') : 'You';
    const otherLabel = isUserMode ? (globalComparisonData?.user2Name || 'User 2') : 'Community';
    const compareRankValue = track.compareRank || track.communityRank || `>${TOP_TRACKS_LIMIT}`; // Support both property names

    const metaContent = compact
        ? `#<strong>${track.userRank}</strong> vs #<strong>${compareRankValue}</strong> | ${track.playcount} scrobbles`
        : `Rankings: #<strong>${track.userRank}</strong> (${user1Label}) vs #<strong>${compareRankValue}</strong> (${otherLabel})<br>Scrobbles: ${track.playcount}`;

    card.innerHTML = `
        <img src="${imgUrl}" alt="${track.name}" class="track-image" onerror="this.onerror=null;this.src='/default_pfp.png';">
        <div class="track-info">
            <a href="${track.url}" target="_blank" class="track-name" title="${track.name}">${track.name}</a>
            <div class="track-meta">
                ${metaContent}
            </div>
        </div>
        <div class="score-badge ${scoreClass}">
            ${track.differential > 0 ? '+' : ''}${track.differential}
        </div>
    `;
    return card;
}

// Info Modal Logic
const infoBtn = document.getElementById('infoBtn');
const infoModal = document.getElementById('infoModal');
const closeModal = document.getElementById('closeModal');
const modalOverlay = document.querySelector('.modal-overlay');

if (infoBtn && infoModal && closeModal) {
    infoBtn.addEventListener('click', () => {
        infoModal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    });

    const closeActions = [closeModal, modalOverlay];
    closeActions.forEach(element => {
        if (element) {
            element.addEventListener('click', () => {
                infoModal.classList.add('hidden');
                document.body.style.overflow = '';
            });
        }
    });

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !infoModal.classList.contains('hidden')) {
            infoModal.classList.add('hidden');
            document.body.style.overflow = '';
        }
    });
}
