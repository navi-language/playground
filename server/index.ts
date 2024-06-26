import { spawnSync } from 'bun';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import stripAnsi from 'strip-ansi';

const PORT = process.env.PORT || 3000;
const SPAWN_TIMEOUT = 10000;
const TIMEOUT_MESSAGE = `Execution timeout, the maximum allowed time is ${
  SPAWN_TIMEOUT / 1000
}s.`;

const CORS_HEADERS = {
  headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'OPTIONS, POST, GET, PUT, DELETE',
    'Access-Control-Allow-Headers': 'Content-Type',
  },
};

console.log(`Server is running on port ${PORT}`);
console.log(`http://localhost:${PORT}`);

const naviVersion =
  spawnSync(['navi', '--version']).stdout?.toString().trim() || '';
const startedAt = new Date().toISOString();
const STATUS_MESSAGE = JSON.stringify(
  {
    name: 'navi-playground',
    github: 'https://github.com/navi-language/play',
    navi_version: naviVersion,
    started_at: startedAt,
    port: PORT,
  },
  null,
  2
);

Bun.serve({
  port: PORT,
  async fetch(req) {
    const path = new URL(req.url).pathname;

    const clientIP =
      req.headers['x-forwarded-for'] ||
      req.headers['cf-connecting-ip'] ||
      req.headers['x-real-ip'] ||
      '';

    const userAgent = req.headers['user-agent'] || '';
    const date = new Date().toISOString();

    console.info(`${date} ${req.method} ${path} ${clientIP} ${userAgent}`);

    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
      const res = new Response('', CORS_HEADERS);
      return res;
    }

    if (req.method === 'POST' && path === '/execute') {
      return await handleExecute(req);
    }
    if (req.method === 'POST' && path === '/test') {
      return await handleTest(req);
    }
    if (req.method === 'POST' && path === '/format') {
      return await handleFormat(req);
    }

    return newResponse(STATUS_MESSAGE, 200);
  },
});

// POST /format
async function handleFormat(req: Request) {
  const payload = await req.json();
  const { source } = payload;

  if (!source) {
    return new Response('No source code provided', { status: 200 });
  }

  const result = await NaviCommand.format(source);
  if (result.exitCode != 0) {
    return newResponse({ error: stripAnsi(result.stderr) }, 400);
  }

  return newResponse({ out: result.stdout }, 200);
}

// POST /execute
async function handleExecute(req: Request) {
  const payload = await req.json();
  const { source } = payload;

  if (!source) {
    return new Response('No source code provided', { status: 200 });
  }

  const result = await NaviCommand.run(source);
  if (result.exitCode != 0) {
    const error = stripAnsi(result.stderr || result.stdout);
    return newResponse({ error }, 400);
  }

  console.log(result);

  return newResponse({ out: stripAnsi(result.stdout) }, 200);
}

// POST /test
async function handleTest(req: Request) {
  const payload = await req.json();
  const { source } = payload;

  if (!source) {
    return new Response('No source code provided', { status: 200 });
  }

  const result = await NaviCommand.test(source);
  if (result.exitCode != 0) {
    const error = stripAnsi(result.stderr || result.stdout);
    return newResponse({ error }, 400);
  }

  console.log(result);

  return newResponse({ out: stripAnsi(result.stdout) }, 200);
}

function newResponse(
  data: Record<string, string> | string,
  status: number
): Response {
  let body = '';
  if (typeof data === 'string') {
    body = data;
  } else {
    body = JSON.stringify(data);
  }
  const res = new Response(body, { ...CORS_HEADERS, status });
  return res;
}

class NaviCommand {
  static tmpFile() {
    return tmpdir() + '/' + randomUUID() + '.nv';
  }

  static async run(source: string) {
    const tmpFile = this.tmpFile();
    Bun.write(tmpFile, source);
    return this.exec('navi', ['run', tmpFile]);
  }

  static async test(source: string) {
    const tmpFile = this.tmpFile();
    Bun.write(tmpFile, source);
    return this.exec('navi', ['test', tmpFile]);
  }

  static async format(source: string) {
    return this.exec('navi', ['fmt', '--stdin', '--emit', 'stdout'], {
      input: source,
    });
  }

  static async exec(
    command: string,
    args: string[],
    options: {
      input?: string;
    } = {}
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    // args.unshift(command);
    const child = spawn(command, args, {
      stdio: 'pipe',
      timeout: SPAWN_TIMEOUT,
      env: {
        ...process.env,
        NO_COLOR: '1',
        FORCE_COLOR: '1',
      },
    });

    if (options.input) {
      child.stdin?.write(options.input);
      child.stdin?.end();
    }

    return new Promise((resolve) => {
      const result = { exitCode: -1, stdout: '', stderr: '' };

      child.stdout?.on('data', (data) => {
        result.stdout += data;
      });

      child.stderr?.on('data', (data) => {
        result.stderr += data;
      });

      child.on('exit', (code) => {
        if (code === null) {
          code = -1;
          result.stderr = TIMEOUT_MESSAGE;
        }

        result.exitCode = code || 0;
        // console.log("exit", code, result);
        resolve(result);
      });
    });
  }
}
