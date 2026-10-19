import { describe, it, expect } from 'vitest';
import { matchPhrase } from '../src/shared/phrases.js';

describe('matchPhrase spec examples', () => {
  it('exact literal phrase', () => {
    expect(matchPhrase('Next page', ['next page'])).toEqual({ phrase: 'next page', slots: {}, score: 1 });
  });

  it('free text blank', () => {
    const r = matchPhrase('search for cute cats', ['search for {text}']);
    expect(r.phrase).toBe('search for {text}');
    expect(r.slots).toEqual({ text: 'cute cats' });
  });

  it.each([
    ['go to page 12', '12'],
    ['go to page twelve', '12'],
    ['go to page 3', '3'],
    ['go to page seven', '7'],
    ['go to page twenty', '20'],
    ['go to page one', '1'],
  ])('number blank "%s"', (text, number) => {
    expect(matchPhrase(text, ['go to page {number}']).slots).toEqual({ number });
  });

  it('fuzzy literal scores below 1', () => {
    const r = matchPhrase('nexd page', ['next page']);
    expect(r.phrase).toBe('next page');
    expect(r.score).toBeLessThan(1);
    expect(r.score).toBeGreaterThan(0);
  });

  it('blank needs at least one word', () => {
    expect(matchPhrase('search for', ['search for {text}'])).toBeNull();
  });

  it('prefers the phrase that matches the whole transcript', () => {
    expect(matchPhrase('play', ['play', 'play video']).phrase).toBe('play');
  });

  it('returns null when nothing matches', () => {
    expect(matchPhrase('hello there', ['next page'])).toBeNull();
  });
});

describe('normalization', () => {
  it.each(['NEXT PAGE', 'next page!', '  next   page  ', 'Next, page.'])('"%s" matches exactly', (text) => {
    expect(matchPhrase(text, ['next page'])).toEqual({ phrase: 'next page', slots: {}, score: 1 });
  });

  it('keeps original casing in free text and trims it', () => {
    expect(matchPhrase('Search for Cute Cats ', ['search for {text}']).slots).toEqual({ text: 'Cute Cats' });
  });

  it('fills multiple blanks', () => {
    const r = matchPhrase('send hello world to Bob', ['send {message} to {person}']);
    expect(r.slots).toEqual({ message: 'hello world', person: 'Bob' });
  });
});

describe('fuzzy matching', () => {
  it.each([
    ['next pag', 'next page'],
    ['next pave', 'next page'],
    ['scrol down', 'scroll down'],
    ['go bak', 'go back'],
  ])('"%s" fuzzily matches "%s"', (text, phrase) => {
    const r = matchPhrase(text, [phrase]);
    expect(r).not.toBeNull();
    expect(r.phrase).toBe(phrase);
    expect(r.score).toBeLessThan(1);
  });

  it.each([
    ['nexxd page', 'next page'],
    ['go do page 3', 'go to page {number}'],
    ['scroll up', 'scroll down'],
  ])('"%s" does not match "%s"', (text, phrase) => {
    expect(matchPhrase(text, [phrase])).toBeNull();
  });

  it('prefers an exact match over a fuzzy one', () => {
    const r = matchPhrase('next page', ['next pane', 'next page']);
    expect(r.phrase).toBe('next page');
    expect(r.score).toBe(1);
  });

  it('prefers more literal words over a blank', () => {
    expect(matchPhrase('play video', ['play {text}', 'play video']).phrase).toBe('play video');
  });

  it('still uses the blank for other text', () => {
    const r = matchPhrase('play some jazz', ['play {text}', 'play video']);
    expect(r.phrase).toBe('play {text}');
    expect(r.slots).toEqual({ text: 'some jazz' });
  });
});

describe('null cases', () => {
  it.each([
    ['go to page banana', ['go to page {number}']],
    ['', ['next page']],
    ['next page', []],
    ['next', ['next page']],
  ])('"%s" against %j is null', (text, phrases) => {
    expect(matchPhrase(text, phrases)).toBeNull();
  });
});
