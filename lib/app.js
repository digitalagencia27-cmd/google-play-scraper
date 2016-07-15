'use strict';

const request = require('./utils/request');
const memoize = require('./utils/memoize');
const cheerio = require('cheerio');
const queryString = require('querystring');
const url = require('url');

const PLAYSTORE_URL = 'https://play.google.com/store/apps/details';

function app (opts) {
  return new Promise(function (resolve, reject) {
    if (!opts || !opts.appId) {
      throw Error('appId missing');
    }

    opts.lang = opts.lang || 'en';
    opts.country = opts.country || 'us';

    const qs = queryString.stringify({
      id: opts.appId,
      hl: opts.lang,
      gl: opts.country
    });
    const reqUrl = `${PLAYSTORE_URL}?${qs}`;

    request(reqUrl, opts.throttle)
      .then(cheerio.load)
      .then(parseFields)
      .then(function (app) {
        app.url = reqUrl;
        app.appId = opts.appId;
        resolve(app);
      })
      .catch(reject);
  });
}

function parseFields ($) {
  const detailsInfo = $('.details-info');
  const title = detailsInfo.find('div.document-title').text().trim();
  const developer = detailsInfo.find('span[itemprop="name"]').text();
  const summary = $('meta[name="description"]').attr('content');

  const mainGenre = detailsInfo.find('.category').first();
  const genreText = mainGenre.text().trim();
  const genreId = mainGenre.attr('href').split('/')[4];

  const familyGenre = detailsInfo.find('.category[href*="FAMILY"]');
  let familyGenreText;
  let familyGenreId;
  if (familyGenre.length) {
    familyGenreText = familyGenre.text().trim() || undefined;
    familyGenreId = familyGenre.attr('href').split('/')[4];
  }

  const price = detailsInfo.find('meta[itemprop=price]').attr('content');
  const icon = detailsInfo.find('img.cover-image').attr('src');
  const offersIAP = !!detailsInfo.find('.inapp-msg').length;
  const adSupported = !!detailsInfo.find('.ads-supported-label-msg').length;

  const additionalInfo = $('.details-section-contents');
  const description = additionalInfo.find('div[itemprop=description] div');
  const version = additionalInfo.find('div.content[itemprop="softwareVersion"]').text().trim();
  const updated = additionalInfo.find('div.content[itemprop="datePublished"]').text().trim();
  const androidVersionText = additionalInfo.find('div.content[itemprop="operatingSystems"]').text().trim();
  const androidVersion = normalizeAndroidVersion(androidVersionText);
  const androidVersionSdk = findAndroidSdk(androidVersion);
  const contentRating = additionalInfo.find('div.content[itemprop="contentRating"]').text().trim();
  const size = additionalInfo.find('div.content[itemprop="fileSize"]').text().trim();
  const installs = installNumbers(additionalInfo.find('div.content[itemprop="numDownloads"]').text().trim());
  const minInstalls = cleanInt(installs[0]);
  const maxInstalls = cleanInt(installs[1]);

  let developerEmail = additionalInfo.find('.dev-link[href^="mailto:"]').attr('href');
  if (developerEmail) {
    developerEmail = developerEmail.split(':')[1];
  }

  let developerWebsite = additionalInfo.find('.dev-link[href^="http"]').attr('href');
  if (developerWebsite) {
    // extract clean url wrapped in google url
    developerWebsite = url.parse(developerWebsite, true).query.q;
  }

  const comments = $('.quoted-review').toArray().map((elem) => $(elem).text().trim());
  const ratingBox = $('.rating-box');
  const reviews = cleanInt(ratingBox.find('span.reviews-num').text());

  const ratingHistogram = $('.rating-histogram');
  const histogram = {
    5: cleanInt(ratingHistogram.find('.five .bar-number').text()),
    4: cleanInt(ratingHistogram.find('.four .bar-number').text()),
    3: cleanInt(ratingHistogram.find('.three .bar-number').text()),
    2: cleanInt(ratingHistogram.find('.two .bar-number').text()),
    1: cleanInt(ratingHistogram.find('.one .bar-number').text())
  };
  // for other languages
  const score = parseFloat(ratingBox.find('div.score').text().replace(',', '.')) || 0;

  let video = $('.screenshots span.preview-overlay-container[data-video-url]').attr('data-video-url');
  if (video) {
    video = video.split('?')[0];
  }

  video = typeof video !== 'undefined' ? video : null;

  const screenshots = $('.thumbnails .screenshot').toArray().map((elem) => $(elem).attr('src'));
  const recentChanges = $('.recent-change').toArray().map((elem) => $(elem).text());

  return {
    title,
    summary,
    icon,
    price,
    free: price === '0',
    minInstalls,
    maxInstalls,
    score,
    reviews,
    developer,
    developerEmail,
    developerWebsite,
    updated,
    version,
    genre: genreText,
    genreId,
    familyGenre: familyGenreText,
    familyGenreId,
    size,
    description: descriptionText(description),
    descriptionHTML: description.html(),
    histogram,
    offersIAP,
    adSupported,
    androidVersionText,
    androidVersion,
    androidVersionSdk,
    contentRating,
    screenshots,
    video,
    comments,
    recentChanges
  };
}

function descriptionText (description) {
  // preserve the line breaks when converting to text
  const html = '<div>' + description.html().replace(/<\/p>/g, '\n</p>') + '</div>';
  return cheerio.load(html)('div').text();
}

function cleanInt (number) {
  number = number || '0';
  // removes thousands separator
  number = number.replace(/\D/g, '');
  return parseInt(number);
}

function installNumbers(downloads) {
  let installs = downloads.split(' - ');
  if (installs.length == 2) return installs;

  installs = downloads.split(' et ');
  if (installs.length == 2) return installs;

  installs = downloads.split('–');
  if (installs.length == 2) return installs;

  installs = downloads.split('-');
  if (installs.length == 2) return installs;

  installs = downloads.split('～');
  if (installs.length == 2) return installs;

  throw new Error('Unable to parse min/max downloads');
}

function normalizeAndroidVersion(androidVersionText) {
  let matches = androidVersionText.match(/^([0-9\.]+)[^0-9\.].+/);

  if (!matches || typeof matches[1] === 'undefined') {
    return 'VARY';
  }

  return matches[1];
}

function findAndroidSdk(androidVersion) {
  const apiLevels = {
    '7.0': 24,
    '6.0': 23,
    '5.1': 22,
    '5.0': 21,
    '4.4': 19,
    '4.3': 18,
    '4.2': 17,
    '4.1': 16,
    '4.0.3': 15,
    '4.0': 14,
    '3.2': 13,
    '3.1': 12,
    '3.0': 11,
    '2.3.3': 10,
    '2.3': 9,
    '2.2': 8,
    '2.1': 7,
    '2.0.1': 6,
    '2.0': 5,
    '1.6': 4,
    '1.5': 3,
    '1.1': 2,
    '1.0': 1
  };

  if (typeof apiLevels[androidVersion] === 'undefined') {
    return null;
  }

  return apiLevels[androidVersion];
}

module.exports = memoize(app);
