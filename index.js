require('dotenv').config()
const express = require('express');
const morgan = require('morgan');
const path = require('path');
const bodyParser = require('body-parser');
const request = require('request-promise');
const irc = require('irc');
const moment = require('moment');
const { EmoteFetcher, EmoteParser } = require('twitch-emoticons');

const fetcher = new EmoteFetcher();
const parser = new EmoteParser(fetcher, {
  template: '<img class="twitch-emote twitch-emote-{size}" src="{link}"></img>',
  match: /(\S+)/g,
});

const app = express();

app.use(morgan('dev'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());

const channels = {};
let token = null;
let ircClient;

app.get('/', (req, res) => {
  return res.redirect('https://id.twitch.tv/oauth2/authorize?' +
    `client_id=${process.env.TWITCH_CLIENT_ID}&` +
    `client_secret=${process.env.TWITCH_CLIENT_SECRET}&` +
    `redirect_uri=http://localhost:${process.env.PORT}/oauth&` +
    'response_type=code&' +
    'scope=chat:read');
});

app.get('/oauth', async (req, res) => {
  const { code } = req.query;

  const accessToken = await request({
    method: 'post',
    uri: 'https://id.twitch.tv/oauth2/token?' +
      `client_id=${process.env.TWITCH_CLIENT_ID}&` +
      `client_secret=${process.env.TWITCH_CLIENT_SECRET}&` +
      `redirect_uri=http://localhost:${process.env.PORT}/oauth&` +
      `code=${code}&` + 
      `grant_type=authorization_code`,
    json: true,
  });
  console.log('got access token', accessToken);
  token = accessToken;

  const userDetails = await request({
    method: 'get',
    headers: {
      Authorization: `Bearer ${accessToken.access_token}`,
    },
    uri: 'https://api.twitch.tv/helix/users',
    json: true,
  });
  console.log('user details', userDetails);
  const user = userDetails.data[0];

  ircClient = new irc.Client('irc.chat.twitch.tv', user.login, {
    userName: user.login,
    password: `oauth:${accessToken.access_token}`,
    secure: true,
    port: 6697,
    showErrors: true,
    debug: true,
  });

  ircClient.connect((...args) => {
    console.log('connect cb:', args);
  });

  ircClient.on('motd', (motd) => {
    console.log('Hello from server', motd);
  });

  ircClient.on('error', (...args) => {
    console.log('error cb', args);
  });

  ircClient.on('message#', (from, to, untrimmed, details) => {
    /*
    details = {
      prefix: "The prefix for the message (optional)",
      nick: "The nickname portion of the prefix (optional)",
      user: "The username portion of the prefix (optional)",
      host: "The hostname portion of the prefix (optional)",
      server: "The servername (if the prefix was a servername)",
      rawCommand: "The command exactly as sent from the server",
      command: "Human readable version of the command",
      commandType: "normal, error, or reply",
      args: ['arguments', 'to', 'the', 'command'],
    } */

    const channel = to.substr(1); // remove # prefix
    console.log('got message from channel', channel);

    const { messages } = channels[channel];
    const text = untrimmed.trim();
    const timestamp = +moment();

    console.log(text);

    if (text in messages) {
      messages[text] = {
        count: messages[text].count + 1,
        firstSeen: messages[text].firstSeen,
        lastSeen: timestamp,
      };
    } else {
      messages[text] = {
        count: 1,
        firstSeen: timestamp,
        lastSeen: timestamp,
      };
    }
  });

  ircClient.once('registered', () => {
    return res.redirect('/jumbotron.html');
  });
})

app.post('/start', (req, res) => {
  const { channel, minDuplicates } = req.body;

  if (!token) return res.status(401).json({ message: 'Please login first' });
  if (channel in channels) {
    return res.status(400).json({ message: `${channel} is already started` });
  }

  channels[channel] = {
    started: +moment(),
    messages: {},
    minDuplicates: minDuplicates || 1,
  };

  ircClient.join(`#${channel}`);

  return res.status(200).json({ message: 'OK' });
});

app.post('/stop', (req, res) => {
  const { channel } = req.body;

  if (!token) return res.status(401).json({ message: 'Please login first' });
  if (!(channel in channels)) {
    return res.status(400).json({ message: `${channel} has not been started`});
  }
});

app.get('/nextMessage', (req, res) => {
  const { channel, maxDelay, minLength } = req.query;
  const { messages, minDuplicates } = channels[channel];

  if (!token) return res.status(401).json({ message: 'Please login first' });

  let maxCount = minDuplicates - 1, maxCountRecent = minDuplicates - 1;
  let nextMessage = null, nextMessageRecent = null;

  const cutoff = +(moment().subtract(maxDelay, 'milliseconds'));
  const keys = Object.keys(messages);
  const toDelete = [];

  keys.forEach((text) => {
    if (minLength && text.length < minLength) return;

    const { count, lastSeen } = messages[text];
    
    // if we have to cut off, keep track of the best message after the cutoff too
    if (lastSeen > cutoff) {
      if (count > maxCountRecent || (count === maxCountRecent && messages[nextMessageRecent].lastSeen < lastSeen)) {
        maxCountRecent = count;
        nextMessageRecent = text;
      }
    } else {
      // this is a candidate for deletion if we need to delete
      toDelete.push(text);
    }

    if (count > maxCount || (count === maxCount && messages[nextMessage].lastSeen < lastSeen)) {
      maxCount = count;
      nextMessage = text;
    }
  });

  if (nextMessage === null) {
    return res.status(200).json({ count: 0 });
  }

  if (nextMessage !== nextMessageRecent) {
    // a too-old message is the most frequent message currently in queue
    // delete everything that's too old to even be considered later,
    // and send back the message that's recent enough to display
    toDelete.forEach(key => delete messages[key]);
    res.status(200).json({
      ...messages[nextMessageRecent],
      text: nextMessageRecent,
      count: maxCountRecent,
      html: parser.parse(nextMessageRecent),
    });
    delete messages[nextMessageRecent];
    return;
  }

  res.status(200).json({
    ...messages[nextMessage],
    text: nextMessage,
    count: maxCount,
    html: parser.parse(nextMessage),
  });
  delete messages[nextMessage];
});

console.log('Loading twitch emotes...');
fetcher.fetchTwitchEmotes().then(async () => {
  await fetcher.fetchBTTVEmotes();
  await fetcher.fetchFFZEmotes();
  console.log('Twitch, BTTV, and FFZ emotes loaded.');

  app.listen(process.env.PORT, () => {
    console.log(`App listening on http://localhost:${process.env.PORT}`);
  });
});
