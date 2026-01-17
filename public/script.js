import { getUserInfo, getRecentTracks, getArtistTopTracks, getArtistInfo } from './api.js';

const userForm = document.getElementById('userForm');
const compareForm = document.getElementById('compareForm');
const loading = document.getElementById('loading');
const results = document.getElementById('results');
const errorDiv = document.getElementById('error');
const tracksList = document.getElementById('tracksList');
const resultHeader = document.getElementById('resultHeader');
const userInfoDiv = document.getElementById('userInfo');
const stepLoadHistoryDiv = document.getElementById('step-load-history');
const loadHistoryBtn = document.getElementById('loadHistoryBtn');
const step2Div = document.getElementById('step2-compare');
const userStepDiv = document.getElementById('step1-user');

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
let validatedUsername = null;
let cachedUserTracks = [];
let globalComparisonData = null; // Store full comparison results

// Step 1: Check User
userForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const usernameInput = document.getElementById('username');
    const username = usernameInput.value.trim();

    if (!username) return;

    // Reset UI
    resetUI();
    globalComparisonData = null; // Clear old data

    // Show simple loading for user info
    const loadingDiv = document.getElementById('loading');
    const statusText = document.querySelector('.progress-status');
    const progressBarContainer = document.querySelector('.progress-bar-bg');
    const progressStats = document.querySelector('.progress-stats');

    loadingDiv.classList.remove('hidden');
    statusText.textContent = "Fetching user info...";

    // Hide progress bar elements during user lookup
    progressBarContainer.style.display = 'none';
    progressStats.style.display = 'none';

    try {
        const data = await getUserInfo(username);

        loadingDiv.classList.add('hidden');

        displayUserInfo(data);
        validatedUsername = data.username; // Store corrected username case

        // Show Load History Step
        stepLoadHistoryDiv.classList.remove('hidden');
        userStepDiv.classList.add('hidden');

    } catch (err) {
        loadingDiv.classList.add('hidden');
        showError(err.message);
    }
});

// Step 2: Load History
loadHistoryBtn.addEventListener('click', async () => {
    if (!validatedUsername) return;

    // Reset State
    cachedUserTracks = [];
    stepLoadHistoryDiv.classList.add('hidden');

    await fetchAllScrobbles();
});

