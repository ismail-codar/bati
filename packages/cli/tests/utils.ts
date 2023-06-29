import { afterAll, beforeAll, describe, expect, test } from "vitest";
import nodeFetch from "node-fetch";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import http from "node:http";
import getPort from "get-port";

import { execa, type ExecaChildProcess } from "./processUtils";

interface GlobalContext {
  tmpdir: string;
  port: number;
  server: ExecaChildProcess<string> | undefined;
}

type FetchParam1 = Parameters<typeof fetch>[1];

// https://github.com/sindresorhus/wait-for-localhost
export default function waitForLocalhost({
  port,
  path,
  useGet,
  timeout,
}: { port?: number; path?: string; useGet?: boolean; timeout?: number } = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const retry = () => {
      if (Number.isInteger(timeout) && startedAt + timeout! < Date.now()) {
        reject(new Error("Timeout"));
      } else {
        setTimeout(main, 200);
      }
    };

    const method = useGet ? "GET" : "HEAD";

    const doRequest = (ipVersion: 4 | 6, next: (...args: unknown[]) => void) => {
      const request = http.request(
        {
          method,
          port,
          path,
          family: ipVersion,
          // https://github.com/vitejs/vite/issues/9520
          headers: {
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
          },
          timeout: 1000,
        },
        (response) => {
          if (response.statusCode === 200) {
            resolve({ ipVersion });
            return;
          }

          next();
        }
      );

      request.on("error", next);
      request.end();
    };

    const main = () => {
      doRequest(4, () => doRequest(6, () => retry()));
    };

    main();
  });
}

async function initTmpDir(context: GlobalContext) {
  context.tmpdir = await mkdtemp(join(tmpdir(), "bati-"));
}

function execCli(context: GlobalContext, flags: string[]) {
  return execa("node", [join(".", "dist", "index.js"), ...flags.map((f) => `--${f}`), context.tmpdir], {
    timeout: 5000,
  });
}

function runPnpmInstall(context: GlobalContext) {
  return execa("bun", ["install"], {
    // return execa("pnpm", ["install", "--prefer-offline"], {
    cwd: context.tmpdir,

    // Note: experience has shown that 20s may not be enough on GitHub Actions
    // on macOS.
    timeout: 30000,
  });
}

async function initPort(context: GlobalContext) {
  context.port = await getPort();
}

async function runDevServer(context: GlobalContext) {
  context.server = execa("bun", ["run", "dev", "--port", String(context.port)], {
    // context.server = execa("pnpm", ["run", "dev", "--port", String(context.port)], {
    cwd: context.tmpdir,
    env: {
      PORT: String(context.port),
    },
  });

  try {
    await Promise.race([
      // wait for port
      waitForLocalhost({ port: context.port, useGet: true, timeout: 20000 }),
      // or for server to crash
      context.server,
    ]);
  } catch (e) {
    console.log("Server didn't come up in time. Current output:");
    console.log(context.server.log);
    throw e;
  }

  return { server: context.server, port: context.port };
}

export function prepare(flags: string[]) {
  const context: GlobalContext = {
    tmpdir: "",
    port: 0,
    server: undefined,
  };

  // Prepare tests:
  // - Create a temp dir
  // - Execute bati CLI in temp dir
  // - Install dependencies
  // - Run a dev server
  beforeAll(async () => {
    await initTmpDir(context);
    await execCli(context, flags);
    await Promise.all([runPnpmInstall(context), initPort(context)]);
    await runDevServer(context);
  }, 56000);

  // Cleanup tests:
  // - Close the dev server
  // - Remove temp dir
  afterAll(async () => {
    await Promise.race([context.server?.treekill(), new Promise((_resolve, reject) => setTimeout(reject, 5000))]).catch(
      (e) => {
        console.log("Failed to kill server in time. Output:");
        console.log(context.server?.log);
        throw e;
      }
    );

    await Promise.race([
      rm(context.tmpdir, { recursive: true, force: true }),
      new Promise((_resolve, reject) => setTimeout(reject, 5000)),
    ]).catch((e) => {
      console.log("Failed to delete tmpdir in time.");
      throw e;
    });
  }, 11000);

  // Common tests

  test("no TS error", async () => {
    const { exitCode } = await execa("bun", ["x", "tsc", "--noEmit"], {
      // const { exitCode } = await execa("pnpm", ["exec", "tsc", "--noEmit"], {
      cwd: context.tmpdir,
    });

    expect(exitCode).toBe(0);
  });

  return {
    fetch(path: string, init?: FetchParam1) {
      return nodeFetch(`http://localhost:${context.port}${path}`, init);
    },
  };
}

/**
 * Combine each `oneOf` value with all `flags` values.
 * @example
 * describeAll(['a', 'b', 'c'], ['1', '2'], ...);
 * // will prepare tests with the following flags:
 * // ['a', '1', '2']
 * // ['b', '1', '2']
 * // ['c', '1', '2']
 */
export function describeMany(oneOf: string[], flags: string[], fn: (context: ReturnType<typeof prepare>) => void) {
  oneOf.forEach((f) => {
    const currentFlags = [f, ...flags];

    describe.concurrent(currentFlags.join(" + "), () => {
      fn(prepare(currentFlags));
    });
  });
}
