'use strict';

const request = require('./utils/request');
const memoize = require('./utils/memoize');
const cheerio = require('cheerio');
const R = require('ramda');

const c = require('./constants');

function reviews (opts) {
  return new Promise(function (resolve, reject) {
    validate(opts);

    const options = {
      method: 'POST',
      uri: 'https://play.google.com/store/getreviews',
      form: {
        pageNum: opts.page || 0,
        id: opts.appId || opts.id,
        reviewSortOrder: opts.sort || c.sort.NEWEST,
        hl: opts.lang || 'en',
        reviewType: 0,
        xhr: 1
      },
      json: true
    };

    request(options, opts.throttle)
      .then(function (body) {
        const response = JSON.parse(body.slice(6));
        return response[0][2];
      })
      .then(cheerio.load)
      .then($ => parseFields($, opts))
      .then(resolve)
      .catch(reject);
  });
}

function parseFields ($, opts) {
  const result = [];

  const reviewsContainer = $('div[class=single-review]');
  reviewsContainer.each(function (i) {
    const info = $(this).find('div[class=review-info]');
    const userInfo = info.find('a');
    const userId = filterUserId(userInfo.attr('href'));
    const userName = userInfo.text().trim();

    const date = $(this).find('span[class=review-date]').text().trim();
    const score = parseInt(filterScore($(this).find('.star-rating-non-editable-container').attr('aria-label').trim(), opts.lang));
    const url = 'https://play.google.com' + info.find('.reviews-permalink').attr('href');

    const reviewContent = $(this).find('.review-body');
    const title = reviewContent.find('span[class=review-title]').text().trim();
    const text = filterReviewText(reviewContent.text().trim(), title.length);

    const developerComment = $(this).next('.developer-reply');
    let replyDate;
    let replyText;
    if (developerComment.length) {
      replyDate = developerComment.find('span.review-date').text().trim();
      replyText = developerComment.children().remove().end().text().trim();
    }

    const allInfo = {
      userId,
      userName,
      date,
      url,
      score,
      title,
      text,
      replyDate,
      replyText
    };

    result[i] = allInfo;
  });
  return result;
}

function validate (opts) {
  if (!opts || !opts.appId) {
    throw Error('appId missing');
  }

  if (opts.sort && !R.contains(opts.sort, R.values(c.sort))) {
    throw new Error('Invalid sort ' + opts.sort);
  }
  if (opts.page && opts.page < 0) {
    throw new Error('Page cannot be lower than 0');
  }
}

function filterReviewText (text, startIndex) {
  const regex = /Full Review/;
  const result = text.substring(startIndex).replace(regex, '').trim();
  return result;
}

function filterUserId (userId) {
  const regex = /id=([0-9]*)/;
  const result = userId.match(regex);
  return result[1];
}

function filterScore (score, lang) {
  let regex;
  if (lang === 'ja') {
    // japanese reviews: '5つ星のうち3つ星で評価しました'
    regex = /[0-5].*?([0-5]{1})/;
  } else {
    // default: 'Rated 3 stars out of five stars'
    regex = /([0-5]{1})/;
  }
  const result = score.match(regex);
  return result[1];
}

module.exports = memoize(reviews);