async function fetchAllScrobbles() {
    // Show Progress UI
    const loadingDiv = document.getElementById('loading');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    const pagesText = document.getElementById('pagesText');
    const statusText = document.querySelector('.progress-status');

    loadingDiv.classList.remove('hidden');

    // Restore progress bar visibility
    const progressBarContainer = document.querySelector('.progress-bar-bg');
    const progressStatsContainer = document.querySelector('.progress-stats');
    if (progressBarContainer) progressBarContainer.style.display = 'block';
    if (progressStatsContainer) progressStatsContainer.style.display = 'flex';

    progressBar.style.width = '0%';
    progressText.textContent = '0%';
    pagesText.textContent = 'Initializing...';
    statusText.textContent = 'Fetching full listening history...';

    const LIMIT = 1000; // Max tracks per page
    const DELAY_MS = 500; // Rate limit: 2 requests per second
    const MAX_RETRIES = 2; // Number of retries per failed page
    let failedPages = []; // Track pages that failed even after retries

    try {
        // 1. Fetch Page 1 to get total pages
        const page1Data = await getRecentTracks(validatedUsername, LIMIT, 1);

        const recentTracksIdx = page1Data.recenttracks;
        if (!recentTracksIdx) throw new Error('Invalid response from Last.fm');

        const totalPages = parseInt(recentTracksIdx['@attr'].totalPages);

        // Add page 1 tracks
        if (Array.isArray(recentTracksIdx.track)) {
            cachedUserTracks.push(...recentTracksIdx.track);
        }

        // Update Progress
        updateProgress(1, totalPages, progressBar, progressText, pagesText);

        // Loop for remaining pages
        for (let page = 2; page <= totalPages; page++) {
            // Rate Limit Delay
            await new Promise(resolve => setTimeout(resolve, DELAY_MS));

            let success = false;
            for (let attempt = 0; attempt <= MAX_RETRIES && !success; attempt++) {
                try {
                    if (attempt > 0) {
                        // Exponential backoff for retries: 1s, 2s
                        const retryDelay = 1000 * attempt;
                        console.log(`Retry ${attempt} for page ${page} after ${retryDelay}ms...`);
                        await new Promise(resolve => setTimeout(resolve, retryDelay));
                    }

                    const data = await getRecentTracks(validatedUsername, LIMIT, page);

                    if (data.recenttracks && Array.isArray(data.recenttracks.track)) {
                        cachedUserTracks.push(...data.recenttracks.track);
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
        cachedUserTracks = cachedUserTracks.filter(track => {
            if (!track.date?.uts) return false; // Ignore "now playing" tracks
            if (seen.has(track.date.uts)) return false;
            seen.add(track.date.uts);
            return true;
        });

        // Done Loading
        loadingDiv.classList.add('hidden');
        step2Div.classList.remove('hidden'); // Show Compare Step

        // Show warning if some pages failed
        if (failedPages.length > 0) {
            const failedPercent = Math.round((failedPages.length / totalPages) * 100);
            showWarning(`Warning: ${failedPages.length} of ${totalPages} pages failed to load (~${failedPercent}% of your scrobbles may be missing). Results may be incomplete.`);
        }

    } catch (err) {
        loadingDiv.classList.add('hidden');
        stepLoadHistoryDiv.classList.remove('hidden'); // Show button again on fail
        showError("Failed to load history: " + err.message);
    }
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

        // 1. Filter user tracks for the artist
        const userArtistTracks = cachedUserTracks.filter(track => {
            const trackArtist = track.artist['#text'] || track.artist.name;
            return trackArtist && trackArtist.toLowerCase() === artist.toLowerCase();
        });

        if (userArtistTracks.length === 0) {
            loadingDiv.classList.add('hidden');
            showError("User hasn't listened to this artist or artist not found.");
            return;
        }

        // 2. Fetch Community Top Tracks & Artist Info (Parallel)
        const [communityData, artistInfoData] = await Promise.all([
            getArtistTopTracks(artist),
            fetchArtistInfo(artist)
        ]);

        const communityTracks = communityData.toptracks?.track || [];

        // Display Artist Info Immediately (if found)
        if (artistInfoData) {
            displayArtistInfo(artistInfoData);
            // Update the display artist name to the official one
            dataArtistName = artistInfoData.name;
        } else {
            // Fallback if API fails
            dataArtistName = artist;
            artistInfoDiv.classList.add('hidden');
        }

        // 3. Process and Compare: AGGREGATION & RANKING
        const communityRankMap = new Map();
        communityTracks.forEach((track, index) => {
            communityRankMap.set(track.name.toLowerCase(), index + 1);
        });

        // Aggregate User Scrobbles by Song Name
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

        // Convert to array and sort by playcount (User Rank)
        const aggregatedTracks = Array.from(trackMap.values());
        aggregatedTracks.sort((a, b) => b.playcount - a.playcount);

        // Calculate Differentials
        const comparison = aggregatedTracks.map((userTrack, userIndex) => {
            const userRank = userIndex + 1; // 1 = most played
            const communityRank = communityRankMap.get(userTrack.name.toLowerCase());

            const numericCommunityRank = communityRank || 101;

            return {
                name: userTrack.name,
                userRank: userRank,
                communityRank: communityRank || '>100',
                playcount: userTrack.playcount,
                differential: numericCommunityRank - userRank,
                url: userTrack.url,
                image: userTrack.image
            };
        });

        // Sort by differential descending
        comparison.sort((a, b) => b.differential - a.differential);

        // Store in global state
        globalComparisonData = {
            artist: dataArtistName,
            tracks: comparison
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

function displayArtistInfo(artistData) {
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

    const filteredTracks = globalComparisonData.tracks.filter(t => !filterEnabled || t.playcount >= filterThreshold);

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

function displayUserInfo(user) {
    if (!user) return;
    const registeredDate = new Date(user.registered * 1000);
    const registeredYear = registeredDate.getFullYear();

    userInfoDiv.innerHTML = `
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
            <button id="resetUserBtn" class="secondary-btn" title="Change User">Change</button>
        </div>
    `;
    userInfoDiv.classList.remove('hidden');

    document.getElementById('resetUserBtn').addEventListener('click', () => {
        validatedUsername = null;
        cachedUserTracks = [];
        userInfoDiv.classList.add('hidden');
        stepLoadHistoryDiv.classList.add('hidden');
        step2Div.classList.add('hidden');
        userStepDiv.classList.remove('hidden');
        results.classList.add('hidden');
    });
}

function resetUI() {
    errorDiv.classList.add('hidden');
    userInfoDiv.classList.add('hidden');
    stepLoadHistoryDiv.classList.add('hidden');
    step2Div.classList.add('hidden');
    stepLoadHistoryDiv.classList.add('hidden');
    step2Div.classList.add('hidden');
    results.classList.add('hidden');
    artistInfoDiv.classList.add('hidden');
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

    createColumn("Top Positive (+)", "column-positive", positiveTracks, "You like more than the community");
    createColumn("Neutral (~0)", "column-neutral", neutralTracks, "&nbsp;");
    createColumn("Top Negative (-)", "column-negative", negativeTracks, "The community likes more than you");
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

    const metaContent = compact
        ? `#<strong>${track.userRank}</strong> vs #<strong>${track.communityRank}</strong> | ${track.playcount} scrobbles`
        : `Rankings: #<strong>${track.userRank}</strong> (You) vs #<strong>${track.communityRank}</strong> (Community)<br>Scrobbles: ${track.playcount}`;

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
