# Last.fm Comparator

A web application that compares your personal Last.fm scrobble history with community data to discover your "unusual favourites" by a specific artist.

## Features

- **User Profile**: Fetches and displays Last.fm user details (Playcount, Registration Date, etc.).
- **Deep Scrobble Analysis**: Fetches all user history (handling pagination and rate limits) to calculate accurate playcounts.
- **Community Comparison**: Compares your top tracks for a given artist against the global Last.fm community's top tracks.
- **Ranking Differential**: Highlights songs you listen to disproportionately more than the average listener.

## Tech Stack

- **Backend**: Node.js, Express
- **Frontend**: HTML5, Vanilla CSS (Modern Dark Mode), JavaScript
- **API**: Last.fm API

## Setup & Run

1.  **Install Dependencies**
    ```bash
    npm install
    ```

2.  **Environment Variables**
    Create a `.env` file in the root directory and add your Last.fm API key:
    ```env
    LASTFM_API_KEY=your_api_key_here
    ```

3.  **Run Application**
    ```bash
    npm start
    ```
    For development with auto-reload:
    ```bash
    npm run dev
    ```

4.  **Access**
    Open your browser and navigate to `http://localhost:3000`.