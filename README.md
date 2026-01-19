# Last.fm Comparator

Compare your Last.fm scrobble history with community data to discover your "unusual favourites" for any artist.

**Live site:** [scrobblegap.com](https://scrobblegap.com/)

## Running Locally

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Create a `.env` file** with your Last.fm API key:
   ```env
   LASTFM_API_KEY=your_api_key_here
   ```

3. **Start the server**
   ```bash
   npm start
   ```
   Or with auto-reload:
   ```bash
   npm run dev
   ```

4. **Open** `http://localhost:3000`

## Caching Scrobbles (Optional)

When developing locally, you can pre-cache a user's scrobbles to skip slow API fetches:

```bash
node scripts/cache-scrobbles.js <username>
```

This downloads all scrobbles for the given user and saves them to `public/cache/<username>.json`. The app automatically loads cached data when running on localhost, making repeated artist comparisons instantaneous.