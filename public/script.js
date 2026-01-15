const userForm = document.getElementById('userForm');
const compareForm = document.getElementById('compareForm');
const loading = document.getElementById('loading');
const results = document.getElementById('results');
const errorDiv = document.getElementById('error');
const tracksList = document.getElementById('tracksList');
const resultHeader = document.getElementById('resultHeader');
const userInfoDiv = document.getElementById('userInfo');
const step2Div = document.getElementById('step2-compare');
const userStepDiv = document.getElementById('step1-user');

// State
let validatedUsername = null;

// Step 1: Check User
userForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const usernameInput = document.getElementById('username');
    const username = usernameInput.value.trim();

    if (!username) return;

    // Reset UI
    resetUI();
    const loadingDiv = document.getElementById('loading');
    const statusText = document.querySelector('.progress-status');
    const progressBarContainer = document.querySelector('.progress-bar-bg');
    const progressStats = document.querySelector('.progress-stats');

    loadingDiv.classList.remove('hidden');
    statusText.textContent = "Fetching user info...";

    // Hide progress bar elements for simple request
    progressBarContainer.style.display = 'none';
    progressStats.style.display = 'none';

    try {
        const response = await fetch(`/api/user-info?username=${encodeURIComponent(username)}`);
        const data = await response.json();

        loadingDiv.classList.add('hidden');
        // Restore progress bar visibility for later
        progressBarContainer.style.display = 'block';
        progressStats.style.display = 'flex';

        if (!response.ok) {
            throw new Error(data.error || data.details || 'User not found');
        }

        displayUserInfo(data);
        validatedUsername = data.username; // Store corrected username case
        // Show next step
        step2Div.classList.remove('hidden');
        userStepDiv.classList.add('hidden');

    } catch (err) {
        loadingDiv.classList.add('hidden');
        // Restore visibility
        progressBarContainer.style.display = 'block';
        progressStats.style.display = 'flex';
        showError(err.message);
    }
});

// Step 2: Compare
compareForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!validatedUsername) {
        showError("Please verify a user first.");
        return;
    }

    const artist = document.getElementById('artist').value.trim();

    // Reset Results UI
    results.classList.add('hidden');
    errorDiv.classList.add('hidden');
    tracksList.innerHTML = '';

    // Show Progress Bar
    const loadingDiv = document.getElementById('loading');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    const pagesText = document.getElementById('pagesText');
    const statusText = document.querySelector('.progress-status');

    loadingDiv.classList.remove('hidden');

    // Ensure visibility (in case Step 1 hid them)
    const progressBarContainer = document.querySelector('.progress-bar-bg');
    const progressStatsContainer = document.querySelector('.progress-stats');
    if (progressBarContainer) progressBarContainer.style.display = 'block';
    if (progressStatsContainer) progressStatsContainer.style.display = 'flex';

    progressBar.style.width = '0%';
    progressText.textContent = '0%';
    pagesText.textContent = 'Initializing...';
    statusText.textContent = 'Fetching recent tracks...';

    // Fetching Logic
    const allUserTracks = [];
    const LIMIT = 1000; // Max tracks per page
    const DELAY_MS = 1000; // Rate limit: 1 request per second

    try {
        // 1. Fetch Page 1 to get total pages
        const page1Response = await fetch(`/api/recent-tracks?username=${encodeURIComponent(validatedUsername)}&limit=${LIMIT}&page=1`);
        if (!page1Response.ok) throw new Error('Failed to fetch initial page');
        const page1Data = await page1Response.json();

        const recentTracksIdx = page1Data.recenttracks;
        if (!recentTracksIdx) throw new Error('Invalid response from Last.fm');

        const totalPages = parseInt(recentTracksIdx['@attr'].totalPages);
        const totalTracks = parseInt(recentTracksIdx['@attr'].total);

        // Add page 1 tracks
        if (Array.isArray(recentTracksIdx.track)) {
            allUserTracks.push(...recentTracksIdx.track);
        }

        // Update Progress
        updateProgress(1, totalPages, progressBar, progressText, pagesText);

        // Loop for remaining pages
        for (let page = 2; page <= totalPages; page++) {
            // Rate Limit Delay
            await new Promise(resolve => setTimeout(resolve, DELAY_MS));

            const response = await fetch(`/api/recent-tracks?username=${encodeURIComponent(validatedUsername)}&limit=${LIMIT}&page=${page}`);
            if (!response.ok) {
                console.warn(`Failed to fetch page ${page}, skipping...`);
                continue;
            }
            const data = await response.json();

            if (data.recenttracks && Array.isArray(data.recenttracks.track)) {
                allUserTracks.push(...data.recenttracks.track);
            }

            updateProgress(page, totalPages, progressBar, progressText, pagesText);
        }

        statusText.textContent = 'Processing & Comparing...';

        // Filter and Compare Logic

        // 1. Filter user tracks for the artist
        const userArtistTracks = allUserTracks.filter(track => {
            const trackArtist = track.artist['#text'] || track.artist.name; // structure can vary
            return trackArtist && trackArtist.toLowerCase() === artist.toLowerCase();
        });

        if (userArtistTracks.length === 0) {
            loadingDiv.classList.add('hidden');
            showError("User hasn't listened to this artist recently or artist not found.");
            return;
        }

        // 2. Fetch Community Top Tracks
        const communityResponse = await fetch(`/api/artist-top-tracks?artist=${encodeURIComponent(artist)}`);
        if (!communityResponse.ok) throw new Error('Failed to fetch community data');
        const communityData = await communityResponse.json();
        const communityTracks = communityData.toptracks?.track || [];

        // 3. Process and Compare
        const communityRankMap = new Map();
        communityTracks.forEach((track, index) => {
            communityRankMap.set(track.name.toLowerCase(), index + 1);
        });

        // We need to determine "User Rank" based on recency.
        // The array `allUserTracks` is already sorted by recency (most recent first) from the API.
        // `userArtistTracks` preserves this order.

        const comparison = userArtistTracks.map((userTrack, userIndex) => {
            const userRank = userIndex + 1; // 1 = most recent
            const communityRank = communityRankMap.get(userTrack.name.toLowerCase()) || 51;

            return {
                name: userTrack.name,
                userRank: userRank,
                communityRank: communityRank > 50 ? '>50' : communityRank,
                playcount: 1,
                differential: communityRank - userRank, // Higher positive = Unusual favorite (recent but not popular)
                url: userTrack.url,
                image: userTrack.image ? userTrack.image[1]['#text'] : null
            };
        });

        // Sort by differential descending
        comparison.sort((a, b) => b.differential - a.differential);

        loadingDiv.classList.add('hidden');
        displayResults({
            artist: artist,
            tracks: comparison
        });

    } catch (err) {
        loadingDiv.classList.add('hidden');
        showError(err.message);
    }
});

