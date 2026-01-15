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
    loading.classList.remove('hidden');
    loading.textContent = "Fetching user info...";

    try {
        const response = await fetch(`/api/user-info?username=${encodeURIComponent(username)}`);
        const data = await response.json();

        loading.classList.add('hidden');

        if (!response.ok) {
            throw new Error(data.error || data.details || 'User not found');
        }

        displayUserInfo(data);
        validatedUsername = data.username; // Store corrected username case
        // Show next step
        step2Div.classList.remove('hidden');
        userStepDiv.classList.add('hidden'); // Optional: hide step 1 to declutter? Or keep it? Prompt implies "before fetching tracks"
        // Let's keep step 1 hidden or simplified. Plan said: User Info -> Confirm (implied by proceeding) -> Artist Input.

    } catch (err) {
        loading.classList.add('hidden');
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
    loading.classList.remove('hidden');
    loading.textContent = "Parsing scrobbles...";

    try {
        const response = await fetch(`/api/compare/artist?username=${encodeURIComponent(validatedUsername)}&artist=${encodeURIComponent(artist)}`);
        const data = await response.json();

        loading.classList.add('hidden');

        if (!response.ok) {
            throw new Error(data.error || data.details || 'Something went wrong');
        }

        if (data.message) {
            throw new Error(data.message);
        }

        displayResults(data);

    } catch (err) {
        loading.classList.add('hidden');
        showError(err.message);
    }
});

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
