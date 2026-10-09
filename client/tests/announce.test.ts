import { describe, expect, it } from 'vitest';
import { AnnounceTracker, announcementText, spokenTicket } from '../src/lib/announce';
import { duration, humanize, money } from '../src/lib/format';

describe('spoken announcements', () => {
  it('reads letters and number clearly', () => {
    expect(spokenTicket('C-012')).toBe('C 12');
    expect(spokenTicket('RAD-007')).toBe('R A D 7');
    expect(spokenTicket('weird')).toBe('weird');
  });
  it('names the counter and department, and never anything else', () => {
    expect(announcementText({ displayNumber: 'T-004', department: 'Triage', counter: 'Triage Room 2' })).toBe('Ticket T 4, please proceed to Triage Room 2, Triage.');
    expect(announcementText({ displayNumber: 'A-001', department: 'Accounts', counter: null })).toBe('Ticket A 1, please proceed to Accounts.');
  });
});

describe('AnnounceTracker', () => {
  it('announces each call once, but a recall (new key) again', () => {
    const t = new AnnounceTracker();
    t.prime(['1:1']);
    expect(t.take('1:1')).toBe(false); // already on screen at page load
    expect(t.take('2:1')).toBe(true);
    expect(t.take('2:1')).toBe(false); // reconnect or refresh
    expect(t.take('2:2')).toBe(true); // recall
  });
  it('does not grow without bound', () => {
    const t = new AnnounceTracker();
    for (let i = 0; i < 2000; i++) t.take(`k${i}`);
    expect(t.take('k1999')).toBe(false);
  });
});

describe('formatting', () => {
  it('formats durations', () => {
    expect(duration(null)).toBe('—');
    expect(duration(45)).toBe('45s');
    expect(duration(600)).toBe('10 min');
    expect(duration(3720)).toBe('1 h 2 min');
  });
  it('formats money from minor units and humanizes codes', () => {
    expect(money(150000)).toMatch(/1,500\.00/);
    expect(humanize('IN_SERVICE')).toBe('In service');
  });
});
