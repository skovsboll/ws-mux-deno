#!/usr/bin/env deno run --allow-net --allow-run --allow-write --allow-read

const MODEL_ROUTE = new URLPattern({ pathname: "/models/:id" });
const servers = new Map<
  string,
  { process: Deno.ChildProcess; port: number }
>();
const tunnels = new Map<WebSocket, WebSocket>();

Deno.serve((req: Request) => {
  const match = MODEL_ROUTE.exec(req.url);
  if (match) {
    const modelName = match.pathname.groups.id;

    if (!modelName) return new Response(null, { status: 404 });

    if (req.headers.get("upgrade") != "websocket") {
      return new Response(null, { status: 501 });
    }
    const { socket: client, response } = Deno.upgradeWebSocket(req);

    client.onopen = async () => {
      log(`client opened connection to ${modelName}`);

      let entry = servers.get(modelName);

      if (!entry) {
        const port = 9000 + servers.size;
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
        process.stdout.pipeTo(Deno.stdout.writable);
        entry = { process, port };
        servers.set(modelName, entry);
      }

      const serverUrl = "ws://localhost:" + entry.port;
      log(`opening new tunnel to server at ${serverUrl}`);

      // Connect with retry until its readystate is open
      let serverConnection = new WebSocket(serverUrl);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      while (
        serverConnection.readyState === WebSocket.CLOSING ||
        serverConnection.readyState === WebSocket.CLOSED
      ) {
        log("server not ready yet. waiting...");
        await new Promise((resolve) => setTimeout(resolve, 1000));
        serverConnection.close();
        serverConnection = new WebSocket(serverUrl);
      }
      serverConnection.onmessage = (ev: MessageEvent<string>) => {
        ev.data && client.send(ev.data);
        return ev.data;
      };
      tunnels.set(client, serverConnection);
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

    client.onclose = () => {
      log(`client closed connection to ${modelName}`);
      const tunnel = tunnels.get(client);
      if (tunnel) tunnel.close();
      tunnels.delete(client);
      if (tunnels.size === 0) {
        log("last client disconnected");
        const server = servers.get(modelName);
        if (server) {
          server.process.kill();
          log("server shut down");
        }
      }
    };

    return response;
  } else return new Response(null, { status: 404 });
});

function log(msg: string): void {
  const coloredGreenMsg = "\x1b[32m" + "MUX: " + msg + "\x1b[0m";
  console.log(coloredGreenMsg);
}
