#!/usr/bin/env deno run --allow-net --allow-run --allow-write --allow-read --inspect

import { pipeToStdout } from "./utils.ts";

type ProcessEntry = { process: Deno.ChildProcess; port: number };
const MODEL_ROUTE = new URLPattern({ pathname: "/models/:id" });
const servers = new Map<string, ProcessEntry>();
const tunnels = new Map<WebSocket, WebSocket>();

Deno.serve((req: Request) => {
  const route_matches = MODEL_ROUTE.exec(req.url);
  if (route_matches) {
    const modelName = route_matches.pathname.groups.id;

    if (!modelName) return new Response(null, { status: 404 });

    if (req.headers.get("upgrade") != "websocket") {
      return new Response(null, { status: 501 });
    }
    const { socket: client, response } = Deno.upgradeWebSocket(req);

    client.onopen = async () => {
      log(`client opened connection to ${modelName}`);

      let entry = servers.get(modelName);

      if (!entry) {
        entry = await startServer(modelName);
      }
      servers.set(modelName, entry);

      const serverUrl = "ws://localhost:" + entry.port;
      log(`opening new tunnel to server at ${serverUrl}`);

      const serverConnection: WebSocket = new WebSocket(serverUrl);

      serverConnection.onopen = () => {
        log(`tunnel to server opened`);
        tunnels.set(client, serverConnection);
      };

      serverConnection.onclose = () => {
        log(`server closed tunnel`);
        tunnels.delete(client);
      };

      serverConnection.onerror = (ev: Event | ErrorEvent) => {
        if (ev instanceof ErrorEvent) {
          error(`server error: ${ev.message}`);
        } else {
          error("server error!");
        }
      };

      serverConnection.onmessage = (ev: MessageEvent<string>) => {
        ev.data && client.send(ev.data);
        return ev.data;
      };
    };

    client.onmessage = async (event) => {
      const tunnel = tunnels.get(client);

      if (tunnel && tunnel.readyState === WebSocket.OPEN) {
        log("forwarding " + event.data + " to server");
        tunnel.send(event.data);

        // If you want the server to relay messages to other clients,
        // comment out from here...
        log("...and to other clients");
        Array.from(tunnels.keys()).filter((c) => c !== client).forEach(
          (other) => {
            other.send(event.data);
          },
        );
        // ...to here
      } else {
        log("server connection not ready! waiting...");
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await client.onmessage!(event);
      }
    };

    const awaitTimeout = (delay: number) =>
      new Promise((_resolve, reject) => setTimeout(reject, delay));

    client.onclose = async () => {
      log(`client closed connection to ${modelName}`);
      const tunnel = tunnels.get(client);

      if (tunnel) {
        tunnel.close();
        log("tunnel closed");
      } else {
        error("tunnel not found!");
      }

      tunnels.delete(client);

      if (tunnels.size === 0) {
        log("last client disconnected");
        const server = servers.get(modelName);
        if (server) {
          const exitedNormally = server.process.status;
          try {
            const commandStatus: Deno.CommandStatus = await Promise.race([
              exitedNormally,
              awaitTimeout(10000),
            ]) as Deno.CommandStatus;

            if (commandStatus.success) {
              log("server shut down normally");
            } else {
              error(`server exited with code ${commandStatus.code}`);
            }
          } catch {
            error("failed awaiting server exit");
            server.process.kill();
            error("had to kill the server process after waiting 5 seconds");
          } finally {
            servers.delete(modelName);
          }
        }
      }
    };

    return response;
  } else return new Response(null, { status: 404 });
});

function nextAvailablePort(): number {
  const portsDescending = Array.from(servers.values()).map((entry) =>
    entry.port
  ).sort().reverse();
  return portsDescending.length > 0 ? portsDescending[0] + 1 : 9000;
}

async function startServer(
  modelName: string,
): Promise<ProcessEntry> {
  const port = nextAvailablePort();
  log(`starting a new server on port ${port}`);

  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-net",
      "--allow-write",
      "./server.ts",
      modelName,
      port.toString(),
    ],
    stdin: "piped",
    stdout: "piped",
  });

  const process: Deno.ChildProcess = command.spawn();
  const [a, b] = process.stdout.tee();
  pipeToStdout(a);

  const reader = b.getReader();
  const buffer = await reader.read();
  if (
    !buffer.value ||
    !(new TextDecoder().decode(buffer.value).includes(
      `Listening on http://localhost:${port}`,
    ))
  ) {
    throw new Error("server failed to start correctly");
  }

  return { process, port };
}

export function log(msg: string): void {
  const coloredGreenMsg = "\x1b[32m" + "MUX: " + msg + "\x1b[0m";
  console.log(coloredGreenMsg);
}

export function error(msg: string): void {
  const coloredRedMsg = "\x1b[31m" + "MUX: " + msg + "\x1b[0m";
  console.log(coloredRedMsg);
}
