#!/usr/bin/env deno run --allow-net --allow-write

/**
 * Runs a simple websocket server that writes all messages to
 * a file.
 *
 * Usage:
 *
 *    ./server.ts <file> <port>
 *
 * It's meant to be called by mux.ts
 */

const context: { file?: Deno.FsFile } = {
  file: undefined,
};

const sockets = new Set<WebSocket>();

Deno.serve({ port: parseInt(Deno.args[1]) }, (req: Request) => {
  if (req.headers.get("upgrade") != "websocket") {
    return new Response(null, { status: 501 });
  }
  const { socket, response } = Deno.upgradeWebSocket(req);

  socket.addEventListener("open", () => {
    console.log("a client connected!");
    sockets.add(socket);
    if (!context.file) {
      console.log(`Opening ${Deno.args[0]}!`);
      const file = context.file = Deno.openSync(Deno.args[0], {
        write: true,
        create: true,
        truncate: false,
      });
      socket.addEventListener("message", (event) => {
        file.writeSync(new TextEncoder().encode(event.data + "\n"));
      });
    }
  });

  socket.addEventListener("close", () => {
    console.log("client disconnected!");
    sockets.delete(socket);
    if (sockets.size === 0 && context.file) {
      console.log(`Closing ${Deno.args[0]}!`);
      context.file.close();
      context.file = undefined;
    }
  });

  return response;
});
