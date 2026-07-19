import { homedir, hostname as osHostname } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;

interface TerminalTitleOptions {
  readonly hostname?: string;
  readonly homeDir?: string;
}

export function formatTerminalTitle(
  workDir: string,
  { hostname = osHostname(), homeDir = homedir() }: TerminalTitleOptions = {},
): string {
  const relativeWorkDir = relative(homeDir, workDir);
  const isHomeDescendant =
    relativeWorkDir.length > 0 &&
    relativeWorkDir !== '..' &&
    !relativeWorkDir.startsWith(`..${sep}`) &&
    !isAbsolute(relativeWorkDir);
  const displayPath =
    relativeWorkDir.length === 0
      ? '~'
      : isHomeDescendant
        ? join('~', relativeWorkDir)
        : workDir;
  const shortHostname = hostname.split('.', 1)[0] ?? hostname;

  return `[${shortHostname}] - ${displayPath}`.replace(CONTROL_CHARACTERS, '');
}