function updateProgress(currentPage, totalPages, bar, text, pagesText) {
    const percentage = Math.round((currentPage / totalPages) * 100);
    bar.style.width = `${percentage}%`;
    text.textContent = `${percentage}%`;
    pagesText.textContent = `Page ${currentPage} of ${totalPages}`;
}

function displayUserInfo(user) {
    const registeredDate = new Date(user.registered * 1000);
    const registeredYear = registeredDate.getFullYear();

    userInfoDiv.innerHTML = `
        <div class="user-info-content">
            <img src="${user.image}" alt="${user.username}" class="user-pfp">
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
        userInfoDiv.classList.add('hidden');
        step2Div.classList.add('hidden');
        userStepDiv.classList.remove('hidden');
        results.classList.add('hidden');
    });
}

function resetUI() {
    errorDiv.classList.add('hidden');
    userInfoDiv.classList.add('hidden');
    step2Div.classList.add('hidden');
    results.classList.add('hidden');
}

function showError(msg) {
    errorDiv.textContent = msg;
    errorDiv.classList.remove('hidden');
}

function displayResults(data) {
    resultHeader.textContent = `Unusual favorites for ${data.artist}`;
    results.classList.remove('hidden');

    data.tracks.forEach(track => {
        const card = document.createElement('div');
        card.className = 'track-card';

        // Calculate score class
        let scoreClass = 'score-neutral';
        if (track.differential > 10) scoreClass = 'score-high';
        else if (track.differential < -10) scoreClass = 'score-low';

        // Image handling
        const imgUrl = track.image || 'https://lastfm.freetls.fastly.net/i/u/64s/2a96cbd8b46e442fc41c2b86b821562f.png'; // default placeholder

        card.innerHTML = `
            <img src="${imgUrl}" alt="${track.name}" class="track-image">
            <div class="track-info">
                <a href="${track.url}" target="_blank" class="track-name">${track.name}</a>
                <div class="track-meta">
                    Rankings: #<strong>${track.userRank}</strong> (You) vs #<strong>${track.communityRank}</strong> (Community)
                    <br>
                    Scrobbles: ${track.playcount}
                </div>
            </div>
            <div class="score-badge ${scoreClass}">
                ${track.differential > 0 ? '+' : ''}${track.differential}
            </div>
        `;

        tracksList.appendChild(card);
    });
}
