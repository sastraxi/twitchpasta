# Twitch Pasta

Let the spam of the twitch universe flow through you in an easily consumable format.

Run twitch pasta on a second screen when you've got friends over for the big game so you never miss a single meme!

## Installation

1. Run `yarn` to install dependencies
2. `cp .env.example .env` and then fill in with your twitch app's client ID and secret. You'll need to add `/oauth` as a redirect URI
3. Modify the channel and timing parameters in `public/jumbotron.html`
4. Run `yarn start`, wait for the twitch emote libraries to be cached locally, then click on the link in the console (by default: http://localhost:8890)
5. Log in via twitch and accept your app's permissions
6. Put your browser tab full-screen and enjoy the best copypasta the twitch community has to offer

