const form = document.getElementById('compareForm');
const loading = document.getElementById('loading');
const results = document.getElementById('results');
const errorDiv = document.getElementById('error');
const tracksList = document.getElementById('tracksList');
const resultHeader = document.getElementById('resultHeader');

form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = document.getElementById('username').value;
    const artist = document.getElementById('artist').value;

    // Reset UI
    loading.classList.remove('hidden');
    results.classList.add('hidden');
    errorDiv.classList.add('hidden');
    tracksList.innerHTML = '';

    try {
        const response = await fetch(`/api/compare/artist?username=${encodeURIComponent(username)}&artist=${encodeURIComponent(artist)}`);
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
        errorDiv.textContent = err.message;
        errorDiv.classList.remove('hidden');
    }
});

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
