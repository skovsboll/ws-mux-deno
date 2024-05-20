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
      console.log(`client opened connection to ${modelName}`);
      if (!servers.get(modelName)) {
        const port = 9000 + servers.size;
        console.log(`starting a new server on port ${port}`);
        const args = [
          "run",
          "--allow-net",
          "--allow-write",
          "./server.ts",
          modelName,
          port.toString(),
        ];

        const command = new Deno.Command(Deno.execPath(), {
          args,
          stdin: "piped",
          stdout: "piped",
        });

        const process: Deno.ChildProcess = command.spawn();

        // wait until process.stdout prints "Listening on http://localhost:9000/"
        // const reader = process.stdout.getReader();
        // const result = await reader.read();
        // const output = new TextDecoder().decode(result.value);
        // console.log(output);

        process.stdout.pipeTo(Deno.stdout.writable);

        servers.set(modelName, { process, port });
      }

      const entry = servers.get(modelName);
      if (entry) {
        const serverUrl = "ws://localhost:" + entry.port;
        console.log(`opening new tunnel to server at ${serverUrl}`);

        // Connect with retry until its readystate is open
        let serverConnection = new WebSocket(serverUrl);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        while (
          serverConnection.readyState === WebSocket.CLOSING ||
          serverConnection.readyState === WebSocket.CLOSED
        ) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          serverConnection.close();
          serverConnection = new WebSocket(serverUrl);
        }
        serverConnection.onmessage = (ev: MessageEvent<string>) => {
          ev.data && client.send(ev.data);
          return ev.data;
        };
        tunnels.set(client, serverConnection);
      }
    };

    client.onmessage = (event) => {
      const serverSocket = tunnels.get(client);

      if (serverSocket && serverSocket.readyState === WebSocket.OPEN) {
        serverSocket.send(event.data);
      } else {
        console.error("server connection not ready!", serverSocket);
      }
    };

    client.onclose = () => {
      console.log(`client closed connection to ${modelName}`);
      const tunnel = tunnels.get(client);
      if (tunnel) tunnel.close();
      tunnels.delete(client);
      if (tunnels.size === 0) {
        console.log("last client disconnected");
        const server = servers.get(modelName);
        if (server) {
          server.process.kill();
          console.log("server shut down");
        }
      }
    };

    return response;
  } else return new Response(null, { status: 404 });
});
