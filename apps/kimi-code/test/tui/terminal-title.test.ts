import { join, parse } from 'node:path';

import { describe, expect, it } from 'vitest';

import { formatTerminalTitle } from '#/tui/utils/terminal-title';

const rootDir = parse(process.cwd()).root;
const homeDir = join(rootDir, 'home', 'example');
const outsideDir = join(rootDir, 'srv', 'sample');
const options = {
  hostname: 'workstation.example.test',
  homeDir,
};

describe('formatTerminalTitle', () => {
  it('uses the short hostname', () => {
    expect(formatTerminalTitle(outsideDir, options)).toBe(`[workstation] - ${outsideDir}`);
  });

  it('shortens the exact home directory', () => {
    expect(formatTerminalTitle(homeDir, options)).toBe('[workstation] - ~');
  });

  it('shortens a directory inside home', () => {
    expect(formatTerminalTitle(join(homeDir, 'Projects', 'sample'), options)).toBe(
      `[workstation] - ${join('~', 'Projects', 'sample')}`,
    );
  });

  it('keeps a directory outside home absolute', () => {
    expect(formatTerminalTitle(outsideDir, options)).toBe(`[workstation] - ${outsideDir}`);
  });

  it('does not shorten a textual home-prefix collision', () => {
    const collidingDir = join(rootDir, 'home', 'example2', 'sample');

    expect(formatTerminalTitle(collidingDir, options)).toBe(`[workstation] - ${collidingDir}`);
  });

  it('removes control characters from the OSC payload', () => {
    expect(
      formatTerminalTitle(join(homeDir, 'Projects', '\u001Bsample'), {
        hostname: 'work\u0007station.example.test',
        homeDir,
      }),
    ).toBe(`[workstation] - ${join('~', 'Projects', 'sample')}`);
  });

  it('preserves a full path longer than 32 characters', () => {
    const relativePath = join('Projects', 'example-with-a-deliberately-long-directory-name');
    const title = formatTerminalTitle(join(homeDir, relativePath), options);

    expect(title).toBe(`[workstation] - ${join('~', relativePath)}`);
    expect(title.length).toBeGreaterThan(32);
  });
});
